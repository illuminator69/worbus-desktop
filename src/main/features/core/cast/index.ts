import { Bonjour } from 'bonjour-service';
import log from 'electron-log/main';

interface CastBrowser {
    on(event: 'down' | 'up', listener: (service: CastService) => void): void;
    stop(): void;
    /** Re-send the mDNS PTR query. See REQUERY_* below. */
    update(): void;
}

import { Client, DefaultMediaReceiver } from 'castv2-client';
import { ipcMain } from 'electron';
import net from 'net';
import { WebSocket } from 'ws';

import {
    getHubActiveAddress,
    getHubConfig,
    getHubDeviceId,
    getHubDevices,
    hubAuth,
    hubEvents,
} from '../hub';
import { type ArbitrationInput, claimStep, reevaluateClaims } from './arbitration';
import { castHelloFrame } from './cast-hello';
import { createCastLoader, type SendLoad } from './cast-load';
import {
    adoptable,
    CastStatusLike,
    OwnCast,
    streamIdentity,
    takeoverStep,
} from './foreign-session';
import { logSafeStreamId } from './log-id';
import { CastKind, type CastService, receiverLevel, serviceToDevice } from './receiver-info';

import { levelReportStep, NO_LEVEL_REPORT } from '/@/shared/utils/level-report';

/**
 * Chromecast ⇄ navi-connect bridge (the "full virtual receiver" model).
 *
 * Every Chromecast discovered via mDNS is registered with the hub as a
 * first-class receiver device — so it appears in EVERY client's device picker
 * (Worbus for desktop and Worbus for Android alike), and transfer-with-resume just works. The hub
 * needs no changes: a virtual receiver is simply another connection.
 *
 * Audio: published track metadata carries `streamUrl` (+ `mime`), so the
 * bridge hands the Chromecast direct Navidrome URLs — audio flows
 * server → Chromecast, never through this process.
 */

interface HubTrack {
    album?: string;
    artist?: string;
    durationMs?: number;
    id: string;
    imageUrl?: null | string;
    mime?: string;
    streamUrl?: string;
    title?: string;
}

const noop = () => {};

// Hub reconnect: capped exponential backoff with jitter (protocol §3) so every
// bridge doesn't hammer a down hub in lockstep.
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// WS heartbeat so a half-open hub socket is detected + force-closed instead of
// leaving the bridge dead-but-registered with readyState === OPEN.
const HEARTBEAT_MS = 10000;
// Hub close code for "another socket registered this same device id" (protocol
// §3). Two clients that both see a speaker register the same `cast-<id>`, so
// each supersedes the other; reconnecting on the normal backoff makes that an
// endless register/evict war, and because `open` resets the backoff it never
// even slows down. PROTOCOL §12.2's circuit breaker: the superseded bridge stays
// down long enough for the winner to keep the speaker. Worbus for Android already does this.
const SUPERSEDED_CODE = 4003;
const STAND_DOWN_MS = 5 * 60 * 1000;
// The hub refused this bridge's credential: 4001 a bad shared token, 4005 a device secret it no
// longer holds (Worbus P2). The same credential gets the same answer, so the bridge waits for the
// credential to change (the `settings` event rebuilds every bridge) instead of retrying (Q-086).
const REFUSED_CODES = new Set([4001, 4005]);
// PROTOCOL §12.2 step 3: two clients starting at the same moment both see an empty
// registry and both claim. A random pause before claiming, then a re-check, settles
// that without exchanging a single frame.
const CLAIM_JITTER_MS = 3000;
// How long a hub connection must survive before it counts as "working" and the
// reconnect backoff resets. Resetting it in `open` meant a socket that was accepted
// and immediately evicted looked like a success every time, so the exponential backoff
// could never engage and two bridges fought at full speed indefinitely.
const BACKOFF_RESET_AFTER_MS = 60_000;

// appId of the Default Media Receiver — used to spot an already-running cast
// session to re-join (vs. launching a fresh one) after a bridge restart.
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

// Budget for getting a receiver on a connection we already hold. Kept short because it is the
// optimistic path: if the socket is dead we still have to reconnect and launch inside the same
// 10 s LOAD_TIMEOUT, and a join on a live socket answers in a few hundred milliseconds.
const RELAUNCH_TIMEOUT_MS = 3500;

// Budget for setting the volume of a speaker we hold no connection to: connect, one request,
// its answer. On a LAN that is a few hundred milliseconds; a speaker that is off never answers.
const IDLE_VOLUME_TIMEOUT_MS = 5000;

// Reachability (PROTOCOL §3.2 / §12.2). `online` on a cast row means THIS process holds
// the hub socket — it says nothing about the speaker, which may be off, asleep, or on a
// network nobody here is on. The bridge is the only party that can tell the difference,
// so it probes and reports. The probe is a bare TCP connect: asking the receiver app
// would mean LAUNCHing it, and launching seizes the speaker's audio output.
const PROBE_TIMEOUT_MS = 2000;
const REACHABILITY_INTERVAL_MS = 30_000;
// Consecutive failed probes before we call a speaker down. One miss is a dropped packet;
// two spread over a minute is a speaker that has genuinely gone away. A phantom receiver
// for a minute is much cheaper than dropping a live one.
const REACHABILITY_FAILS_BEFORE_DOWN = 2;
// A Chromecast that is unplugged emits no mDNS goodbye, so `down` never fires and the
// bridge would advertise a dead speaker forever. Sweep instead: gone from mDNS this long
// AND failing the probe means tear the bridge down.
const MISSING_GRACE_MS = 90_000;
const BRIDGE_SWEEP_MS = 30_000;

class CastDeviceBridge {
    /** Last time mDNS said this speaker exists. Drives the missing-device sweep. */
    lastSeenAt = Date.now();

    /** The id this bridge registers with the hub (matches activeDeviceId). */
    get hubDeviceId(): string {
        return `cast-${this.deviceId}`;
    }

    /** Whether this bridge currently holds its hub socket — i.e. whether this
     *  process, rather than some other client, is the one driving the speaker. */
    get isRegistered(): boolean {
        return !this.destroyed && this.ws?.readyState === WebSocket.OPEN;
    }

    /** True while the speaker is believed present — used by the missing-device sweep. */
    get looksReachable(): boolean {
        return this.reachable !== false;
    }

    // Whether we've already tried to re-adopt a running cast session for the
    // current hub connection (reset on each fresh `welcome`).
    private adopted = false;
    /** B-047: the last reason maybeAdopt skipped, so a skip is logged once, not per frame. */
    private adoptSkipLogged = '';

    /**
     * B-107: the last claim found no registry, and the next `devices` event re-runs it with the
     * delay it was asked for (a reconnect asks for none, a new bridge for the jitter); null when
     * no claim is waiting for one.
     */
    private awaitingRegistry: null | { delayMs: number | undefined } = null;

    private backoffMs = INITIAL_BACKOFF_MS;

    private backoffResetTimer: NodeJS.Timeout | null = null;

    private castClient: Client | null = null;

    private castPlayer: import('castv2-client').CastPlayer | null = null;

    /**
     * The in-flight session build, so there is never more than one.
     *
     * Two overlapping loads used to each construct their own `Client` and LAUNCH the receiver
     * independently. The device answers the loser `LAUNCH_ERROR: CANCELLED`, both winners keep a
     * `status` listener so every report doubled, and `connectCast`'s failure path called the
     * shared `teardownCast()` — so a losing attempt destroyed the winning attempt's live session.
     */
    private castSetup: null | Promise<import('castv2-client').CastPlayer> = null;

    private claimTimer: NodeJS.Timeout | null = null;

    private destroyed = false;

    /** Worbus P2: media sessions released as another user's, never adopted (foreign-session.ts). */
    private readonly foreignMediaSessions = new Set<number>();

    private heartbeatTimer: NodeJS.Timeout | null = null;

    private hubAlive = false;

    /** A short volume connection is open (setIdleVolume): there is never more than one. */
    private idleVolumeBusy = false;

    /** The newest level (0..1) asked for while one was open; set next, the ones between dropped. */
    private idleVolumeWanted: null | number = null;

    private index = 0;

    private lastPositionMs = 0;

    /** B-106: the load procedure, its deadline and its answer to the hub (cast-load.ts). */
    private readonly loader = createCastLoader<import('castv2-client').CastPlayer>({
        ensureCast: () => this.ensureCast(),
        log: (level, message) => log[level](`[cast-bridge] ${this.friendlyName}: ${message}`),
        pauseLanded: (player) => {
            log.warn(
                `[cast-bridge] ${this.friendlyName}: a load nobody wants any more landed - pausing it`,
            );
            try {
                player.pause(noop);
            } catch (pauseError) {
                log.warn(`[cast-bridge] ${this.friendlyName}: that pause failed`, pauseError);
            }
        },
        sendLoaded: (frame) => this.send(frame),
        teardown: () => this.teardownCast(),
    });

    /**
     * The load currently in progress, so a second command can wait for it rather than race it.
     *
     * `castSetup` already stops two loads from building two sessions; this stops them issuing two
     * LOADs into one. The pair matters because the second LOAD wins, and a `do:play` arriving
     * mid-transfer carries a `lastPositionMs` that is older than the position the transfer asked
     * for — so the race silently rewound playback.
     */
    private loadInFlight: null | Promise<boolean> = null;

    /** Worbus P2: the receiver app session this bridge launched or joined. */
    private ownAppSessionId: null | string = null;

    /** Worbus P2: the media session this bridge's own LOAD (or a proven adoption) produced. */
    private ownMediaSessionId: null | number = null;

    private playing = false;

    private probeFailures = 0;

    private reachabilityTimer: NodeJS.Timeout | null = null;

    /** Our last asserted verdict on the speaker; null until the first probe lands. */
    private reachable: boolean | null = null;

    /**
     * The speaker's own volume (0..100, 0 while muted) as it last said it on a connection this
     * bridge held; null until it has. Sent to the hub as the row's `volume` - see reportVolume.
     */
    private receiverVolume: null | number = null;

    private reconnectingCast = false;

    private reconnectTimer: NodeJS.Timeout | null = null;
    private releasing = false;

    // Saved-queue identity of the session we adopted, so re-claiming it refreshes that
    // history record instead of forking a near-duplicate of music that never stopped.
    private sessionMeta: {
        savedQueueId?: string;
        sourceKind?: string;
        sourceName?: string;
    } = {};

    /** Set until the §12.2 stand-down expires; blocks re-claiming before then. */
    private standDownUntil = 0;

    /** True while another client holds this speaker and we are deliberately idle. */
    private standingDown = false;

    private statusInFlight = false;

    // True while teardownCast() is closing our own socket — see onCastSocketClosed.
    private tearingDown = false;

    private ticker: NodeJS.Timeout | null = null;

    private tracks: HubTrack[] = [];

    /** The last volume told to the hub on its current connection (level-report.ts). */
    private volumeReport = NO_LEVEL_REPORT;

    private volumeReportTimer: NodeJS.Timeout | null = null;

    /** Wall-clock ms the hub last told this speaker a level on its current connection. */
    private volumeToldAt: null | number = null;

    /** P3 (M2): the last connect found no live hub address and is waiting out a backoff for one. */
    private waitingForAddress = false;

    private ws: null | WebSocket = null;

    constructor(
        private readonly deviceId: string,
        private readonly friendlyName: string,
        private host: string,
        /** B-115: the port the device advertises (a group's is not 8009). */
        private port: number,
        /** What the speaker is, from its mDNS record; undefined when the record does not say. */
        private readonly kind: CastKind | undefined,
    ) {
        this.scheduleClaim();
    }

    /**
     * P3 (M2): the main socket has an address now. A bridge that was waiting for one goes back
     * through arbitration at once instead of at the end of its backoff (which the waits grew).
     */
    addressReady(): void {
        if (this.destroyed || !this.waitingForAddress || !this.reconnectTimer) return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.waitingForAddress = false;
        this.backoffMs = INITIAL_BACKOFF_MS;
        this.scheduleClaim(0);
    }

    destroy(): void {
        this.destroyed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.claimTimer) clearTimeout(this.claimTimer);
        if (this.backoffResetTimer) clearTimeout(this.backoffResetTimer);
        if (this.volumeReportTimer) clearTimeout(this.volumeReportTimer);
        this.stopReachability();
        this.stopHeartbeat();
        this.stopTicker();
        this.teardownCast();
        try {
            this.ws?.close();
        } catch {
            /* ignore */
        }
        this.ws = null;
    }

    // ----------------------------------------------------------------- hub

    /**
     * The hub's device list changed — PROTOCOL §12.2 step 2. A bridging client quitting
     * is what frees the speaker, and nothing else would ever tell us.
     */
    reevaluate(): void {
        if (this.destroyed || this.ws) return;
        if (this.awaitingRegistry) {
            // B-107: the claim timer found no registry; this is the next one (or still none).
            if (getHubDevices() === null) return;
            const { delayMs } = this.awaitingRegistry;
            this.awaitingRegistry = null;
            this.scheduleClaim(delayMs);
            return;
        }
        if (!this.standingDown) return;
        if (!reevaluateClaims(this.arbitrationInput())) return;
        log.info(`[cast-bridge] ${this.friendlyName}: speaker was released — claiming it`);
        this.standingDown = false;
        this.scheduleClaim();
    }

    /**
     * mDNS re-announced this device at a different address. Discovery only ever told us
     * once, so without this the bridge kept dialling wherever the speaker used to live and
     * every connect timed out — permanently, since re-discovery is skipped for a device we
     * already have a bridge for.
     */
    updateHost(host: string, port: number): void {
        if (!host || (host === this.host && port === this.port)) return;
        log.info(
            `[cast-bridge] ${this.friendlyName}: address changed ${this.host}:${this.port} → ${host}:${port}`,
        );
        this.host = host;
        this.port = port;
        const wasPlaying = this.playing;
        this.teardownCast();
        // Whatever we held pointed at the old address; pick playback back up at the new one.
        if (wasPlaying && this.tracks.length) void this.loadCurrent(this.lastPositionMs, true);
    }

    /** Make a freshly launched player the bridge's, with the listeners that go with it. */
    private adoptPlayer(
        client: Client,
        player: import('castv2-client').CastPlayer,
    ): import('castv2-client').CastPlayer {
        // A relaunch adopts a new player on the connection already held, and that connection
        // is already being listened to.
        const held = this.castClient === client;
        this.castClient = client;
        this.castPlayer = player;
        if (!held) this.watchReceiver(client);
        // castv2-client leaks request listeners on slow channels.
        (
            player as unknown as { media?: { setMaxListeners?: (n: number) => void } }
        ).media?.setMaxListeners?.(50);
        // Identity check: a stray player left over from an overlapping attempt kept reporting,
        // which is why every status line appeared twice in the log and the hub was fed two
        // reports per tick.
        player.on('status', (status) => {
            if (this.castPlayer === player) this.onCastStatus(status);
        });
        return player;
    }

    private adoptRunningSession(claim = false): Promise<void> {
        return new Promise((resolve) => {
            const client = new Client();
            let settled = false;
            const finish = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const timeout = setTimeout(() => {
                log.warn(`[cast-bridge] ${this.friendlyName}: adoption timed out`);
                try {
                    client.close();
                } catch {
                    /* ignore */
                }
                finish();
            }, 8000);
            client.on('error', (err) => {
                log.warn(`[cast-bridge] ${this.friendlyName}: adoption error`, err.message);
                clearTimeout(timeout);
                try {
                    client.close();
                } catch {
                    /* ignore */
                }
                finish();
            });
            log.info(`[cast-bridge] ${this.friendlyName}: checking for a running session to adopt`);
            client.connect({ host: this.host, port: this.port }, () => {
                client.getSessions((err, sessions) => {
                    const running = (sessions ?? []).find(
                        (s) => s.appId === DEFAULT_MEDIA_RECEIVER_APP_ID,
                    );
                    if (err || !running) {
                        clearTimeout(timeout);
                        log.info(`[cast-bridge] ${this.friendlyName}: no running session to adopt`);
                        try {
                            client.close();
                        } catch {
                            /* ignore */
                        }
                        finish();
                        return;
                    }
                    client.join(running, DefaultMediaReceiver, (joinErr, player) => {
                        clearTimeout(timeout);
                        if (joinErr || !player) {
                            log.warn(
                                `[cast-bridge] ${this.friendlyName}: join failed`,
                                joinErr?.message,
                            );
                            try {
                                client.close();
                            } catch {
                                /* ignore */
                            }
                            finish();
                            return;
                        }
                        player.getStatus((_e, status) => {
                            const contentId = status?.media?.contentId;
                            // Adopting a session means telling every client this speaker IS
                            // our session, so require proof: it must be playing a track from
                            // that very queue. Someone else's cast, or a receiver session
                            // left over from yesterday, matches nothing and is left alone.
                            // This check used to be skipped entirely when `claim` was false
                            // (the re-adopt-after-drop path), so a bridge would happily join
                            // an unrelated Default Media Receiver session and then drive it.
                            // Matching is on the Subsonic track id, not the whole URL — see
                            // streamIdentity().
                            const playingId = streamIdentity(contentId);
                            // Worbus P2: and never a session this bridge released as another
                            // user's - one library, so their track can be in this queue too.
                            const matches = adoptable(status, this.ownCast());
                            if (!matches) {
                                log.info(
                                    `[cast-bridge] ${this.friendlyName}: running session is not ` +
                                        'ours — leaving it alone',
                                );
                                try {
                                    client.close();
                                } catch {
                                    /* ignore */
                                }
                                finish();
                                return;
                            }
                            // Claiming the orphaned slot also needs the speaker to be LIVE. A
                            // speaker playback was moved away from keeps its receiver session,
                            // paused on the old track — which matched, so the next launch claimed
                            // it and pulled the session back onto the speaker (seen 2026-09-30:
                            // Worbus for Android, reinstalled, re-adopted a DOGTOOTH paused 12 minutes earlier).
                            // Re-joining a session the hub still names as ours is not a claim and
                            // is unaffected.
                            const live =
                                status?.playerState === 'PLAYING' ||
                                status?.playerState === 'BUFFERING';
                            if (claim && !live) {
                                log.info(
                                    `[cast-bridge] ${this.friendlyName}: running session is ` +
                                        `${status?.playerState ?? 'without status'} — not claiming the idle slot`,
                                );
                                try {
                                    client.close();
                                } catch {
                                    /* ignore */
                                }
                                finish();
                                return;
                            }
                            this.castClient = client;
                            this.castPlayer = player;
                            this.ownAppSessionId = running.sessionId ?? null;
                            this.ownMediaSessionId =
                                typeof status?.mediaSessionId === 'number'
                                    ? status.mediaSessionId
                                    : null;
                            this.watchReceiver(client);
                            (
                                player as unknown as {
                                    media?: { setMaxListeners?: (n: number) => void };
                                }
                            ).media?.setMaxListeners?.(50);
                            player.on('status', (s) => this.onCastStatus(s));
                            client.on('close', () => this.onCastSocketClosed());
                            if (status) {
                                if (
                                    typeof status.currentTime === 'number' &&
                                    status.currentTime > 0
                                ) {
                                    this.lastPositionMs = Math.round(status.currentTime * 1000);
                                }
                                this.playing = status.playerState === 'PLAYING';
                                // Re-sync the index from whatever is actually loaded.
                                if (playingId) {
                                    const idx = this.tracks.findIndex(
                                        (tk) => streamIdentity(tk.streamUrl) === playingId,
                                    );
                                    if (idx >= 0) this.index = idx;
                                }
                            }
                            log.info(
                                `[cast-bridge] ${this.friendlyName}: adopted running session ` +
                                    `(playing=${this.playing}, index=${this.index}, ` +
                                    `${this.lastPositionMs}ms)`,
                            );
                            // Take the active slot back first when it's empty — until the hub
                            // considers us active, a report is discarded and the session stays
                            // "stopped" no matter how loudly the speaker is playing.
                            if (claim) this.claimActive();
                            // Report so the hub flips the session back to playing
                            // and every client's bar reflects live truth again.
                            this.report();
                            if (this.playing) this.startTicker();
                            finish();
                        });
                    });
                });
            });
        });
    }

    /**
     * Say the receiver app is gone the moment it goes, instead of up to 30 s later.
     *
     * The hub gates transfers on this verdict (§3.2), so a stale "the app is up" costs a whole
     * failed-transfer round trip — a `load_failed` toast and a rolled-back active slot — where an
     * honest answer would have been a clean refusal. Reachability is left alone: the app going
     * away says nothing about whether the hardware is still there.
     */
    private announceAppGone(): void {
        this.send({ appRunning: false, reachable: this.reachable, t: 'deviceState' });
    }

    /**
     * `do:setVolume`: on the connection the bridge holds, or on a short one of its own when it
     * holds none (setIdleVolume) - the speaker is not playing, and the hub sent the level
     * because this bridge said `idleVolume`. `level` is 0..1.
     */
    private async applyVolume(level: number): Promise<void> {
        // The answer to this is reported once no further level has been told for 250 ms.
        this.volumeToldAt = Date.now();
        // A session being built is about to be the connection the bridge holds.
        if (this.castSetup) await this.castSetup.catch(noop);
        if (!this.castClient) {
            await this.setIdleVolume(level);
            return;
        }
        const landed = await this.commandLanded((cb) =>
            this.castClient?.setVolume({ level }, (err, volume) => {
                // The receiver answers with the volume it is now at, which is what the row
                // should say: a muted speaker is still at 0, and a level may be rounded to
                // its steps.
                if (!err) this.noteReceiverVolume(volume);
                cb(err);
            }),
        );
        if (!landed) {
            log.warn(`[cast-bridge] ${this.friendlyName}: volume did not reach the device`);
        }
    }

    /**
     * Is another client already bridging this speaker? PROTOCOL §12.2 step 1.
     *
     * Read off the MAIN hub client's registry, not this bridge's own socket: the bridge
     * socket *is* the device being claimed, so by the time it could read `devices` the
     * claim has already happened and the hub has already evicted somebody. That
     * chicken-and-egg is why the desktop bridge used to register unconditionally while
     * Worbus for Android implemented the full rule — the two then took turns every second.
     */
    private arbitrationInput(): ArbitrationInput {
        return {
            castHubId: this.hubDeviceId,
            registry: getHubDevices(),
            // Our own previous socket doesn't count as a competitor.
            selfHubId: getHubDeviceId(),
        };
    }

    /**
     * Build a session: reuse a proven one, otherwise launch, retrying a cancelled launch.
     *
     * Only ever called through [ensureCast], which guarantees one at a time.
     */
    private async buildCastSession(): Promise<import('castv2-client').CastPlayer> {
        // `castPlayer` is a plain object and stays valid-looking indefinitely — a
        // Chromecast closes its receiver app after a few idle minutes and nothing here
        // is told. Reusing it unasked is what made "cast to the TV" assume a session
        // that had been dead for days: the load went into the void, and the ~20 s of
        // stacked timeouts before it gave up were 20 s of every client showing a
        // playing bar over a silent TV.
        if (this.castPlayer) {
            if (await this.castLinkAlive()) return this.castPlayer;
            log.info(`[cast-bridge] ${this.friendlyName}: cached cast session is dead`);
            this.castPlayer = null;
        }

        // "The receiver app is gone" and "the connection is gone" are different facts, and only
        // the probe above has been answered. Relaunch on the socket we already hold BEFORE
        // closing anything: closing a sender connection is what makes the device tear its
        // receiver down, and a LAUNCH landing in the seconds after that comes back CANCELLED —
        // so close-then-reconnect manufactures the failure it then has to wait out, which is the
        // loop the 01:34 log shows. Reusing the socket skips the window entirely.
        if (this.castClient) {
            const relaunched = await this.relaunchOnCurrentClient();
            if (relaunched) return relaunched;
            this.teardownCast();
        }

        return this.connectCast();
    }

    private capturePosition(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.castPlayer) {
                resolve();
                return;
            }
            try {
                this.castPlayer.getStatus((_err, status) => {
                    // Keep the last good position if the device returns 0/undefined
                    // mid-transition — a 0 here is what reset transfers back to 0.
                    if (typeof status?.currentTime === 'number' && status.currentTime > 0) {
                        this.lastPositionMs = Math.round(status.currentTime * 1000);
                    }
                    resolve();
                });
            } catch {
                // castv2 throws synchronously ("reading 'send'" of null) when the
                // cast socket has died — keep the last known position.
                resolve();
            }
        });
    }

    /**
     * Is the cast connection we hold still a connection? Weaker than castSessionAlive:
     * it asks whether the device answers at all, not whether media is loaded — a freshly
     * launched receiver with nothing playing is alive and must not be torn down.
     */
    private castLinkAlive(): Promise<boolean> {
        return new Promise((resolve) => {
            const player = this.castPlayer;
            if (!player) {
                resolve(false);
                return;
            }
            let settled = false;
            const done = (alive: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(alive);
                }
            };
            // A torn-down receiver doesn't refuse — it never answers. The timeout IS
            // the answer.
            const timer = setTimeout(() => done(false), 3000);
            try {
                player.getStatus((err) => {
                    clearTimeout(timer);
                    done(!err);
                });
            } catch {
                clearTimeout(timer);
                done(false);
            }
        });
    }

    /**
     * Is the media session we hold still real? `castPlayer` is just an object — it stays
     * valid-looking long after the device has closed the receiver app, so anything that
     * resumes playback has to ask rather than assume. A false negative is harmless: the
     * caller reloads from `lastPositionMs`, which is the right recovery either way.
     */
    private castSessionAlive(): Promise<boolean> {
        return new Promise((resolve) => {
            const player = this.castPlayer;
            if (!player) {
                resolve(false);
                return;
            }
            let settled = false;
            const done = (alive: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(alive);
                }
            };
            // A dead session usually answers nothing at all, so the timeout IS the answer.
            const timer = setTimeout(() => done(false), 3000);
            try {
                player.getStatus((err, status) => {
                    clearTimeout(timer);
                    done(!err && !!status?.media && status.playerState !== 'IDLE');
                });
            } catch {
                // castv2 throws synchronously on a dead socket.
                clearTimeout(timer);
                done(false);
            }
        });
    }

    /**
     * Worbus P2: judge a status against what this bridge owns (foreign-session.ts). Taken while
     * playing, the speaker is reported released; taken while not, the player is only let go.
     * Either way that session is never adopted. Returns whether the status was someone else's.
     */
    private checkTakeover(status: CastStatusLike | null | undefined): boolean {
        if (!this.castPlayer && !this.castClient) return false;
        const step = takeoverStep(status, this.ownCast(), {
            loading: this.loadInFlight !== null,
            playing: this.playing,
        });
        if (step === 'none') return false;
        if (
            typeof status?.mediaSessionId === 'number' &&
            status.mediaSessionId !== this.ownMediaSessionId
        ) {
            this.foreignMediaSessions.add(status.mediaSessionId);
        }
        if (step === 'release') {
            this.releaseTakenSpeaker();
        } else {
            log.info(
                `[cast-bridge] ${this.friendlyName}: another session is on the speaker - letting go of it`,
            );
            this.teardownCast();
        }
        return true;
    }

    /**
     * Re-take the active slot after adopting an orphaned session. A `report` from a device
     * the hub doesn't consider active is dropped on the floor, so the bridge has to speak
     * the one frame that promotes an idle slot: `setQueue`. It republishes the session's
     * own queue and saved-queue id (so no history record forks) at the position the speaker
     * is actually at.
     */
    private claimActive(): void {
        this.send({
            action: 'setQueue',
            index: this.index,
            // The hub applies this flag to the WHOLE session and re-loads the active device with
            // it (hub.py `_on_act`), so it must be what the speaker is actually doing. The only
            // caller sets `playing` from the live receiver status immediately above.
            play: this.playing,
            positionMs: this.lastPositionMs,
            savedQueueId: this.sessionMeta.savedQueueId,
            sourceKind: this.sessionMeta.sourceKind,
            sourceName: this.sessionMeta.sourceName,
            t: 'act',
            tracks: this.tracks,
        });
        log.info(
            `[cast-bridge] ${this.friendlyName}: claimed the idle active slot ` +
                `(index=${this.index}, ${this.lastPositionMs}ms)`,
        );
    }

    /**
     * Run a castv2 command and report whether it actually reached the device.
     *
     * Every one of these used to be fire-and-forget (`castPlayer?.pause(noop)`), with the
     * bridge then reporting the new state as fact. Three ways that lies: the optional
     * chain swallows a null player entirely, castv2 throws *synchronously* on a dead
     * socket, and a live socket to a gone receiver simply never calls back. All three
     * produce "the hub thinks it happened" — the exact shape of the bug where the player
     * reads paused/seeked and the speaker is doing something else.
     */
    private commandLanded(invoke: (cb: (err?: Error | null) => void) => unknown): Promise<boolean> {
        return new Promise((resolve) => {
            let settled = false;
            const done = (ok: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(ok);
                }
            };
            const timer = setTimeout(() => done(false), 3000);
            try {
                const issued = invoke((err) => {
                    clearTimeout(timer);
                    done(!err);
                });
                // An optional-chained call on a null player returns undefined without
                // ever invoking the callback — that is a miss, not a pending command.
                if (issued === undefined && !this.castPlayer && !this.castClient) {
                    clearTimeout(timer);
                    done(false);
                }
            } catch {
                clearTimeout(timer);
                done(false);
            }
        });
    }

    private connectCast(): Promise<import('castv2-client').CastPlayer> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            let settled = false;
            const fail = (err: Error) => {
                // Close OUR client, not the bridge's session. This used to call teardownCast(),
                // which nulls the shared castClient/castPlayer, clears `playing` and now announces
                // the app gone — so a failed attempt demolished whatever session the bridge
                // actually held. Nothing is adopted until the launch callback below succeeds, so
                // there is never anything of the bridge's to tear down from here.
                try {
                    client.close();
                } catch {
                    /* ignore */
                }
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            };
            const timeout = setTimeout(() => fail(new Error('cast connect timeout')), 12_000);
            client.on('error', (err) => {
                log.error(`[cast-bridge] ${this.friendlyName}: cast error`, err);
                // A connect that times out or is refused usually means the address we
                // cached at discovery is no longer where this device lives (DHCP moved it
                // while we held the old one — mDNS only ever told us once). Re-query so
                // the manager can hand us the new address; retrying this one can't work.
                requeryCastDevices();
                fail(err);
            });
            // Bound to THIS client, so it has to check it is still the one the bridge adopted:
            // an abandoned attempt's close would otherwise tear down the live session.
            client.on('close', () => {
                if (this.castClient === client) this.onCastSocketClosed();
            });
            log.info(`[cast-bridge] ${this.friendlyName}: connecting to ${this.host}:${this.port}`);
            client.connect({ host: this.host, port: this.port }, () => {
                this.launchOrJoin(client).then(
                    (player) => {
                        clearTimeout(timeout);
                        settled = true;
                        resolve(this.adoptPlayer(client, player));
                    },
                    (err) => {
                        clearTimeout(timeout);
                        fail(err as Error);
                    },
                );
            });
        });
    }

    private connectHub(): void {
        if (this.destroyed) return;
        // Worbus P3 (design §6.3): the main socket's address, read at each dial - the one address
        // whose `/hub/info` named this server. Without a live main socket there is none: wait
        // (M2: the main socket opening cuts the wait, `addressReady`). Read first: the bearer (an
        // older server's token) is judged at the active address.
        const hubUrl = getHubActiveAddress();
        if (!hubUrl) {
            log.info(`[cast-bridge] ${this.friendlyName}: no live hub address yet - waiting`);
            this.waitingForAddress = true;
            this.scheduleReconnect();
            return;
        }
        this.waitingForAddress = false;
        if (!hubAuth.bearer()) {
            // Worbus P2: nothing to say hello with (signed out, never signed in, the token retired).
            // A hello without a credential is only refused with 4005; the `settings` event
            // rebuilds every bridge when a credential arrives.
            log.info(`[cast-bridge] ${this.friendlyName}: no hub credential - not connecting`);
            return;
        }
        let ws: WebSocket;
        try {
            ws = new WebSocket(hubUrl);
        } catch {
            this.scheduleReconnect();
            return;
        }
        this.ws = ws;

        // Every handler below is bound to THIS socket but mutates state shared by the bridge, so
        // each one checks it is still the current socket first. The hub closes the PREVIOUS socket
        // with 4003 on any re-registration of a device id (hub.py `_register`), which means a stale
        // `close` fires in the ordinary reconnect case. Unguarded it set `standingDown` and nulled
        // `this.ws` while the replacement was live — after which send() dropped every outbound
        // frame (`loaded`, `released`, `report`, `deviceState`) while inbound `do:*` kept running.
        // A dropped `loaded` is indistinguishable to the hub from a load that failed.
        const isCurrent = () => ws === this.ws;

        ws.on('open', () => {
            if (!isCurrent()) return;
            log.info(`[cast-bridge] ${this.friendlyName}: registered with hub`);
            // Reset the backoff only once the connection has PROVEN itself. Doing it here
            // unconditionally made an accept-then-evict cycle read as a success, so the
            // exponential backoff never engaged.
            if (this.backoffResetTimer) clearTimeout(this.backoffResetTimer);
            this.backoffResetTimer = setTimeout(() => {
                this.backoffResetTimer = null;
                this.backoffMs = INITIAL_BACKOFF_MS;
            }, BACKOFF_RESET_AFTER_MS);
            this.hubAlive = true;
            this.startHeartbeat();
            // Worbus P2: the bridging device's own credential, and `bridgedBy` its hub id - the
            // one the sign-in answered with - so the hub puts this speaker in this user's space.
            this.send(
                castHelloFrame({
                    bridgedBy: getHubDeviceId(),
                    castId: this.deviceId,
                    credential: hubAuth.helloCredential(),
                    kind: this.kind,
                    name: this.friendlyName,
                }),
            );
            this.startReachability();
        });
        ws.on('pong', () => {
            if (!isCurrent()) return;
            this.hubAlive = true;
        });
        ws.on('message', (data) => {
            if (!isCurrent()) return;
            try {
                const msg = JSON.parse(data.toString());
                if (msg.t === 'do') {
                    void this.handleDo(msg);
                } else if (msg.t === 'welcome') {
                    // Fresh connection: allow one re-adoption attempt, then
                    // evaluate the session the hub just handed us.
                    this.adopted = false;
                    this.adoptSkipLogged = '';
                    // The hub's row may hold a level it was told while this socket was
                    // away. Say the speaker's own again - but only one heard on a
                    // connection still held: an older one may no longer be true.
                    this.volumeReport = NO_LEVEL_REPORT;
                    this.volumeToldAt = null;
                    if (this.castClient) this.reportVolume();
                    this.maybeAdopt(msg.session);
                } else if (msg.t === 'session') {
                    this.maybeAdopt(msg);
                }
            } catch {
                /* bad frame */
            }
        });
        ws.on('close', (code) => {
            if (!isCurrent()) return;
            this.stopReachability();
            if (code === SUPERSEDED_CODE) {
                // Another client bridges this speaker. Stand down rather than
                // claim it back — whoever is holding it now is serving the user
                // just as well, and taking turns every second serves nobody.
                log.warn(
                    `[cast-bridge] ${this.friendlyName}: superseded by another bridge — ` +
                        `standing down for ${STAND_DOWN_MS / 60000} min`,
                );
                this.standingDown = true;
                this.standDownUntil = Date.now() + STAND_DOWN_MS;
                this.scheduleReconnect(STAND_DOWN_MS);
                return;
            }
            if (REFUSED_CODES.has(code)) {
                log.warn(
                    `[cast-bridge] ${this.friendlyName}: the hub refused this device's credential ` +
                        `(${code}) - waiting for it to change`,
                );
                this.ws = null;
                this.stopHeartbeat();
                return;
            }
            log.warn(`[cast-bridge] ${this.friendlyName}: hub connection closed (${code})`);
            this.scheduleReconnect();
        });
        ws.on('error', (err) => {
            if (!isCurrent()) return;
            log.error(`[cast-bridge] ${this.friendlyName}: hub connection error`, err.message);
        });
    }

    /**
     * A live cast session, building one if needed — and never more than one at a time.
     *
     * The serialization is the point: see [castSetup].
     */
    private ensureCast(): Promise<import('castv2-client').CastPlayer> {
        if (this.castSetup) return this.castSetup;
        const attempt = this.buildCastSession().finally(() => {
            if (this.castSetup === attempt) this.castSetup = null;
        });
        this.castSetup = attempt;
        return attempt;
    }

    private async handleDo(msg: any): Promise<void> {
        // Logged unconditionally, as Worbus for Android's bridge already does: when a transfer misbehaves the
        // first thing worth knowing is what the hub actually asked for and how many times. Two
        // `load`s 150 ms apart and one `load` that took two attempts look identical without this.
        log.info(`[cast-bridge] ${this.friendlyName}: do ${msg.cmd}`);
        try {
            switch (msg.cmd) {
                case 'jump':
                    this.index = msg.index ?? 0;
                    await this.loadCurrent(0, true);
                    break;
                case 'load': {
                    this.releasing = false;
                    this.tracks = msg.tracks ?? [];
                    this.index = msg.index ?? 0;
                    // PROTOCOL §7.1-7.2: the loader answers it with `loaded`.
                    await this.loadCurrent(msg.positionMs ?? 0, msg.play !== false, msg);
                    break;
                }
                case 'pause':
                    // Only claim paused if the pause actually reached the device. Reporting
                    // it regardless told the hub — and every client — that a command had
                    // landed which may never have left this process.
                    if (await this.commandLanded((cb) => this.castPlayer?.pause(cb))) {
                        this.playing = false;
                        this.report();
                    } else {
                        log.warn(
                            `[cast-bridge] ${this.friendlyName}: pause did not reach the device`,
                        );
                        // Only tear down a session we actually hold. With no player there is
                        // nothing to drop, and doing it anyway wrecked an in-flight build: a
                        // `do:pause` arriving mid-load nulled the client the builder was about
                        // to adopt and cleared `playing` under it.
                        if (this.castPlayer) this.teardownCast();
                        this.playing = false;
                        this.report();
                    }
                    break;
                case 'play':
                    // A Chromecast tears its receiver app down after a few idle minutes,
                    // and our player object happily survives that: play() went into the
                    // void while we reported playback that made no sound, with no way back
                    // short of switching devices. Prove the session is still there first,
                    // and rebuild it from the last known position when it isn't.
                    // And PLAY itself has to land, like pause and seek below: a
                    // fire-and-forget play() reported as fact is the same lie one level
                    // down, and the speaker's next status flipped the hub back to paused
                    // a beat later — the play/pause oscillation, made here.
                    if (
                        this.castPlayer &&
                        (await this.castSessionAlive()) &&
                        (await this.commandLanded((cb) => this.castPlayer?.play(cb)))
                    ) {
                        this.playing = true;
                        this.report();
                    } else if (this.loadInFlight) {
                        // A load is already building this exact session. Starting a second one
                        // is how a `do:play` arriving mid-transfer loaded the same track at a
                        // *stale* `lastPositionMs` — 128s where the transfer had asked for 141s
                        // — and the later LOAD won. Let the one in progress finish.
                        log.info(
                            `[cast-bridge] ${this.friendlyName}: play while a load is in ` +
                                'flight — waiting for it instead of starting another',
                        );
                        await this.loadInFlight;
                    } else if (this.tracks.length) {
                        if (this.castPlayer) {
                            log.info(
                                `[cast-bridge] ${this.friendlyName}: cast session went away while ` +
                                    'paused — reloading from the last position',
                            );
                            this.teardownCast();
                        }
                        await this.loadCurrent(this.lastPositionMs, true);
                    }
                    break;
                case 'queueChanged': {
                    const currentId = this.tracks[this.index]?.id;
                    this.tracks = msg.tracks ?? [];
                    const newIndex = this.tracks.findIndex((track) => track.id === currentId);
                    this.index = newIndex >= 0 ? newIndex : (msg.index ?? 0);
                    break;
                }
                case 'release':
                    // Freeze all reporting first: the stop() below makes the
                    // device emit IDLE/CANCELLED with currentTime=0, and a
                    // late ticker/status report of 0 racing the hub's device
                    // switch is what reset transfers to the beginning.
                    this.releasing = true;
                    // B-106: a load still out for this speaker must not start it after this.
                    this.loader.release(msg.transferId);
                    this.stopTicker();
                    await this.capturePosition();
                    this.playing = false;
                    this.report();
                    // The released frame carries the authoritative final
                    // position — the hub applies it atomically.
                    this.send({
                        index: this.index,
                        positionMs: this.lastPositionMs,
                        t: 'released',
                        // §7.2 (`transferAckV2`): the handoff this release belongs to.
                        transferId: msg.transferId,
                    });
                    // PAUSE, not STOP. Releasing means "stop making sound", and pause does
                    // that — while STOP ends the media session and takes the receiver app
                    // down with it, which is a far bigger commitment than the handshake
                    // needs and turns out to be the thing that breaks casting back.
                    //
                    // Measured, across four sessions of logs: every LAUNCH that followed a
                    // release-with-stop was answered `LAUNCH_ERROR: CANCELLED`, and every
                    // LAUNCH with no stop before it succeeded. Whatever state STOP leaves the
                    // device in, it does not accept a new launch out of it — 9 s later, 12 s
                    // later, on a fresh socket, retried: all cancelled. Leaving the app up
                    // sidesteps the launch entirely, because the next `do:load` finds a live
                    // session and simply loads into it (which is what the runs that DID work
                    // were doing). The speaker idles the app out by itself eventually, and a
                    // launch after a genuinely quiet stretch is the case that works.
                    //
                    // Still isolated: these throw synchronously inside castv2 when no media
                    // session is active (the last load failed → IDLE/ERROR, so there is no
                    // mediaSessionId), and the throw must not skip resetting `releasing` —
                    // that would freeze reporting on this bridge for good.
                    try {
                        this.castPlayer?.pause(noop);
                    } catch (pauseError) {
                        log.warn(
                            `[cast-bridge] ${this.friendlyName}: pause on release skipped (no active media session)`,
                            pauseError,
                        );
                    }
                    this.releasing = false;
                    break;
                case 'seek': {
                    const target = msg.positionMs ?? 0;
                    // The position used to be recorded whether or not the seek landed, so
                    // the hub could hold — and hand to the next device — a position the
                    // speaker had never been at. If it didn't land, reload there instead:
                    // that IS where the user asked to be.
                    if (
                        await this.commandLanded((cb) => this.castPlayer?.seek(target / 1000, cb))
                    ) {
                        this.lastPositionMs = target;
                    } else {
                        log.warn(
                            `[cast-bridge] ${this.friendlyName}: seek did not reach the device — reloading`,
                        );
                        // teardownCast() clears `playing`, so capture it first — otherwise the
                        // reload below always passes play:false and a failed seek silently
                        // pauses the session. Same capture as onCastSocketClosed and the ticker.
                        const wasPlaying = this.playing;
                        this.teardownCast();
                        await this.loadCurrent(target, wasPlaying);
                    }
                    break;
                }
                case 'setVolume': {
                    const level = Number(msg.level ?? 100) / 100;
                    if (Number.isFinite(level)) {
                        await this.applyVolume(Math.min(1, Math.max(0, level)));
                    }
                    break;
                }
                default:
                    break;
            }
        } catch (error) {
            log.error(`[cast-bridge] ${this.friendlyName}: ${msg.cmd} failed`, error);
        }
    }

    private launchOrJoin(client: Client): Promise<import('castv2-client').CastPlayer> {
        return new Promise((resolve, reject) => {
            client.getSessions((err, sessions) => {
                if (err) {
                    reject(err);
                    return;
                }
                const running = (sessions ?? []).find(
                    (session) => session.appId === DEFAULT_MEDIA_RECEIVER_APP_ID,
                );
                if (running) {
                    client.join(running, DefaultMediaReceiver, (joinErr, player) => {
                        if (joinErr || !player) {
                            reject(joinErr ?? new Error('join failed'));
                            return;
                        }
                        log.info(
                            `[cast-bridge] ${this.friendlyName}: joined the running media receiver`,
                        );
                        this.noteOwnApp(running.sessionId);
                        resolve(player);
                    });
                    return;
                }
                client.launch(DefaultMediaReceiver, (launchErr, player) => {
                    if (launchErr || !player) {
                        // Deliberately no retry. Across four sessions of logs not one retry
                        // ever succeeded — at 1.1 s, 2.4 s, 2.6 s or 3.4 s after the first
                        // refusal — while it spent 3 s of the hub's 10 s LOAD_TIMEOUT and
                        // delayed the honest `loaded {ok:false}`. Failing fast is worth more
                        // than a retry with no observed success.
                        //
                        // Log what the receiver says instead. Why it cancels is still not
                        // established, and this is the state nobody has looked at yet:
                        // `applications` (the backdrop counts as one), `isStandBy`,
                        // `isActiveInput`.
                        this.logReceiverState(client, 'after a cancelled launch');
                        reject(launchErr ?? new Error('launch failed'));
                        return;
                    }
                    log.info(`[cast-bridge] ${this.friendlyName}: media receiver launched`);
                    this.noteOwnApp(
                        (player as unknown as { session?: { sessionId?: string } }).session
                            ?.sessionId,
                    );
                    resolve(player);
                });
            });
        });
    }

    /**
     * @returns whether the speaker actually started (PROTOCOL §7.1's `loaded.ok`). `hubLoad`: the
     * hub's `do:load` this serves, which the loader answers.
     */
    private loadCurrent(
        positionMs: number,
        play: boolean,
        hubLoad?: { timeoutMs?: unknown; transferId?: unknown },
    ): Promise<boolean> {
        const attempt = this.loadCurrentOnce(positionMs, play, hubLoad).finally(() => {
            if (this.loadInFlight === attempt) this.loadInFlight = null;
        });
        this.loadInFlight = attempt;
        return attempt;
    }

    private async loadCurrentOnce(
        positionMs: number,
        play: boolean,
        hubLoad: undefined | { timeoutMs?: unknown; transferId?: unknown },
    ): Promise<boolean> {
        const sendLoad = this.loadSender(positionMs, play);
        const result = hubLoad
            ? await this.loader.hubLoad(hubLoad, sendLoad)
            : sendLoad
              ? await this.loader.reload(sendLoad)
              : 'failed';
        if (result === 'abandoned') return false;
        if (result === 'failed') {
            // Out of options — the device is unreachable (asleep, moved to another
            // address, off the network), or there was nothing to load. Say so instead of
            // throwing to a caller that only logs: leaving `playing` true made every client
            // show a playing bar for a speaker that was silent, and the scrubber ran on a ghost.
            if (sendLoad) {
                this.playing = false;
                this.report();
            }
            return false;
        }
        this.lastPositionMs = positionMs;
        this.playing = play;
        this.report();
        this.startTicker();
        return true;
    }

    /** LOAD of the current track at `positionMs` for the loader; null when there is none. */
    private loadSender(
        positionMs: number,
        play: boolean,
    ): null | SendLoad<import('castv2-client').CastPlayer> {
        const track = this.tracks[this.index];
        if (!track) return null;
        if (!track.streamUrl) {
            log.error(
                `[cast-bridge] ${this.friendlyName}: track "${track.title}" has no streamUrl — ` +
                    'the queue was published by an older client; start playback again on the ' +
                    'sending device to republish it',
            );
            return null;
        }
        log.info(
            `[cast-bridge] ${this.friendlyName}: loading "${track.title}" ` +
                `(${track.mime ?? 'audio/mpeg'}) @ ${positionMs}ms ` +
                `[id ${logSafeStreamId(track.streamUrl)}]`,
        );
        const media = {
            contentId: track.streamUrl,
            contentType: track.mime || 'audio/mpeg',
            metadata: {
                albumName: track.album ?? '',
                artist: track.artist ?? '',
                images: track.imageUrl ? [{ url: track.imageUrl }] : [],
                metadataType: 3,
                title: track.title ?? '',
                type: 0,
            },
            streamType: 'BUFFERED',
        };
        return (target, answer) => {
            target.load(
                media,
                { autoplay: play, currentTime: positionMs / 1000 },
                (err, status) => {
                    if (!err) {
                        log.info(
                            `[cast-bridge] ${this.friendlyName}: load ok → ` +
                                `${status?.playerState ?? 'no status'}`,
                        );
                        // Worbus P2: the media session this LOAD started is this bridge's.
                        if (typeof status?.mediaSessionId === 'number') {
                            this.ownMediaSessionId = status.mediaSessionId;
                        }
                    }
                    answer(err);
                },
            );
        };
    }

    /**
     * Get a media receiver on this connection: JOIN the running one, LAUNCH only if there isn't.
     *
     * The distinction is the whole bug. `client.launch()` on an app that is **already running** is
     * answered `LAUNCH_ERROR: CANCELLED` — the receiver cancels the redundant launch — and the
     * bridge had no way to tell that apart from "the speaker refused me". It got there because the
     * liveness probe asks the *media* namespace on a `transportId` from the previous session: when
     * the app restarts that id is dead while `CC1AD845` itself is alive and well, so the probe says
     * "session dead", we LAUNCH, and the device cancels it — every time, for as long as the app
     * keeps running. Which is why it failed persistently rather than transiently, and why the
     * ~1.2 s to the refusal was identical to the ~1.2 s of a successful launch: the device was not
     * racing anything, it was answering.
     *
     * Worbus for Android's bridge has always done this (`CastChannel.launchOrJoin`); Worbus for desktop only ever joined on
     * the separate adoption path, and this load path went straight to LAUNCH.
     *
     * Joining a session that isn't ours is fine here: this runs for an explicit `do:load`, and the
     * LOAD that follows takes the session over anyway. The ownership check belongs to adoption,
     * which is speculative — this is the user asking.
     */
    /**
     * Dump what the receiver believes about itself. Diagnostic only — never gates anything.
     *
     * Three theories about the refusal have now been wrong, and each was wrong because it reasoned
     * about the device's state instead of reading it. This reads it.
     */
    private logReceiverState(client: Client, when: string): void {
        try {
            client.getStatus((err, status) => {
                if (err) {
                    log.warn(
                        `[cast-bridge] ${this.friendlyName}: receiver status ${when} ` +
                            `unavailable (${err.message})`,
                    );
                    return;
                }
                log.info(
                    `[cast-bridge] ${this.friendlyName}: receiver status ${when}: ` +
                        JSON.stringify(status),
                );
            });
        } catch {
            /* diagnostics must never throw into the caller */
        }
    }

    /**
     * If the hub says THIS cast device is the active receiver but we hold no
     * cast session (e.g. Worbus for desktop was restarted while the Chromecast kept
     * playing on its own), try to re-join the running session instead of
     * leaving the device orphaned. Bootstraps the queue/index from the hub
     * session so auto-advance, release/stop and live reporting all work again.
     */
    private maybeAdopt(session: any): void {
        if (!session) return;
        if (this.adopted || this.castPlayer) {
            this.noteAdoptSkip(
                this.castPlayer ? 'already holding a cast session' : 'already adopted',
                session,
            );
            return;
        }
        const stillOurs = session.activeDeviceId === this.hubDeviceId;
        // No live receiver at all. This is the ordinary shape of "Worbus for desktop restarted while
        // the speaker kept playing": the bridge lives IN Worbus for desktop's main process, so its
        // socket died with the app, and the hub relinquishes the active slot whenever the
        // active device drops. Gating adoption on the hub still naming us active therefore
        // never fired in the one case it was written for — the session was left orphaned
        // and every client treated a speaker that was audibly still playing as stopped.
        // Claiming from the orphan slot has to be earned, though: we only take it if the
        // device is really playing a track from THIS session (see the contentId check).
        const orphaned = session.activeDeviceId == null && (session.queue?.length ?? 0) > 0;
        if (!stillOurs && !orphaned) {
            this.noteAdoptSkip(
                session.activeDeviceId == null
                    ? 'nothing active and no queue'
                    : 'another device is active',
                session,
            );
            return;
        }
        this.adopted = true;
        this.tracks = session.queue ?? [];
        this.index = session.index ?? 0;
        this.lastPositionMs = session.positionMs ?? 0;
        this.sessionMeta = {
            savedQueueId: session.savedQueueId ?? undefined,
            sourceKind: session.sourceKind ?? undefined,
            sourceName: session.sourceName ?? undefined,
        };
        void this.adoptRunningSession(!stillOurs);
    }

    /**
     * B-047 diagnostics: Worbus for desktop didn't pick a cast back up after a restart, and the one
     * branch that says nothing is a skip here. Logged once per distinct reason (this runs
     * on every `session` frame), with what the hub said.
     */
    private noteAdoptSkip(reason: string, session: any): void {
        const key = `${reason}|${session.activeDeviceId ?? ''}`;
        if (key === this.adoptSkipLogged) return;
        this.adoptSkipLogged = key;
        log.info(
            `[cast-bridge] ${this.friendlyName}: not adopting (${reason}) — hub active=` +
                `${session.activeDeviceId ?? 'none'} us=${this.hubDeviceId} ` +
                `queue=${session.queue?.length ?? 0} playing=${session.isPlaying ?? '?'}`,
        );
    }

    // ---------------------------------------------------------------- cast

    /** A new receiver app session of this bridge's own: any media session id is yet to come. */
    private noteOwnApp(sessionId: string | undefined): void {
        this.ownAppSessionId = sessionId ?? null;
        this.ownMediaSessionId = null;
    }

    /**
     * The speaker said its volume: a RECEIVER_STATUS broadcast (somebody turned it at the
     * device, or from another app), or the answer to a request of ours.
     */
    private noteReceiverVolume(volume: unknown): void {
        const level = receiverLevel(volume);
        if (level === null) return;
        this.receiverVolume = level;
        this.reportVolume();
    }

    /**
     * The device closed our connection (idle timeout, receiver app replaced by another
     * sender, network blip). Drop the stale session so nothing talks into the void, and if
     * we were playing, try to re-join — the speaker may well still be playing, either on
     * its own or because someone resumed it from the Google Home app.
     */
    private onCastSocketClosed(): void {
        if (this.destroyed || this.tearingDown || this.releasing || !this.castClient) return;
        log.warn(`[cast-bridge] ${this.friendlyName}: cast connection closed by the device`);
        const wasPlaying = this.playing;
        this.teardownCast();
        if (wasPlaying) this.tryReadoptAfterDrop();
    }

    private onCastStatus(status: import('castv2-client').CastMediaStatus): void {
        if (this.releasing) return;
        // Worbus P2: another user's session on this speaker is not ours to report or drive.
        if (this.checkTakeover(status)) return;
        log.info(
            `[cast-bridge] ${this.friendlyName}: status ${status.playerState ?? '?'}` +
                `${status.idleReason ? `/${status.idleReason}` : ''}` +
                ` t=${status.currentTime ?? '?'} dur=${status.media?.duration ?? '?'}`,
        );
        if (status.playerState === 'IDLE' && status.idleReason === 'ERROR') {
            log.error(
                `[cast-bridge] ${this.friendlyName}: playback error (likely unsupported ` +
                    'format or unreachable streamUrl)',
            );
        }
        // Adopt the device's real position, but ignore currentTime=0 — Cast
        // devices transiently report 0 while (re)buffering, and a 0 landing
        // just before a pause is what intermittently reset the progress bar.
        if (typeof status.currentTime === 'number' && status.currentTime > 0) {
            this.lastPositionMs = Math.round(status.currentTime * 1000);
        }
        if (status.playerState === 'PLAYING') {
            this.playing = true;
            this.report();
        } else if (status.playerState === 'PAUSED') {
            this.playing = false;
            this.report();
        } else if (status.playerState === 'IDLE' && status.idleReason === 'FINISHED') {
            // Local auto-advance, like any real receiver.
            if (this.index < this.tracks.length - 1) {
                this.index += 1;
                void this.loadCurrent(0, true);
            } else {
                this.playing = false;
                this.lastPositionMs = 0;
                this.report({ ended: true });
            }
        }
    }

    private ownCast(): OwnCast {
        return {
            appSessionId: this.ownAppSessionId,
            foreignMediaSessions: this.foreignMediaSessions,
            mediaSessionId: this.ownMediaSessionId,
            queueIds: this.tracks
                .map((track) => streamIdentity(track.streamUrl))
                .filter((id): id is string => !!id),
        };
    }

    private async probeReachability(): Promise<void> {
        if (this.destroyed) return;
        const ok = await this.speakerReachable();
        if (this.destroyed) return;
        if (ok) {
            this.probeFailures = 0;
        } else {
            this.probeFailures += 1;
        }
        // An open cast socket is proof enough on its own — don't let a probe that lost a
        // packet contradict a speaker we are actively talking to.
        const reachable =
            ok || !!this.castClient || this.probeFailures < REACHABILITY_FAILS_BEFORE_DOWN;
        if (reachable !== this.reachable) {
            log.info(`[cast-bridge] ${this.friendlyName}: reachable → ${reachable}`);
        }
        this.reachable = reachable;
        // Re-asserted every tick, not only on change: the hub expires a verdict whose
        // bridge has gone quiet rather than keep speaking for it (§3.2).
        this.send({
            appRunning: !!this.castPlayer,
            reachable,
            t: 'deviceState',
        });
    }

    /**
     * Start a fresh receiver session on the connection we already have.
     *
     * Returns null if we have no client, it refuses, or it doesn't answer in time — all of which
     * mean the caller has to build a connection from scratch.
     */
    private relaunchOnCurrentClient(): Promise<import('castv2-client').CastPlayer | null> {
        return new Promise((resolve) => {
            const client = this.castClient;
            if (!client) {
                resolve(null);
                return;
            }
            let settled = false;
            const done = (player: import('castv2-client').CastPlayer | null) => {
                if (!settled) {
                    settled = true;
                    resolve(player);
                }
            };
            // Bounded tightly: this is the optimistic path, and the whole load still has to
            // answer `loaded` inside the hub's 10 s LOAD_TIMEOUT (§7.1).
            const timer = setTimeout(() => done(null), RELAUNCH_TIMEOUT_MS);
            try {
                this.launchOrJoin(client).then(
                    (player) => {
                        clearTimeout(timer);
                        done(this.adoptPlayer(client, player));
                    },
                    (err: Error) => {
                        clearTimeout(timer);
                        log.info(
                            `[cast-bridge] ${this.friendlyName}: could not get a receiver on the ` +
                                `existing connection (${err?.message ?? 'no player'}) — ` +
                                'reconnecting',
                        );
                        done(null);
                    },
                );
            } catch {
                // castv2 throws synchronously on a dead socket.
                clearTimeout(timer);
                done(null);
            }
        });
    }

    /**
     * Someone else cast to this speaker while this bridge was playing (the last caster wins).
     * Report it released, as a `do:release` would: a paused report, then `released` with the last
     * position this bridge itself heard, so the hub clears the active slot and its user's session
     * pauses where they were. Never pause or stop - that is the other user's music now.
     */
    private releaseTakenSpeaker(): void {
        log.info(
            `[cast-bridge] ${this.friendlyName}: the speaker was taken by another session - ` +
                'reporting it released',
        );
        this.releasing = true;
        this.stopTicker();
        this.playing = false;
        this.report();
        this.send({
            index: this.index,
            positionMs: this.lastPositionMs,
            t: 'released',
            transferId: this.loader.lastReleaseId(),
        });
        this.teardownCast();
        this.releasing = false;
    }

    private report(extra?: Record<string, unknown>): void {
        this.send({
            index: this.index,
            isPlaying: this.playing,
            positionMs: this.lastPositionMs,
            t: 'report',
            ...extra,
        });
    }

    /**
     * Tell the hub the speaker's volume, as `deviceState {volume}` through this bridge's own
     * socket (it IS the speaker's device there). The hub keeps it as the row's level and
     * broadcasts only when it changed. Whether a frame goes out now is level-report.ts's rule:
     * the level last sent is not repeated, a speaker being turned by hand sends at most four a
     * second, the level it stops on included, and a level the hub told it waits until the
     * telling has stopped.
     */
    private reportVolume(): void {
        if (this.volumeReportTimer) {
            clearTimeout(this.volumeReportTimer);
            this.volumeReportTimer = null;
        }
        if (this.receiverVolume === null || !this.isRegistered) return;
        const now = Date.now();
        const step = levelReportStep(
            this.volumeReport,
            this.receiverVolume,
            now,
            this.volumeToldAt,
        );
        if (step === null) return;
        if (step === 'send') {
            this.volumeReport = { at: now, level: this.receiverVolume };
            this.send({ t: 'deviceState', volume: this.receiverVolume });
            return;
        }
        this.volumeReportTimer = setTimeout(() => this.reportVolume(), step);
    }

    /**
     * Wait out the jitter, re-check, then claim — or stay down and wait for the next
     * `devices` frame to tell us the holder let go.
     */
    private scheduleClaim(delayMs?: number): void {
        if (this.destroyed || this.claimTimer || this.ws) return;
        const wait = delayMs ?? Math.random() * CLAIM_JITTER_MS;
        this.claimTimer = setTimeout(() => {
            this.claimTimer = null;
            if (this.destroyed || this.ws) return;
            if (Date.now() < this.standDownUntil) return;
            const step = claimStep(this.arbitrationInput());
            if (step === 'await-registry') {
                // The main hub client has no registry from its current connection: unknown is
                // not "free" (B-107). Its next `devices` event runs reevaluate, which comes back.
                this.awaitingRegistry = { delayMs };
                return;
            }
            if (step === 'stand-down') {
                if (!this.standingDown) {
                    log.info(
                        `[cast-bridge] ${this.friendlyName}: already bridged by another ` +
                            'client — standing down',
                    );
                }
                this.standingDown = true;
                return;
            }
            this.standingDown = false;
            this.connectHub();
        }, wait);
    }

    /** `delayMs` overrides the backoff — used by the superseded stand-down. */
    private scheduleReconnect(delayMs?: number): void {
        this.ws = null;
        this.stopHeartbeat();
        if (this.destroyed || this.reconnectTimer) return;
        const jitter = Math.random() * 0.3 * this.backoffMs;
        const delay = delayMs ?? this.backoffMs + jitter;
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            // Back through arbitration, not straight to connectHub: while we were away
            // another client may have taken the speaker, and reclaiming it blindly is
            // exactly the war the stand-down exists to end.
            this.scheduleClaim(0);
        }, delay);
    }

    private send(obj: unknown): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
            return;
        }
        // A `loaded` or `released` lost here leaves the hub waiting on an answer that will
        // never arrive, so it is worth a line. Reports and heartbeats are not.
        const t = (obj as { t?: string })?.t;
        if (t && t !== 'report' && t !== 'deviceState') {
            log.warn(`[cast-bridge] ${this.friendlyName}: dropped "${t}" — hub socket not open`);
        }
    }

    /**
     * Set the volume of a speaker the bridge holds no connection to, so that it can be turned
     * down before music is sent to it. One at a time per speaker, and the newest level wins:
     * a level that arrives while a connection is open is not queued behind it - the last of
     * them is set next and the ones between are dropped.
     */
    private async setIdleVolume(level: number): Promise<void> {
        this.idleVolumeWanted = level;
        if (this.idleVolumeBusy) return;
        this.idleVolumeBusy = true;
        try {
            while (this.idleVolumeWanted !== null && !this.destroyed) {
                const wanted = this.idleVolumeWanted;
                this.idleVolumeWanted = null;
                // A session came up while this waited its turn: that connection is used.
                if (this.castClient) await this.applyVolume(wanted);
                else await this.setVolumeOnOwnConnection(wanted);
            }
        } finally {
            this.idleVolumeBusy = false;
        }
    }

    /**
     * One connection for one SET_VOLUME: connect (castv2-client CONNECTs to `receiver-0`), send
     * it on the receiver namespace, read the RECEIVER_STATUS that answers, close. No
     * application is launched or joined, so whatever the speaker is doing goes on, and the
     * close ends nothing but this connection - the same open, ask, close the adoption check
     * makes. The answer is the volume the speaker is now at, and goes to the hub as its row's.
     *
     * @returns whether the speaker answered inside the budget.
     */
    private setVolumeOnOwnConnection(level: number): Promise<boolean> {
        return new Promise((resolve) => {
            const client = new Client();
            let settled = false;
            const finish = (why?: string) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                try {
                    client.close();
                } catch {
                    /* ignore */
                }
                if (why !== undefined) {
                    log.warn(
                        `[cast-bridge] ${this.friendlyName}: volume did not reach the idle ` +
                            `device (${why})`,
                    );
                }
                resolve(why === undefined);
            };
            const timeout = setTimeout(() => finish('no answer'), IDLE_VOLUME_TIMEOUT_MS);
            // Attached before connecting: an `error` with no listener is thrown.
            client.on('error', (err) => finish(err.message));
            try {
                client.connect({ host: this.host, port: this.port }, () => {
                    try {
                        client.setVolume({ level }, (err, volume) => {
                            if (!err) this.noteReceiverVolume(volume);
                            finish(err ? err.message : undefined);
                        });
                    } catch (error) {
                        // castv2 throws synchronously when the socket died under it.
                        finish((error as Error).message);
                    }
                });
            } catch (error) {
                finish((error as Error).message);
            }
        });
    }

    /**
     * Can we open a TCP connection to the speaker right now? Deliberately the weakest
     * possible question: it proves the hardware is powered on and on a network we can
     * reach, without touching whatever it happens to be doing. Probing at the castv2
     * level would mean LAUNCHing the receiver app, which would silence a speaker that
     * is happily playing over Bluetooth.
     */
    private speakerReachable(): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let settled = false;
            const done = (ok: boolean) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(ok);
            };
            socket.setTimeout(PROBE_TIMEOUT_MS);
            socket.once('connect', () => done(true));
            socket.once('timeout', () => done(false));
            socket.once('error', () => done(false));
            try {
                socket.connect(this.port, this.host);
            } catch {
                done(false);
            }
        });
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            // No pong since the last tick → half-open socket; kill it so the close
            // handler reconnects instead of the bridge sitting dead-but-registered.
            if (!this.hubAlive) {
                try {
                    this.ws?.terminate();
                } catch {
                    /* ignore */
                }
                return;
            }
            this.hubAlive = false;
            try {
                this.ws?.ping();
            } catch {
                /* ignore */
            }
        }, HEARTBEAT_MS);
    }

    private startReachability(): void {
        this.stopReachability();
        void this.probeReachability();
        this.reachabilityTimer = setInterval(
            () => void this.probeReachability(),
            REACHABILITY_INTERVAL_MS,
        );
    }

    private startTicker(): void {
        if (this.ticker) return;
        this.ticker = setInterval(() => {
            if (!this.playing || !this.castPlayer || this.statusInFlight) return;
            this.statusInFlight = true;
            try {
                this.castPlayer.getStatus((_err, status) => {
                    this.statusInFlight = false;
                    if (this.releasing) return;
                    if (this.checkTakeover(status)) return;
                    // Ignore transient 0 readings during rebuffering (see onCastStatus).
                    if (typeof status?.currentTime === 'number' && status.currentTime > 0) {
                        this.lastPositionMs = Math.round(status.currentTime * 1000);
                        this.report();
                    }
                });
            } catch (error) {
                // castv2 throws SYNCHRONOUSLY ("reading 'send'" of null) when the
                // cast socket has died — previously this surfaced as an uncaught
                // main-process exception and froze live reporting. Drop the dead
                // session and try to re-join the (usually still-playing) cast so
                // the progress bar keeps updating.
                this.statusInFlight = false;
                log.warn(
                    `[cast-bridge] ${this.friendlyName}: status poll failed, dropping dead cast session`,
                    (error as Error).message,
                );
                // teardownCast() clears `playing`, so capture it first to decide
                // whether to try resuming.
                const wasPlaying = this.playing;
                this.teardownCast();
                if (wasPlaying) this.tryReadoptAfterDrop();
            }
        }, 1000);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private stopReachability(): void {
        if (this.reachabilityTimer) clearInterval(this.reachabilityTimer);
        this.reachabilityTimer = null;
    }

    private stopTicker(): void {
        if (this.ticker) clearInterval(this.ticker);
        this.ticker = null;
    }

    private teardownCast(): void {
        this.stopTicker();
        // close() fires the socket's own 'close' — flagged so onCastSocketClosed treats it
        // as ours and doesn't chase a re-adoption of the session we're deliberately dropping.
        this.tearingDown = true;
        try {
            this.castClient?.close();
        } catch {
            /* ignore */
        }
        this.tearingDown = false;
        this.castClient = null;
        this.castPlayer = null;
        this.playing = false;
        this.ownAppSessionId = null;
        this.ownMediaSessionId = null;
        this.announceAppGone();
    }

    // Re-join a Chromecast session that's still playing after our socket dropped,
    // to resume live reporting/control. Guarded so overlapping attempts (and the
    // ticker that adoption restarts) can't spiral; if the cast is truly gone,
    // adoptRunningSession finds no session and quietly does nothing.
    private tryReadoptAfterDrop(): void {
        if (this.reconnectingCast || this.destroyed) return;
        this.reconnectingCast = true;
        void this.adoptRunningSession().finally(() => {
            this.reconnectingCast = false;
        });
    }

    /**
     * Follow the speaker's own volume for as long as `client` is the connection this bridge
     * holds. The receiver broadcasts RECEIVER_STATUS to every sender when its volume changes,
     * whoever changed it; castv2-client raises those as `status` and nothing here used to
     * listen. A broadcast comes only on a change, so the level it is at now is asked for once.
     */
    private watchReceiver(client: Client): void {
        client.on('status', (status) => {
            if (this.castClient !== client) return;
            // Worbus P2: the app session this bridge holds stopped running - another sender.
            if (this.checkTakeover(status)) return;
            this.noteReceiverVolume(status?.volume);
        });
        try {
            client.getStatus((err, status) => {
                if (err || this.castClient !== client) return;
                this.noteReceiverVolume((status as null | { volume?: unknown })?.volume);
            });
        } catch {
            /* castv2 throws synchronously on a dead socket; the next broadcast will say */
        }
    }
}

// ------------------------------------------------------------------ manager

const bridges = new Map<string, CastDeviceBridge>();
let bonjour: InstanceType<typeof Bonjour> | null = null;
let browser: CastBrowser | null = null;
let requeryTimer: NodeJS.Timeout | null = null;
let requeryCount = 0;
let sweepTimer: NodeJS.Timeout | null = null;

// bonjour-service sends ONE query when the browser is created and then relies on the device's own
// periodic announcements, which a Chromecast makes only every couple of minutes. So a single lost
// or too-early query (the Wi-Fi interface not up yet, a switch that drops the first multicast) cost
// ~90s before the speaker appeared. Re-query instead: fast while we're likely still missing
// devices, then a slow keepalive that also picks up anything powered on later. Queries are tiny
// multicast packets and re-discovery is idempotent (`bridges.has` below).
const REQUERY_FAST_MS = 3_000;
const REQUERY_FAST_TRIES = 10;
const REQUERY_SLOW_MS = 60_000;
// Last hub config applied to the bridge manager. The renderer re-pushes saved
// hub settings on every (re)connect; without this guard each push tore down and
// recreated mDNS discovery on a REUSED Bonjour socket, which then failed to send
// the initial active query — so discovery fell back to the device's periodic
// passive announcement (~2 min) instead of finding it in ~1s.
let lastBridgeConfig: null | { credential: number; enabled: boolean; url: string } = null;

/**
 * Ask the network to re-announce itself, now. Called when a bridge can't reach the address
 * it has: the answer carries the device's current address, which is what a bridge that has
 * gone stale needs to hear.
 */
function requeryCastDevices(): void {
    try {
        browser?.update();
    } catch {
        /* discovery is best-effort */
    }
}

function startBridging(): void {
    // P3 (review C2, M2): `enabled` only - the hub address `getHubConfig()` gives is the live socket's, empty
    // before the first open; each bridge waits for that address itself before it dials.
    if (!getHubConfig().enabled) {
        log.info('[cast-bridge] not starting (hub disabled)');
        return;
    }
    if (browser) return;

    log.info('[cast-bridge] starting mDNS discovery for cast devices');
    // Always discover on a FRESH Bonjour instance. Reusing one whose browser was
    // previously stopped left the mDNS socket unable to send the initial query,
    // so discovery silently waited for the device's next passive announcement.
    bonjour = new Bonjour();
    browser = bonjour.find({ type: 'googlecast' }) as unknown as CastBrowser;

    browser.on('up', (service) => {
        const device = serviceToDevice(service);
        log.info(
            `[cast-bridge] mDNS up: ${service.name} → ` +
                (device
                    ? `${device.name} @ ${device.host}:${device.port}`
                    : 'unusable (no IPv4 address)'),
        );
        if (!device) return;
        const existing = bridges.get(device.id);
        if (existing) {
            // Re-discovery is otherwise ignored, which froze each bridge at the address it
            // first saw. Every announcement is a chance to notice the device moved.
            existing.lastSeenAt = Date.now();
            existing.updateHost(device.host, device.port);
            return;
        }
        bridges.set(
            device.id,
            new CastDeviceBridge(device.id, device.name, device.host, device.port, device.kind),
        );
    });
    browser.on('down', (service) => {
        const device = serviceToDevice(service);
        log.info(`[cast-bridge] mDNS down: ${service.name}`);
        if (!device) return;
        bridges.get(device.id)?.destroy();
        bridges.delete(device.id);
    });

    // A bridge used to live until mDNS said `down` — which an unplugged Chromecast never
    // says, because it isn't there to say it. So a speaker seen once on any network kept a
    // healthy hub socket forever, and every client's picker offered it as an online
    // receiver from anywhere in the world. Two independent signals have to agree before we
    // give up on one: mDNS hasn't mentioned it for a while AND it doesn't answer a probe.
    sweepTimer = setInterval(() => {
        const cutoff = Date.now() - MISSING_GRACE_MS;
        bridges.forEach((bridge, id) => {
            if (bridge.lastSeenAt > cutoff || bridge.looksReachable) return;
            log.info(
                `[cast-bridge] ${id}: gone from mDNS for ${MISSING_GRACE_MS / 1000}s and not ` +
                    'answering — dropping the bridge',
            );
            bridge.destroy();
            bridges.delete(id);
        });
    }, BRIDGE_SWEEP_MS);

    requeryCount = 0;
    const requery = (): void => {
        if (!browser) return;
        requeryCount += 1;
        browser.update();
        requeryTimer = setTimeout(
            requery,
            requeryCount < REQUERY_FAST_TRIES ? REQUERY_FAST_MS : REQUERY_SLOW_MS,
        );
    };
    requeryTimer = setTimeout(requery, REQUERY_FAST_MS);
}

function stopBridging(): void {
    if (requeryTimer) clearTimeout(requeryTimer);
    requeryTimer = null;
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
    browser?.stop();
    browser = null;
    bridges.forEach((bridge) => bridge.destroy());
    bridges.clear();
    // Fully release the mDNS socket so the next start gets a clean one.
    bonjour?.destroy();
    bonjour = null;
}

// §12.2 step 2: re-evaluate ownership whenever the registry changes, so a speaker
// released by a client that quit is picked back up without waiting for a restart.
hubEvents.on('devices', () => {
    bridges.forEach((bridge) => bridge.reevaluate());
});

// P3 (M2): the main socket opened on an address - bridges waiting for one dial now.
hubEvents.on('server', (server: { activeAddress: null | string }) => {
    if (!server.activeAddress) return;
    bridges.forEach((bridge) => bridge.addressReady());
});

// `credential` moves on every sign-in, sign-out, server sign-out and token change (hub/index.ts):
// each bridge says hello with the credential and `bridgedBy` it had, so it is rebuilt.
hubEvents.on('settings', (settings: { credential: number; enabled: boolean; url: string }) => {
    const changed =
        !lastBridgeConfig ||
        lastBridgeConfig.enabled !== settings.enabled ||
        lastBridgeConfig.url !== settings.url ||
        lastBridgeConfig.credential !== settings.credential;
    lastBridgeConfig = settings;
    if (!changed) {
        log.info('[cast-bridge] hub settings unchanged — keeping current discovery');
        return;
    }
    log.info(
        `[cast-bridge] hub settings changed (enabled=${settings.enabled}) — restarting discovery`,
    );
    stopBridging();
    if (settings.enabled) startBridging();
});

export const shutdownCastBridge = (): void => {
    stopBridging();
};

/**
 * The hub ids of the cast speakers **this process** is currently bridging.
 *
 * Asked by the renderer to answer one question: when playback is on a Chromecast,
 * is this client the one driving it? Ownership is arbitrated (§12.2 of the
 * protocol — one bridging client per speaker), so the answer designates exactly
 * one client, which is what makes it safe for that client to scrobble on the
 * speaker's behalf. A Chromecast holds no Navidrome credentials and cannot
 * scrobble for itself, and every other client is only watching.
 */
ipcMain.handle('cast-bridged-devices', (): string[] =>
    [...bridges.values()]
        .filter((bridge) => bridge.isRegistered)
        .map((bridge) => bridge.hubDeviceId),
);
