import isElectron from 'is-electron';
import { useCallback, useEffect, useRef } from 'react';

import { api } from '/@/renderer/api';
import { getItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { NO_PINS } from '/@/renderer/features/hub/utils/act-pins';
import { armSeekStep } from '/@/renderer/features/hub/utils/arm-seek';
import {
    type ArmedSeek,
    armedSeekOnTrack,
    armedSeeksAfterRowMove,
    landingSeekFires,
    seekOverArmedSeeks,
} from '/@/renderer/features/hub/utils/armed-seek';
import { useServerKey } from '/@/renderer/features/hub/utils/current-server-key';
import {
    createDirectiveRunner,
    type Handled,
} from '/@/renderer/features/hub/utils/directive-runner';
import {
    DoExit,
    echoDisconnected,
    echoSettled,
    echoWelcome,
    failedLoadExit,
    NO_ECHO,
} from '/@/renderer/features/hub/utils/do-echo';
import { createHubDrivenWindow } from '/@/renderer/features/hub/utils/hub-driven-window';
import { hubFailureMessage } from '/@/renderer/features/hub/utils/hub-failure';
import { currentNavidromeUrls } from '/@/renderer/features/hub/utils/hub-finder-actions';
import {
    accountChange,
    accountKey,
    accountMismatch,
    createAccountFollower,
} from '/@/renderer/features/hub/utils/hub-roles';
import {
    clearLbQueries,
    currentServerUsername,
    reconcileSignIn,
    refreshAuthState,
    signInWithCurrentServer,
    signOutOfServer,
    silentSignIn,
    upgradeFromToken,
} from '/@/renderer/features/hub/utils/hub-signin-actions';
import {
    closeLoad,
    expectLoad,
    loadEnding,
    type LoadExpectation,
    loadProven,
    type PlayerLook,
    reaimLoad,
    reportedPositionMs,
} from '/@/renderer/features/hub/utils/load-outcome';
import {
    adoptClaimDelay,
    GuardWindow,
    isGuardOpen,
    isRunaway,
    lastPlayRequest,
    notePauseRequest,
    notePlayRequest,
} from '/@/renderer/features/hub/utils/play-request';
import {
    isPlayheadRolling,
    notePlayerStatus,
    notePlayheadStep,
    PlayheadRun,
} from '/@/renderer/features/hub/utils/playhead-run';
import {
    publicationFields,
    publicationSignature,
} from '/@/renderer/features/hub/utils/queue-publication';
import {
    pinsAfterFrame,
    releaseActPin,
    sendAct,
} from '/@/renderer/features/hub/utils/remote-queue';
import { placeholderSong, resolveHubTracks } from '/@/renderer/features/hub/utils/resolve-songs';
import { serverKeyMove } from '/@/renderer/features/hub/utils/server-key';
import {
    sleepGuardStep,
    sleepTimerFromFrame,
    sleepTimerOnDisconnect,
} from '/@/renderer/features/hub/utils/sleep-timer';
import {
    adoptLbBotFrame,
    adoptLbBotWelcome,
    applyFillFrame,
    clearLbBotStatus,
    invalidateLbBotOwnership,
    markLbBotUnreachable,
    refreshLbBotOverrides,
    useLbBotLibraryRefresh,
    useLbBotRefusals,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    clearIndexMirrorForHubChange,
    indexMirrorCursor,
    onIndexFrame,
    onLbBotAvailable,
    requestIndexSync,
    useLbBotIndexSync,
} from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import { useActiveFillsStore } from '/@/renderer/features/lbbot/stores/active-fills.store';
import { lbBotModeActions } from '/@/renderer/features/lbbot/stores/lbbot-mode.store';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { engineTakesSeekNow } from '/@/renderer/features/player/hooks/startup-seek';
import {
    retargetStartupSeek,
    withdrawStartupSeek,
} from '/@/renderer/features/player/hooks/use-queue-restore';
import { parseStationCursor } from '/@/renderer/features/player/station/station-logic';
import {
    stationIdForPublish,
    useStationStore,
} from '/@/renderer/features/player/station/station-store';
import {
    consumeQueueSession,
    findMatchingSavedQueueId,
    isNewQueueSessionPending,
    onQueueSessionReset,
    resolveQueueSource,
} from '/@/renderer/features/player/utils/saved-queue-source';
import { isPreviewId, previewHubTrack } from '/@/renderer/features/preview/preview-track';
import {
    isPermutation,
    isShuffleEnabled,
    isTimestampSeek,
    mixesFromHub,
    playingQueueIndex,
    PlayOrderAdopt,
    SavedQueue,
    SavedQueueKind,
    setTimestamp,
    useAuthStore,
    useCurrentServerId,
    useHubSettings,
    useHubStore,
    useMixesStore,
    usePlayerActions,
    usePlayerStore,
    usePlayerStoreBase,
    useSavedQueuesStore,
    useSettingsStore,
    useTimestampStoreBase,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';
import { PlayerRepeat, PlayerShuffle, PlayerStatus, PlayerType } from '/@/shared/types/types';
import { HubSignInResult, parseHubUser } from '/@/shared/utils/hub-signin';
import {
    isProgressOnlyFrame,
    parseProgress,
    stateAfterWelcome,
    tooOldFromLb,
} from '/@/shared/utils/lbbot-mode';
import { levelReportStep, NO_LEVEL_REPORT, toLevel } from '/@/shared/utils/level-report';
import { serverVersionOf } from '/@/shared/utils/version-line';

/**
 * B-053: adopting an orphaned session seeks to the hub's cursor - at launch usually our own
 * last report, rounded to the ms, against the unrounded seconds the timestamp store kept.
 * Logged so a launch shows whether that precondition was there, and whether the persisted
 * queue had hydrated yet (`localQueue: 0` means the hub's queue is loaded over nothing).
 * `local` is the player as the adopt found it, captured before any await: the `load` path
 * spends ~1 s resolving songs, long enough for the persisted queue to hydrate meanwhile.
 * `localSec` is read now, because it is what the coming seek steps away from.
 */
const logAdopt = (
    path: 'align' | 'load',
    session: any,
    targetIndex: number,
    local: { index: number; queue: number },
) => {
    logger.info(`[hub] adopt orphaned session (${path})`, {
        hubIndex: targetIndex,
        hubMs: session?.positionMs ?? 0,
        hubQueue: (session?.queue ?? []).length,
        localIndex: local.index,
        localQueue: local.queue,
        localSec: useTimestampStoreBase.getState().timestamp,
    });
};

/**
 * B-046: point the live session's saved-queue card at the track actually playing. The hub
 * broadcasts `savedQueues` only when a queue is edited, and its own cursor on a record is
 * throttled, so every card read the index of the last edit. Checked against the live queue
 * by id, so a record that doesn't hold the session's tracks is never mis-pointed.
 */
const followSavedQueueCursor = () => {
    const { remoteQueue, remoteQueueIndex, savedQueueId } = useHubStore.getState();
    if (!savedQueueId) return;
    const { actions, queues } = useSavedQueuesStore.getState();
    const entry = queues.find((q) => q.id === savedQueueId);
    const song = entry?.songs[remoteQueueIndex];
    if (!song || song.id !== remoteQueue[remoteQueueIndex]?.id) return;
    actions.followCursor(savedQueueId, {
        currentIndex: remoteQueueIndex,
        currentSongId: song.id,
        currentSongName: song.name,
    });
};

/** Coerce a hub saved-queue record (wire shape) into the local SavedQueue store shape. Songs are
 *  minimal (id + display metadata); a cross-client restore re-resolves them by id. */
const mapHubSavedQueue = (rec: any, serverId: null | string): SavedQueue => ({
    // A record minted by the other client may carry no cover URL; the queue's FIRST
    // track image stands in. Only a fallback: cards draw the resume track by id
    // (`savedQueueCoverSongId`), so their artwork follows playback (B-046).
    coverImageUrl: rec.coverImageUrl ?? rec.songs?.[0]?.imageUrl ?? null,
    createdAt: rec.createdAt ?? Date.now(),
    currentIndex: rec.currentIndex ?? 0,
    currentSongId: rec.songs?.[rec.currentIndex ?? 0]?.id,
    currentSongName: rec.currentSongName ?? rec.songs?.[rec.currentIndex ?? 0]?.title,
    id: rec.id,
    name: rec.name ?? undefined,
    positionSeconds: Math.round((rec.positionMs ?? 0) / 1000),
    repeat: (rec.repeat as PlayerRepeat) ?? PlayerRepeat.NONE,
    serverId: rec.serverId ?? serverId ?? '',
    // The session only knows shuffle as a bool, so ALBUM shuffle would degrade to TRACK
    // on every round trip — `shuffleMode` carries the real mode when the record has one.
    shuffle:
        (rec.shuffleMode as PlayerShuffle) ??
        (rec.shuffle ? PlayerShuffle.TRACK : PlayerShuffle.NONE),
    songCount: rec.songCount ?? rec.songs?.length ?? 0,
    // Full placeholder Songs, NOT bare metadata: `_serverId` is what gates the
    // stream-URL query (use-stream-url), so a stub without it restores into a player
    // that sits in PLAYING with no source — the "loads forever" bug.
    songs: (rec.songs ?? []).map(
        (t: any): QueueSong =>
            placeholderSong(t, rec.serverId ?? serverId ?? '') as unknown as QueueSong,
    ),
    sourceKind: (rec.sourceKind as SavedQueueKind) ?? 'manual',
    sourceName: rec.sourceName ?? undefined,
    updatedAt: rec.updatedAt ?? Date.now(),
});

/** Convert a local SavedQueue into the hub wire record shape (wire track fields, so the other
 *  client can render titles/artists) for syncSavedQueues. */
const savedQueueToHubRecord = (q: SavedQueue): Record<string, unknown> => ({
    coverImageUrl: q.coverImageUrl ?? undefined,
    createdAt: q.createdAt,
    currentIndex: q.currentIndex,
    id: q.id,
    name: q.name ?? undefined,
    positionMs: Math.round((q.positionSeconds ?? 0) * 1000),
    repeat: q.repeat,
    serverId: q.serverId,
    shuffle: q.shuffle !== PlayerShuffle.NONE,
    shuffleMode: q.shuffle,
    songCount: q.songCount,
    songs: q.songs.map((s) => ({
        album: s.album ?? undefined,
        artist: s.artistName,
        durationMs: s.duration ?? undefined,
        id: s.id,
        imageUrl: s.imageUrl ?? undefined,
        // navi-connect: a preview's stream URL and MIME are the only thing that
        // makes it playable anywhere else, and `SQ_TRACK_FIELDS` whitelists
        // both — so a saved queue holding one restores and transfers intact
        // rather than becoming a row that plays nothing.
        mime: s._previewMime,
        streamUrl: s._previewStreamUrl,
        title: s.name,
    })),
    sourceKind: q.sourceKind,
    sourceName: q.sourceName ?? undefined,
    updatedAt: q.updatedAt,
});

const hub = isElectron() ? window.api.hub : null;

/**
 * Worbus P2: following a change of Navidrome account (design §6.5), one change at a time (review
 * M7). A logout signs this device out of the Worbus Server and drops what the old account left
 * here (the lb-bot mirror, the fill ledger, the saved-queue cache, which the next welcome would
 * push into the new account's space); a switch does the same, then signs in with the new account.
 */
/** Each (hub user, account) mismatch is followed once a session: a hub that names its users
 *  differently from the login must not sign out and in at every welcome. */
const reconciledMismatches = new Set<string>();

const followAccountChange = createAccountFollower({
    clearFills: () => useActiveFillsStore.getState().actions.clear(),
    clearLbQueries,
    clearMirror: () => clearIndexMirrorForHubChange(true),
    clearSavedQueues: () => useSavedQueuesStore.getState().actions.clearAll(),
    hubOn: () => {
        const { hub: config } = useSettingsStore.getState();
        return config.enabled && config.url.trim() !== '';
    },
    signIn: () => signInWithCurrentServer(),
    signOut: () => signOutOfServer({ reconnect: false }),
});

/** At `welcome`: the last sign-in's answer, unless it was a refusal (the link works now). */
const keptSignInResult = (result: HubSignInResult | null): HubSignInResult | null =>
    result?.kind === 'signedIn' || result?.kind === 'oldServer' ? result : null;

/** The session's shuffled play order (PROTOCOL §4.2), or null for queue order. */
const sessionOrder = (order: unknown): null | number[] =>
    Array.isArray(order) && order.every((n) => typeof n === 'number') ? (order as number[]) : null;

/** W1: the hub publishes and adopts the playing device's play order (`playOrder` feature). */
const speaksPlayOrder = (): boolean => useHubStore.getState().features.includes('playOrder');

/**
 * W1: the play order a frame carries with its queue (`do:load`, `do:queueChanged`, a session),
 * from a hub that speaks `playOrder`; undefined from an older hub, whose order this device does
 * not adopt (it keeps its own, under the same rule).
 */
const adoptOf = (frame: any): PlayOrderAdopt | undefined =>
    speaksPlayOrder() && typeof frame?.shuffle === 'boolean'
        ? { order: sessionOrder(frame.order), shuffle: frame.shuffle }
        : undefined;

/** The player's shuffle mode or play order is not what `adopt` says. */
const orderDiffers = (
    state: ReturnType<typeof usePlayerStore.getState>,
    adopt: PlayOrderAdopt,
): boolean => {
    if (isShuffleEnabled(state) !== adopt.shuffle) return true;
    if (!adopt.shuffle || !isPermutation(adopt.order, state.queue.default.length)) return false;
    return adopt.order.some((row, position) => state.queue.shuffled[position] !== row);
};

/** The publish dedupe key of what the player holds now (queue-publication.ts). */
const localSignature = (): string => {
    const state = usePlayerStore.getState();
    const withOrder = speaksPlayOrder();
    return publicationSignature(
        state.getQueue().items.map((item) => item.id),
        withOrder && isShuffleEnabled(state) ? state.queue.shuffled : null,
        withOrder,
    );
};

/**
 * The publish dedupe key of a frame adopted with `ids`: set before (or as) the frame is applied,
 * so the adopt is not published back. An order that is not a permutation of the frame's rows is
 * not adopted (the store builds its own), so it keys as none and the player's own order is
 * published to the hub.
 */
const frameSignature = (ids: readonly string[], adopt: PlayOrderAdopt | undefined): string =>
    publicationSignature(
        ids,
        adopt?.shuffle && isPermutation(adopt.order, ids.length) ? adopt.order : null,
        speaksPlayOrder(),
    );

/**
 * What a report says about the player, read from the stores at the moment it is sent.
 *
 * Reports used to be built from refs that player events kept in step, and one of those events
 * does not fire when it should: the current-track subscription compares the playing song's
 * `_uniqueId`, so a queue edit that moves the playing track to another row (`reconcileQueue`,
 * after a remove or a move above it) left the cached index on the old row and every later
 * report named the wrong track (B-117). Read here, the index is the store's own, mapped out of
 * the shuffled order the way `subscribeCurrentTrack` and `getCurrentSong` map it, so the hub is
 * told a row of the queue as it lists it.
 *
 * It is also what `applied` promises (I-031, do-echo.ts): a report that carries a directive's
 * number was read from the player after that directive ended.
 */
const readPlayer = (): { index: number; isPlaying: boolean; positionMs: number } => {
    const state = usePlayerStore.getState();
    return {
        index: playingQueueIndex(state),
        isPlaying: state.player.status === PlayerStatus.PLAYING,
        positionMs: Math.round((useTimestampStoreBase.getState().timestamp || 0) * 1000),
    };
};

/** This device's volume as its row in every picker shows it: 0 while muted. */
const volumeLevel = (player: { muted: boolean; volume: number }): number =>
    player.muted ? 0 : toLevel(player.volume);

/** The adopt guard's window (see `adoptPauseGuard`), opened now. */
const openAdoptPauseGuard = (): GuardWindow => {
    const now = Date.now();
    return { armedAt: now, until: now + 3000 };
};

/**
 * navi-connect receiver/controller glue.
 *
 * Receives `do` directives from the hub and drives the player; emits `report`
 * (position/index/playing) ~1 Hz, but ONLY while this device is the active
 * receiver - plus one report whenever a numbered directive has ended, whoever is
 * active (`applied`, do-echo.ts). A report is read from the stores when it is sent
 * (`readPlayer`); the refs fed by player events serve the guards and the queue
 * publications. This device's volume goes out on its own, as `deviceState`, active
 * or not (`reportVolume`). Transport lives in the main process
 * (src/main/features/core/hub/index.ts).
 */
export const useHub = () => {
    const settings = useHubSettings();
    const serverId = useCurrentServerId();
    const {
        clearQueue,
        mediaPause,
        mediaPlay,
        mediaPlayByIndex,
        mediaSeekToTimestamp,
        mediaStop,
        mediaToggleMute,
        reconcileQueue,
        setQueue,
        setRepeat,
        setShuffle,
        setVolume,
    } = usePlayerActions();

    // Identity + live playback mirror, kept in refs (read from event handlers).
    const myId = useRef<null | string>(null);
    const activeId = useRef<null | string>(null);
    const serverIdRef = useRef(serverId);
    // The position and play state as the player events last gave them. NOT what a report says
    // (readPlayer): they feed the queue publications (publishQueue's setQueue, the adopt's
    // drift check) and the guards against a runaway.
    const positionMs = useRef(0);
    const playing = useRef(false);
    // I-031: the hub's numbered directives this connection has carried out - see do-echo.ts.
    const doEcho = useRef(NO_ECHO);
    // I-033: the volume this device last told the hub on this connection, and the one timer
    // that asks again when a change came too soon after it - see level-report.ts.
    const volumeReport = useRef(NO_LEVEL_REPORT);
    const volumeReportTimer = useRef<null | ReturnType<typeof setTimeout>>(null);
    // Wall-clock ms the hub last told this device a level on this connection (applyVolume).
    const volumeToldAt = useRef<null | number>(null);
    const lastQueueSig = useRef('');
    // Stable saved-queue history identity for what we publish — see resolveSavedQueueId.
    // It survives every edit to the queue we're listening to; only a new play (or an
    // adopt/transfer-in, which reuses the hub's own record id) changes it.
    const savedQueueId = useRef<null | string>(null);
    const savedQueuePrevIds = useRef<string[]>([]);
    // The queue's origin track, captured at mint — its art is the card's (frozen) cover.
    const savedQueueCoverSong = useRef<null | QueueSong>(null);
    const savedQueueKind = useRef<SavedQueueKind>('manual');
    const savedQueueName = useRef<string | undefined>(undefined);
    // Throttle the progress-path report to the ~1 Hz contract — the audio engine
    // fires progress several times a second, which multiplied hub traffic.
    const lastProgressReportAt = useRef(0);
    // Throttles the unclaimed-session escape in publishQueue (see there).
    const lastUnclaimedPublishAt = useRef(0);
    // Latest-wins guard over the async queue publications — see publishQueue.
    const publishGen = useRef(0);
    // Have we ever published a non-empty queue? Gates the "queue cleared" publish so the
    // momentarily-empty queue at startup can't wipe the hub session.
    const sawNonEmptyQueue = useRef(false);
    // Memoize resolved stream URLs by track id so a queue-membership change
    // doesn't re-resolve getStreamUrl for every track that didn't change.
    const streamUrlCache = useRef<Map<string, string | undefined>>(new Map());
    // Seek armed during a do:load that changes track: applied once the player
    // reports the new song, because seeking during the source reload is lost.
    // `pause` re-asserts the paused state after the seek — mediaPlayByIndex
    // starts async playback that an immediate mediaPause() loses the race to.
    const pendingSeek = useRef<ArmedSeek | null>(null);
    // The armed seek whose track is current and whose delayed seek has not fired yet (armed-seek.ts).
    const landingSeek = useRef<ArmedSeek | null>(null);
    // Wall-clock until which local player events are treated as hub-driven
    // (not user-initiated) — prevents do:load side effects from being
    // misinterpreted as "user started new local playback".
    // (hub-driven-window.ts; the initial value is built every render and kept only on the first.)
    const hubDriven = useRef(createHubDrivenWindow({ now: () => Date.now() }));
    // The window in which local playback is force-paused after adopting an orphaned (no active
    // device) session — see the onPlayerProgress watchdog. B-058: a play somebody asks for inside
    // it closes it (isGuardOpen), so the watchdog pauses only audio nobody asked for.
    const adoptPauseGuard = useRef<GuardWindow>({ armedAt: 0, until: 0 });
    // The engine's own clock while it advances without a break. Lets the watchdogs ask
    // "is audio ACTUALLY rolling?" instead of trusting the store - see audioIsRolling.
    const playheadRun = useRef<null | PlayheadRun>(null);
    // Throttles hardPause so a pause that never takes can't turn into a play/pause loop.
    const lastHardPauseAt = useRef(0);
    // True for the one store write in which hardPause sets PLAYING only to pause for real.
    const correctingStore = useRef(false);

    const publicUrlRef = useRef('');
    publicUrlRef.current = settings.publicServerUrl?.trim().replace(/\/$/, '') ?? '';

    serverIdRef.current = serverId;

    const isActive = () => myId.current !== null && activeId.current === myId.current;

    const noteActive = (id: null | string) => {
        activeId.current = id;
    };

    const isRemoteActiveNow = () =>
        myId.current !== null && activeId.current !== null && activeId.current !== myId.current;

    // When the hub tells us another device is the active receiver while our
    // local player is (auto)playing — e.g. Worbus for desktop restored its queue and
    // started playing on launch before the `welcome` arrived — silence the
    // local audio. Otherwise it runs away invisibly: the bar shows the remote
    // session and there's no local pause control reachable.
    // A pause that actually reaches the audio engine, even when the store already reads
    // PAUSED. The engines act on status *changes* (`subscribePlayerStatus` fires only when
    // the value differs), so `mediaPause()` against an already-PAUSED store is inert —
    // nothing is sent anywhere. That is precisely the state a runaway lands in: `setQueue`
    // forces status PLAYING, the pause right after puts it back to PAUSED, and the engine's
    // async play() lands *after* both. Audio then runs under a bar that reads "paused", and
    // every later pause — ours or the user's click — is swallowed, so the only way out is
    // killing the app. When the store is wrong, correct it first (the audio really IS
    // playing) and then pause for real. The transient PLAYING is marked hub-driven so our
    // own status handler can't mistake it for the user starting local playback.
    // Is audio ACTUALLY rolling? `playing.current` only mirrors the store's status, and a
    // runaway contradicts the store by definition, so a watchdog that trusts it alone goes
    // blind exactly when it's needed. The engine's own clock is the ground truth: a run of
    // small forward steps means it's really playing (a single jump is a seek, a backwards
    // step a track change). 1 s of unbroken advance — long enough that a pause fade-out's
    // trailing ticks can't trip it.
    // B-053: and the run must still be ticking, over more than one step, at a real pace. A
    // single sub-ms step (adopting our own ms-rounded hub cursor at launch) used to count
    // once 1 s had passed, so this read "rolling" against a silent, paused engine and the
    // armed-seek re-check's hardPause flip WAS the blip. See playhead-run.ts.
    // Q-051: and the run is made of engine ticks only - a seek ends it (onPlayerProgress).
    const audioIsRolling = () =>
        playing.current || isPlayheadRolling(playheadRun.current, Date.now());

    const hardPause = useCallback(
        (why: string) => {
            const now = Date.now();
            if (now - lastHardPauseAt.current < 2000) return;
            lastHardPauseAt.current = now;
            const flip = usePlayerStore.getState().player.status !== PlayerStatus.PLAYING;
            // B-053: the flip below is audible when the engine was in fact silent, so say when
            // it happens and on whose word - an unpause+pause scrobble pair alone names no caller.
            const run = playheadRun.current;
            logger.info(`[hub] hardPause (${why})`, {
                flip,
                playing: playing.current,
                run: run
                    ? {
                          ageMs: now - run.startedAt,
                          coveredSec: Number((run.lastPos - run.startPos).toFixed(3)),
                          sinceLastMs: now - run.lastAt,
                          steps: run.steps,
                      }
                    : null,
            });
            if (flip) {
                hubDriven.current.hold(1000);
                // I-031: the PLAYING written here lasts until the next line and nobody asked
                // for it, so the status handler does not report it. The hub's 2 s window after
                // a play or pause used to swallow that report; a hub that goes by `applied`
                // believes it, and every device would show "playing" for one frame.
                correctingStore.current = true;
                try {
                    mediaPlay();
                } finally {
                    correctingStore.current = false;
                }
            }
            mediaPause();
        },
        [mediaPause, mediaPlay],
    );

    // B-058: the post-load re-checks are armed against a runaway, and a play somebody asks for
    // inside their window rolls just the same - "rolling" cannot tell the two apart, the source
    // of the play can (play-request.ts). So a re-check pauses only audio nobody asked for since
    // it was armed, and says so when it stands down: otherwise the log reads as if it never ran.
    const pauseIfRunaway = useCallback(
        (why: string, armedAt: number) => {
            if (!audioIsRolling()) return;
            const request = lastPlayRequest();
            if (isRunaway(true, armedAt, request)) {
                hardPause(why);
                return;
            }
            logger.info(`[hub] ${why}: stood down for a requested play`, {
                afterArmMs: request ? request.at - armedAt : null,
                source: request?.source ?? null,
            });
        },
        [hardPause],
    );

    const reconcileRemoteActive = useCallback(() => {
        if (isRemoteActiveNow() && playing.current && !hubDriven.current.isOpen()) {
            mediaPause();
            // Auto-resume starts the audio engine asynchronously, so a single
            // pause can lose the race and the audio keeps going. Re-assert it
            // shortly after; the onPlayerProgress watchdog below is the ongoing
            // safety net if even this is beaten.
            setTimeout(() => {
                if (isRemoteActiveNow() && !hubDriven.current.isOpen()) {
                    hardPause('remote active, 150 ms re-check');
                }
            }, 150);
        }
    }, [hardPause, mediaPause]);

    // The load generation (see awaitLoadOutcome): bumped by every load and by release.
    const loadGen = useRef(0);
    // B-111: the load still waiting for its outcome, which later directives re-aim
    // (load-outcome.ts); null once it has ended.
    const pendingLoad = useRef<null | { exp: LoadExpectation; gen: number }>(null);

    /** The load still waiting for its outcome, unless a newer load or a release ended it. */
    const livePendingLoad = useCallback((): LoadExpectation | null => {
        const pending = pendingLoad.current;
        return pending && pending.gen === loadGen.current ? pending.exp : null;
    }, []);

    // `echo`: the report that follows `applied` moving. It is not gated on being the active
    // device: the hub decides who is, it has just sent this device a directive, and it reads
    // `applied` from every report.
    const report = useCallback(
        (overrides?: Record<string, unknown>, echo = false) => {
            if (!hub || (!echo && !isActive())) return;
            const player = readPlayer();
            hub.send({
                ...player,
                applied: doEcho.current.applied,
                positionMs: reportedPositionMs(livePendingLoad(), player.positionMs),
                t: 'report',
                ...overrides,
            });
        },
        [livePendingLoad],
    );

    // I-033: tell the hub this device's volume, so its row in every picker shows the level it
    // is really at - set here, by the OS (MPRIS), by a DLNA renderer or by a `do:setVolume`
    // alike, since all of them write the store this reads. Called at `welcome`, on every
    // change, and by its own timer; whether anything is sent is level-report.ts's rule (the
    // level last sent is not repeated, reports keep 250 ms apart with the last one kept, and
    // a level the hub told this device waits until the telling has stopped).
    // Not gated on being the active device: a row has a volume whoever is playing.
    const reportVolume = useCallback(function tell(): void {
        if (volumeReportTimer.current !== null) {
            clearTimeout(volumeReportTimer.current);
            volumeReportTimer.current = null;
        }
        if (!hub || !useHubStore.getState().connected) return;
        const level = volumeLevel(usePlayerStore.getState().player);
        const now = Date.now();
        const step = levelReportStep(volumeReport.current, level, now, volumeToldAt.current);
        if (step === null) return;
        if (step === 'send') {
            volumeReport.current = { at: now, level };
            hub.send({ t: 'deviceState', volume: level });
            return;
        }
        volumeReportTimer.current = setTimeout(tell, step);
    }, []);

    // Track metadata published to the hub. streamUrl/mime let URL-based
    // receivers (the Chromecast bridge) play without speaking Subsonic; the
    // direct URL resolves instantly (no transcode-decision round trip).
    const rewriteToPublic = useCallback((url: null | string | undefined) => {
        const base = publicUrlRef.current;
        if (!url || !base) return url ?? undefined;
        try {
            const parsed = new URL(url);
            return `${base}${parsed.pathname}${parsed.search}`;
        } catch {
            return url;
        }
    }, []);

    const buildHubTracks = useCallback(
        async (items: QueueSong[]) => {
            const sid = serverIdRef.current;
            return Promise.all(
                items.map(async (item) => {
                    // A preview carries its own signed, absolute URL. It is
                    // published verbatim: rewriting its host to the public
                    // Navidrome base (which every library track needs) would
                    // point it at a server that has never heard of the file.
                    if (isPreviewId(item.id)) return previewHubTrack(item);
                    let streamUrl: string | undefined;
                    if (sid) {
                        const cache = streamUrlCache.current;
                        if (cache.has(item.id)) {
                            streamUrl = cache.get(item.id);
                        } else {
                            try {
                                streamUrl = (await api.controller.getStreamUrl({
                                    apiClientProps: { serverId: sid },
                                    query: {
                                        id: item.id,
                                        skipAutoTranscode: true,
                                        transcode: false,
                                    },
                                })) as string;
                            } catch {
                                streamUrl = undefined;
                            }
                            cache.set(item.id, streamUrl);
                        }
                    }
                    return {
                        album: item.album ?? undefined,
                        // The ids, not just the names. A receiver rebuilding this track
                        // for its playerbar otherwise has nothing to link to until it
                        // has round-tripped getSongDetail — which is why the artist name
                        // rendered as plain text on remote playback.
                        albumId: item.albumId ?? undefined,
                        artist: item.artistName,
                        artists: item.artists?.length
                            ? item.artists.map((a) => ({ id: a.id, name: a.name }))
                            : undefined,
                        durationMs: item.duration ?? undefined,
                        favorite: item.userFavorite,
                        id: item.id,
                        imageUrl:
                            rewriteToPublic(
                                getItemImageUrl({
                                    id: item.id,
                                    imageUrl: item.imageUrl,
                                    itemType: LibraryItem.SONG,
                                    serverId: item._serverId,
                                    type: 'itemCard',
                                    useRemoteUrl: true,
                                }),
                            ) || undefined,
                        mime: item.container
                            ? `audio/${item.container === 'mp3' ? 'mpeg' : item.container}`
                            : undefined,
                        rating: item.userRating,
                        streamUrl: rewriteToPublic(streamUrl),
                        title: item.name,
                    };
                }),
            );
        },
        [rewriteToPublic],
    );

    // Decide the saved-queue history id to publish for the current queue.
    //
    // Identity is a SESSION, not a track list: once we're listening to something, every
    // edit to it (reorder, remove, play-next, Auto DJ top-up, shuffle) keeps the same id,
    // so the hub refreshes that one record. A new id is minted only when a play call site
    // announced a new session (beginQueueSession) or we don't have one yet. The previous
    // rule — "same id while the old ids are an ordered prefix of the new ones" — failed on
    // every reorder and insert, forking a near-duplicate history card each time.
    const resolveSavedQueueId = useCallback((ids: string[]): string => {
        const startNew = isNewQueueSessionPending();
        if (savedQueueId.current && !startNew) {
            savedQueuePrevIds.current = ids;
            return savedQueueId.current;
        }
        if (!startNew) {
            // No session of our own: adopt the hub's current record when our queue is
            // substantially the same one (transfer/adopt-in), rather than duplicating it.
            const hub = useHubStore.getState();
            const hubIds = new Set(hub.remoteQueue.map((t) => t.id));
            const overlap = hubIds.size
                ? ids.filter((id) => hubIds.has(id)).length / hubIds.size
                : 0;
            if (hub.savedQueueId !== null && overlap >= 0.5) {
                savedQueueId.current = hub.savedQueueId;
                savedQueuePrevIds.current = ids;
                // Inherit the record's identity too — republishing with our own defaults
                // ('manual', no name) would blank a "Mood Flow"/album queue we adopted.
                const rec = useSavedQueuesStore
                    .getState()
                    .queues.find((q) => q.id === hub.savedQueueId);
                // No `else`: keeping the PREVIOUS queue's kind/name here republished it
                // onto the adopted record and renamed someone else's queue.
                savedQueueKind.current = rec?.sourceKind ?? 'manual';
                savedQueueName.current = rec ? (rec.name ?? rec.sourceName) : undefined;
                return savedQueueId.current!;
            }
        }
        // Genuinely new session: mint an id (or reuse the one a resume announced) and
        // stamp its source kind/name — once, at birth.
        const items = usePlayerStore.getState().getQueue().items;
        const src = resolveQueueSource(items);
        consumeQueueSession();
        // ...unless the history already HAS this queue. Our session id lives in a ref, so it
        // dies with the renderer: without this, every relaunch republished the restored queue
        // under a new id and stacked another identical card.
        savedQueueId.current = src.id ?? findMatchingSavedQueueId(ids) ?? crypto.randomUUID();
        savedQueueKind.current = src.kind;
        savedQueueName.current = src.name;
        savedQueueCoverSong.current = items[0] ?? null;
        savedQueuePrevIds.current = ids;
        return savedQueueId.current;
    }, []);

    /** Public URL of the frozen origin cover, for the saved-queue record. */
    const savedQueueCoverUrl = useCallback((): string | undefined => {
        const song = savedQueueCoverSong.current;
        if (!song) return undefined;
        return (
            rewriteToPublic(
                getItemImageUrl({
                    id: song.id,
                    imageUrl: song.imageUrl,
                    itemType: LibraryItem.SONG,
                    serverId: song._serverId,
                    type: 'itemCard',
                    useRemoteUrl: true,
                }),
            ) || undefined
        );
    }, [rewriteToPublic]);

    // Publish our local queue to the hub when it changes. This is how the hub
    // learns what's playing (and claims us as the active device) when the user
    // starts playback in Worbus for desktop directly. Gated so we never hijack playback
    // from another active device — only publish when we're active or nothing is.
    const publishQueue = useCallback(() => {
        if (!hub) return;
        // A do:load fires onCurrentSongChange → publishQueue while we're now the
        // active device; without this gate we'd echo an act:setQueue back to the
        // hub carrying the PREVIOUS track's position, overwriting the resume point.
        if (hubDriven.current.isOpen()) return;
        // Not until the hub has told us what the session IS (`welcome` sets myId). The
        // persisted queue rehydrates a moment after launch and fires this — publishing it
        // then overwrote the live session with our stale copy at index 0 / position 0 AND
        // promoted us to active receiver (the hub promotes any setQueue sender while the
        // slot is empty, which it is right after a client restart). That is what lost a
        // running cast session and restarted the queue from its first track.
        if (myId.current === null) return;
        if (!(activeId.current === null || activeId.current === myId.current)) return;
        const state = usePlayerStore.getState();
        const items = state.getQueue().items;
        const idsSig = items.map((item) => item.id).join(',');
        // W1: with a playOrder hub the key holds the order too, so a shuffle toggle or a
        // re-shuffle here is published like a queue edit, also while paused when active.
        const sig = localSignature();
        // Unclaimed-session escape (mirrors Worbus for Android's publishQueueIfOurs): nobody is the
        // active receiver and WE are playing, so this client IS the live receiver — but
        // the signature dedupe would suppress the publish forever (adopting the hub's
        // queue pins the signature to it). Without a publish the hub never promotes us,
        // so we never report, so its cursor stays frozen at the adopt point and every
        // later `session` frame drags playback back there. The publish IS the claim.
        const unclaimed =
            activeId.current === null &&
            playing.current &&
            Date.now() - lastUnclaimedPublishAt.current > 2000;
        if (sig === lastQueueSig.current && !unclaimed) return;
        // B-047: a publish into an empty slot IS a claim, so a client that isn't playing must
        // not make one just to restate the queue the hub already holds. At launch the restored
        // queue did exactly that (position 0, not playing) the moment the slot was empty:
        // either it claimed first, and this app's own cast bridge then found "another device
        // active" and left a still-playing speaker unadopted; or the bridge adopted first and
        // this stale publish reloaded the speaker at 0:00, paused. Nothing is lost by skipping:
        // a local play still claims through `unclaimed` above.
        if (
            activeId.current === null &&
            !playing.current &&
            idsSig ===
                useHubStore
                    .getState()
                    .remoteQueue.map((track) => track.id)
                    .join(',')
        ) {
            lastQueueSig.current = sig;
            return;
        }
        if (unclaimed) lastUnclaimedPublishAt.current = Date.now();
        lastQueueSig.current = sig;
        if (!items.length) {
            // Clearing the queue has to reach the hub, or the session keeps serving the
            // queue we just threw away — open Worbus for Android afterwards and the whole list is back.
            // Only once we've actually published something, though: the queue is empty for
            // a moment at startup before the persisted one hydrates, and publishing THAT
            // would wipe a session another device is happily playing.
            if (!sawNonEmptyQueue.current) return;
            sawNonEmptyQueue.current = false;
            savedQueueId.current = null;
            savedQueueCoverSong.current = null;
            savedQueuePrevIds.current = [];
            // `clear`, not an empty setQueue: the hub flushes our position into the history
            // record before detaching the session, so the cleared queue stays resumable.
            sendAct('clear');
            return;
        }
        sawNonEmptyQueue.current = true;
        // The ref is fed by player EVENTS, which never fired for a queue restored at
        // launch - position would still be its mount-time 0, publishing "from the top"
        // for a queue we're parked in the middle of. Take the live value instead; the
        // timestamp store is where a restored position lives until the engine's first
        // progress tick. (The index is read from the store below.)
        if (!positionMs.current) {
            positionMs.current = Math.round(
                (useTimestampStoreBase.getState().timestamp || 0) * 1000,
            );
        }
        const sqId = resolveSavedQueueId(items.map((item) => item.id));
        // buildHubTracks resolves a stream URL per uncached track — real network I/O, so two
        // publications can finish out of order and leave the hub holding the OLDER queue. Worse,
        // `lastQueueSig` was advanced above for both, so the dedupe then suppresses the
        // corrective publish and the session stays wrong until the queue changes again.
        // A generation fixes the ordering; re-reading the store fixes the staleness.
        const gen = ++publishGen.current;
        void (async () => {
            const tracks = await buildHubTracks(items);
            if (gen !== publishGen.current) return;
            // B-047: the claim gate above was read BEFORE resolving the tracks (network I/O);
            // another device (this app's own cast bridge, adopting a speaker at launch) can
            // claim the slot meanwhile, and this queue would then reach the hub as a
            // non-active device's setQueue — a reload of that device.
            if (!(activeId.current === null || activeId.current === myId.current)) {
                logger.info(
                    `[hub] setQueue dropped: ${activeId.current} took the active slot while ` +
                        `the queue resolved`,
                );
                return;
            }
            // The playhead as it is now, unless the queue changed while the tracks resolved:
            // then the snapshot the tracks were built from, since `order` indexes those tracks
            // and must never travel with another list (W1).
            const live = usePlayerStore.getState();
            const liveIds = live
                .getQueue()
                .items.map((item) => item.id)
                .join(',');
            const fields = publicationFields(liveIds === idsSig ? live : state, speaksPlayOrder());
            logger.info(
                `[hub] setQueue index=${fields.index} pos=${positionMs.current} ` +
                    `play=${playing.current} active=${activeId.current ?? 'none'}` +
                    ('shuffle' in fields ? ` shuffle=${fields.shuffle}` : ''),
            );
            sendAct('setQueue', {
                coverImageUrl: savedQueueCoverUrl(),
                ...fields,
                play: playing.current,
                positionMs: positionMs.current,
                savedQueueId: sqId,
                serverId: serverIdRef.current ?? undefined,
                sourceKind: savedQueueKind.current,
                sourceName: savedQueueName.current,
                // I-040: every publication of a station's queue names it; one without unbinds.
                stationId: stationIdForPublish(),
                tracks,
            });
        })();
    }, [buildHubTracks, resolveSavedQueueId, savedQueueCoverUrl]);

    // Spotify semantics: if the user starts playback locally while another
    // device is active, the music belongs to the session — send the local
    // queue to the hub (which loads it on the ACTIVE remote device) and keep
    // local audio silent. Hub-driven events are exempt via the hub-driven window.
    const lastRoutedAt = useRef(0);
    const routeLocalPlayToRemote = useCallback(() => {
        if (!hub || !playing.current) return;
        if (hubDriven.current.isOpen()) return;
        if (Date.now() - lastRoutedAt.current < 1000) return;
        const remoteActive =
            myId.current !== null && activeId.current !== null && activeId.current !== myId.current;
        if (!remoteActive) return;

        const state = usePlayerStore.getState();
        const items = state.getQueue().items;
        if (!items.length) return;
        // The session ALREADY holds this queue: a stray local play event is not new
        // intent, it's noise (a watchdog pause losing a race with the audio engine, an
        // auto-resume, a media-key round trip). Re-sending setQueue here restarts the
        // remote device at positionMs 0 — with a Chromecast that reads as the current
        // track reloading every second or two, forever. Just silence the local player.
        const hubSig = useHubStore
            .getState()
            .remoteQueue.map((track) => track.id)
            .join(',');
        const localSig = items.map((item) => item.id).join(',');
        if (hubSig && hubSig === localSig) {
            mediaPause();
            return;
        }
        lastRoutedAt.current = Date.now();
        const sqId = resolveSavedQueueId(items.map((item) => item.id));
        // Same generation as publishQueue: these two race each other as readily as either
        // races itself, and the loser must not overwrite the winner's queue.
        const gen = ++publishGen.current;
        void (async () => {
            const tracks = await buildHubTracks(items);
            if (gen !== publishGen.current) return;
            sendAct('setQueue', {
                coverImageUrl: savedQueueCoverUrl(),
                // The playing row (B-305). No order: the hub reads one only from the device
                // that plays, and this one does not.
                index: playingQueueIndex(usePlayerStore.getState()),
                play: true,
                positionMs: 0,
                savedQueueId: sqId,
                serverId: serverIdRef.current ?? undefined,
                sourceKind: savedQueueKind.current,
                sourceName: savedQueueName.current,
                stationId: stationIdForPublish(),
                tracks,
            });
        })();
        // Keep the sig in sync so publishQueue doesn't re-send this queue later.
        lastQueueSig.current = localSignature();
        // The session plays it remotely — silence the local player.
        mediaPause();
    }, [buildHubTracks, mediaPause, resolveSavedQueueId, savedQueueCoverUrl]);

    // A pending seek that never fires (the armed index never becomes current — a
    // superseded load, a queue that changed under us) would otherwise ambush the next
    // unrelated track change, seeking it to a stale offset. Expire them.
    const PENDING_SEEK_TTL = 10_000;

    // ------------------------------------------------------------------ //
    // Load acknowledgement (PROTOCOL §7.1-7.2)
    //
    // `loaded {ok:true}` must mean playback was established, not that we called the
    // player's API. Every queue/seek/play call here is asynchronous — the file's own
    // delayed seek and delayed re-pause exist precisely because they are — so acking
    // straight after issuing them proves only that the commands left this function.
    // The hub then commits the active slot on that word and every device shows a
    // playing bar over silence.
    //
    // So watch for the outcome instead. Engine ground truth differs by intent:
    //   playing -> the target track is current AND the engine clock is advancing
    //              (`playheadRun`, fed by onPlayerProgress deltas - the same signal
    //              the runaway watchdogs trust)
    //   paused  -> the target track is current, we are not playing, and the timestamp
    //              store sits at the requested offset (i.e. the seek actually landed)
    // ------------------------------------------------------------------ //
    // Time kept back from the hub's budget for the ack's own trip. Answering at the
    // deadline is the same as not answering: the hub has already rolled back.
    const ACK_RESERVE_MS = 1500;
    const ROLLING_PROOF_MS = 600;

    /** What the player shows now, for the load's outcome (load-outcome.ts). */
    const lookAtPlayer = useCallback((): PlayerLook => {
        const state = usePlayerStore.getState();
        return {
            playing: state.player.status === PlayerStatus.PLAYING,
            positionSec: useTimestampStoreBase.getState().timestamp || 0,
            rolling: isPlayheadRolling(playheadRun.current, Date.now(), ROLLING_PROOF_MS),
            rowIndex: readPlayer().index,
        };
    }, []);

    const awaitLoadOutcome = useCallback(
        async (
            gen: number,
            exp: LoadExpectation,
            budgetMs: number,
        ): Promise<{ error?: string; ok: boolean }> => {
            const deadline = Date.now() + Math.max(1000, budgetMs - ACK_RESERVE_MS);
            for (;;) {
                // A newer load (or a release) owns the player now. Say nothing: this
                // transfer's slot has already moved on, and an ack from here could only
                // describe a queue we no longer have.
                if (loadGen.current !== gen) return { error: 'superseded', ok: false };
                // `clear` closed it with what it had reached.
                if (exp.verdict) return exp.verdict;
                const proven = loadProven(exp, lookAtPlayer());
                if (proven.ok) return { ok: true };
                if (Date.now() >= deadline) {
                    return {
                        error: proven.onTarget
                            ? `the player never ${exp.wantPause ? 'settled at' : 'started'} the requested track`
                            : 'the queue never reached the requested track',
                        ok: false,
                    };
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        },
        [lookAtPlayer],
    );

    // Arm a seek for when the player reports the target track. If that track is ALREADY
    // current, seeking now is both correct and necessary — nothing will re-arm it,
    // because onCurrentSongChange only fires on an actual change. B-339: unless the web player is
    // not up yet at a fresh start; then the startup seek carries the hub's position (arm-seek.ts).
    const armSeek = useCallback(
        (targetIndex: number, sec: number, pause: boolean) => {
            const outcome = armSeekStep(targetIndex, sec, pause, {
                armPending: (index, at, pauseAfter) => {
                    pendingSeek.current = {
                        armedAt: Date.now(),
                        index,
                        pause: pauseAfter,
                        sec: at,
                    };
                },
                currentIndex: playingQueueIndex(usePlayerStore.getState()),
                // Only the web player can drop a seek before it mounts; the others are up.
                engineTakesSeek: engineTakesSeekNow(
                    useSettingsStore.getState().playback.type === PlayerType.WEB,
                ),
                pauseSoon: () => setTimeout(() => mediaPause(), 100),
                retargetStartupSeek,
                seekNow: mediaSeekToTimestamp,
                showPosition: (at) => setTimestamp(at, { seek: true }),
                withdrawStartupSeek,
            });
            if (outcome === 'retargeted') {
                logger.info('[hub] engine not up yet: the first play starts at the hub position', {
                    sec,
                });
            }
        },
        [mediaPause, mediaSeekToTimestamp],
    );

    const resolveSongs = useCallback(
        (tracks: Array<any>, known?: Map<string, Song>): Promise<Song[]> =>
            resolveHubTracks(tracks, serverIdRef.current, known),
        [],
    );

    /** Songs the local queue already holds, by id — spares resolveSongs a round trip each. */
    const heldSongs = useCallback((): Map<string, Song> => {
        const map = new Map<string, Song>();
        for (const item of usePlayerStore.getState().getQueue().items) {
            if (!map.has(item.id)) map.set(item.id, item as unknown as Song);
        }
        return map;
    }, []);

    // Resolves once the directive has been APPLIED; for all but a load that is also when it has
    // ENDED (carried out, refused or failed), which is what lets runDirective move `applied`
    // after it: the store flips synchronously inside the player actions below. A load's end is
    // its outcome, returned as `later` so the next directive is not held behind it (B-111). The
    // value says whether the report that follows is sent (do-echo.ts).
    const handleDo = useCallback(
        async (msg: any): Promise<Handled<DoExit>> => {
            // Local player events caused by this directive are hub-driven, not
            // user actions (window covers async engine events). Every directive that
            // comes through here is about the session; `setVolume` is not, and does not
            // (applyVolume).
            hubDriven.current.hold(2000);
            // B-111: a load still waiting for its outcome now waits for what this directive
            // makes of it (load-outcome.ts).
            const waitingLoad = livePendingLoad();
            if (waitingLoad) reaimLoad(waitingLoad, msg);
            switch (msg.cmd) {
                case 'clear':
                    // A load still waiting is answered with what it had reached.
                    if (waitingLoad) closeLoad(waitingLoad, lookAtPlayer());
                    // The other client emptied the session queue. Stop and drop ours too,
                    // otherwise this device keeps playing a queue the session no longer has.
                    mediaStop({ reset: true });
                    clearQueue();
                    break;
                case 'jump': {
                    notePlayRequest('hub'); // B-058: a controller asked for this play
                    const kept = armedSeeksAfterRowMove();
                    pendingSeek.current = kept.waiting;
                    landingSeek.current = kept.landing;
                    mediaPlayByIndex(msg.index);
                    break;
                }
                case 'load': {
                    // The hub places the playhead from here on: the startup seek to where
                    // this device was when it closed must not take it back on first play.
                    withdrawStartupSeek();
                    // PROTOCOL §7.1: a transfer's load must be acknowledged, or the hub
                    // commits the active slot and never learns we couldn't start.
                    // §7.2: the ack carries the directive's transferId, and must arrive
                    // inside the budget the hub sent with it.
                    const gen = ++loadGen.current;
                    const transferId = msg.transferId;
                    const budgetMs = Number(msg.timeoutMs) || 10_000;
                    const targetSec = (msg.positionMs ?? 0) / 1000;
                    const incomingIds: string[] = (msg.tracks ?? []).map((t: any) => t.id);
                    // W1: the play order the hub sent with the queue (a playOrder hub only).
                    const adopt = adoptOf(msg);
                    // We become the active device once this queue loads, so pre-set the
                    // publish signature to the loaded queue — otherwise onCurrentSongChange
                    // republishes it back to the hub with a stale position.
                    if (incomingIds.length) {
                        lastQueueSig.current = frameSignature(incomingIds, adopt);
                    }
                    const state = usePlayerStore.getState();
                    const currentIds = state.getQueue().items.map((item) => item.id);
                    const sameQueue =
                        incomingIds.length > 0 &&
                        incomingIds.length === currentIds.length &&
                        incomingIds.every((id, n) => id === currentIds[n]);

                    const wantPause = msg.play === false;
                    // I-031: a load that could not start. A transfer's is rolled back by the
                    // hub on this answer, so nothing more is said. Any other load (a setQueue
                    // while this device plays) has nobody to roll it back: pause, and the
                    // report that follows says "not playing" at the row and position the
                    // LOAD named. Not the player's: when nothing resolved it still holds the
                    // queue from before, and its row would be read as one of the new queue.
                    const refuse = (error: string | undefined): DoExit => {
                        hub?.send({ error, ok: false, t: 'loaded', transferId });
                        const exit = failedLoadExit(msg);
                        if (exit !== 'silent') {
                            notePauseRequest(); // the play this load asked for is withdrawn
                            mediaPause();
                        }
                        return exit;
                    };
                    if (sameQueue) {
                        // Queue is already loaded locally (e.g. transfer back to
                        // this device). Reloading would reinitialise the audio
                        // engine to 0 and lose the seek — instead just position
                        // and play. The hub's position is authoritative, and so is the
                        // play order it sent (W1: the song after this one stays the same
                        // across a transfer).
                        if (adopt) {
                            setShuffle(
                                adopt.shuffle ? PlayerShuffle.TRACK : PlayerShuffle.NONE,
                                adopt.order,
                            );
                        }
                        if ((msg.index ?? 0) !== playingQueueIndex(usePlayerStore.getState())) {
                            // Changing track reloads the source; an immediate
                            // seek would be lost. Arm it for onCurrentSongChange.
                            pendingSeek.current = {
                                armedAt: Date.now(),
                                index: msg.index ?? 0,
                                pause: wantPause,
                                sec: targetSec,
                            };
                            mediaPlayByIndex(msg.index ?? 0);
                        } else {
                            mediaSeekToTimestamp(targetSec);
                        }
                    } else {
                        const songs = await resolveSongs(msg.tracks, heldSongs());
                        if (!songs.length) {
                            // Nothing resolved — the queue is unplayable here (server
                            // down, ids this server doesn't know). Say so rather than
                            // leaving the hub believing this device took the session.
                            return refuse('could not resolve any track in the queue');
                        }
                        // Re-arm the hub-driven window: resolveSongs fans out one
                        // getSongDetail per track and can outlast the original 2 s, after
                        // which setQueue's own events read as a fresh user action.
                        hubDriven.current.hold(2000);
                        pendingSeek.current = {
                            armedAt: Date.now(),
                            index: msg.index ?? 0,
                            pause: wantPause,
                            sec: targetSec,
                        };
                        // Load straight into the requested state — see setQueue's `play`.
                        // `msg.index` is a row; the play order is the hub's when it sent one.
                        setQueue(songs, msg.index ?? 0, targetSec, !wantPause, adopt);
                    }
                    if (wantPause) {
                        mediaPause();
                    } else {
                        // B-058: asked for - no older load's re-check may pause it.
                        notePlayRequest('hub');
                        mediaPlay();
                    }
                    // Everything above is asynchronous. Watch for the result rather than
                    // reporting the commands as one — see awaitLoadOutcome. Off the chain
                    // (B-111): a pause pressed meanwhile is applied now, and re-aims this.
                    const exp = expectLoad(msg.index ?? 0, targetSec, wantPause);
                    pendingLoad.current = { exp, gen };
                    const later = async (): Promise<DoExit> => {
                        const outcome = await awaitLoadOutcome(gen, exp, budgetMs);
                        if (pendingLoad.current?.exp === exp) pendingLoad.current = null;
                        const ending = loadEnding(outcome, exp);
                        if (ending.kind === 'refuse') return refuse(outcome.error);
                        if (ending.kind === 'answered') {
                            hub?.send({
                                ...(ending.ok ? {} : { error: outcome.error }),
                                ok: ending.ok,
                                t: 'loaded',
                                transferId,
                            });
                        }
                        return ending.exit;
                    };
                    return { later: later() };
                }
                case 'pause':
                    notePauseRequest(); // B-058: a controller withdrew any play it asked for
                    mediaPause();
                    break;
                case 'play':
                    // B-058: a controller asked for this play. the hub-driven window cannot shield it from
                    // a paused load's re-check, which always runs inside that window.
                    notePlayRequest('hub');
                    mediaPlay();
                    break;
                case 'queueChanged': {
                    // PROTOCOL §5.2: a queue edit must not disturb playback — and the only
                    // way to honour that is to not touch the audio engine at all when the
                    // playing track survived the edit. See reconcileQueue below.
                    const before = usePlayerStore.getState();
                    const wasPlaying = before.player.status === PlayerStatus.PLAYING;
                    // getCurrentSong, not items[player.index]: under shuffle the index is a
                    // position in the shuffled order, so indexing the display list names a
                    // track that isn't playing — and everything below turns on this id.
                    const playingId = before.getCurrentSong()?.id;
                    // The edit resends the whole queue; only the ids we don't already hold
                    // need a round trip.
                    const songs = await resolveSongs(msg.tracks, heldSongs());
                    if (!songs.length) break;
                    hubDriven.current.hold(2000);
                    // W1: a controller's edit, with the play order the hub patched by the same
                    // rule (a playOrder hub only). Adopted as sent, and not echoed back.
                    const adopt = adoptOf(msg);
                    const adoptedIds = songs.map((song) => song.id);
                    // The hub echoes ITS OWN cursor, which is only as fresh as our last 1 Hz
                    // report. An Auto DJ top-up landing just after a local auto-advance therefore
                    // names the track that has already ENDED, `sameSong` reads false, and the
                    // setQueue below restarts it from the top — a song playing twice in a row.
                    // Re-locate the playing track by id, exactly as the cast bridge does
                    // (`CastDeviceBridge.handleDo`'s `queueChanged`). The hub's index still wins
                    // when it already agrees, so a queue holding the same track twice keeps
                    // pointing at the copy that is actually playing.
                    let nextIndex = msg.index ?? 0;
                    if (playingId && songs[nextIndex]?.id !== playingId) {
                        const relocated = songs.findIndex((song) => song.id === playingId);
                        if (relocated >= 0) nextIndex = relocated;
                    }
                    // B-111: a load still waiting now waits for that row.
                    const stillWaiting = livePendingLoad();
                    if (stillWaiting) stillWaiting.index = nextIndex;
                    const sameSong = !!playingId && songs[nextIndex]?.id === playingId;
                    if (sameSong) {
                        // The playing track survived the edit, so the audio engine has
                        // nothing to do: reconcile the list around it and leave the source,
                        // the play state and the playhead exactly where they are. No
                        // setQueue, and — crucially — no seek. Restoring a position the
                        // engine never left is what made every remote enqueue audible as a
                        // one-second gap with the artwork blinking through it.
                        reconcileQueue(songs, nextIndex, adopt);
                        lastQueueSig.current = frameSignature(adoptedIds, adopt);
                        break;
                    }
                    // The playing track is gone (removed from under us). Its replacement has
                    // to be loaded for real — from the top, since there is no position to
                    // carry across. PROTOCOL §5.2: don't START playback if we were paused.
                    const kept = armedSeeksAfterRowMove();
                    pendingSeek.current = kept.waiting;
                    landingSeek.current = kept.landing;
                    setQueue(songs, nextIndex, 0, wasPlaying, adopt);
                    lastQueueSig.current = frameSignature(adoptedIds, adopt);
                    // I-031: setQueue leaves the timestamp store where the removed track was
                    // until its restore seeks to 0 some 100 ms on, and the report that follows
                    // this directive is read before that. Say "from the top" now.
                    setTimestamp(0, { seek: true });
                    break;
                }
                case 'release': {
                    // Final position report, THEN released — order matters so the
                    // hub captures our exact spot before handing off. Both are read from
                    // the stores here (readPlayer): the timestamp store is written by every
                    // engine tick (only the 1 Hz *report* is throttled), so it is the
                    // engine's live position, and the index is the store's own (B-117).
                    //
                    // Invalidate any load in flight first: the session is leaving this
                    // device, so an outstanding awaitLoadOutcome has nothing left to
                    // acknowledge and must not answer for a queue we no longer own.
                    loadGen.current += 1;
                    mediaPause();
                    report({ isPlaying: false });
                    const { index, positionMs: releasedAtMs } = readPlayer();
                    hub?.send({
                        index,
                        positionMs: releasedAtMs,
                        t: 'released',
                        // §7.2 — echo the handoff this release belongs to, so a duplicate
                        // from an earlier one can't complete it.
                        transferId: msg.transferId,
                    });
                    // I-031: those two are this directive's last word. No report after it.
                    return 'silent';
                }
                case 'seek':
                    withdrawStartupSeek();
                    // B-111: a load's armed seek still to land would put the player back at the
                    // load's offset after this one; it lands here instead. (setQueue's own
                    // restore seek, 100 ms in, fires before the armed one at 150 ms.)
                    seekOverArmedSeeks(
                        (msg.positionMs ?? 0) / 1000,
                        pendingSeek.current,
                        landingSeek.current,
                    );
                    mediaSeekToTimestamp((msg.positionMs ?? 0) / 1000);
                    break;
                case 'setRepeat':
                    setRepeat(msg.mode as PlayerRepeat);
                    break;
                case 'setShuffle': {
                    // W1: from a playOrder hub the order is binding (a controller's shuffle on
                    // or re-shuffle: the hub proposes it, this device adopts it as sent).
                    const order = speaksPlayOrder() ? sessionOrder(msg.order) : undefined;
                    setShuffle(msg.on ? PlayerShuffle.TRACK : PlayerShuffle.NONE, order);
                    const ids = usePlayerStore
                        .getState()
                        .getQueue()
                        .items.map((item) => item.id);
                    lastQueueSig.current = frameSignature(
                        ids,
                        speaksPlayOrder() ? { order: order ?? null, shuffle: !!msg.on } : undefined,
                    );
                    break;
                }
                default:
                    break;
            }
            return 'echo';
        },
        [
            awaitLoadOutcome,
            clearQueue,
            livePendingLoad,
            lookAtPlayer,
            heldSongs,
            mediaPause,
            mediaPlay,
            mediaPlayByIndex,
            mediaSeekToTimestamp,
            mediaStop,
            reconcileQueue,
            report,
            resolveSongs,
            setQueue,
            setRepeat,
            setShuffle,
        ],
    );

    // I-033: `do:setVolume`. Applied the moment it arrives, whichever device is playing: this
    // device said it would (`idleVolume` in its hello), and what sends it to a device that is
    // not playing is a row's slider in another client's picker. It is not a directive about
    // the session, so it is kept out of handleDo and its chain. It does not wait behind a load;
    // it does not open the hub-driven window, which while another device plays would stand the
    // runaway watchdogs and the queue publications down for 2 s; and it carries no number to
    // echo (PROTOCOL §5.2), so no report follows it.
    // A level above 0 also unmutes: muted, it would be set and nothing heard, and this device
    // would go on reporting 0. The new level reaches the hub's row through reportVolume, like
    // any other change, once no further one has been told for 250 ms (noted here, before the
    // store write that reportVolume answers). No `act:volume` can come of it: this writes the
    // player store, and acts are sent by the controls' handlers, never by something watching
    // the store.
    const applyVolume = useCallback(
        (level: unknown) => {
            if (typeof level !== 'number' || !Number.isFinite(level)) return;
            volumeToldAt.current = Date.now();
            setVolume(level);
            if (level > 0 && usePlayerStore.getState().player.muted) mediaToggleMute();
        },
        [mediaToggleMute, setVolume],
    );

    // Hub-authoritative startup/reconnect: adopt the hub's session as our local queue
    // instead of publishing our own (possibly stale) restored queue over it. Runs on
    // `welcome` and every `session` frame. Only adopts when there is NO live receiver
    // (activeId === null); another active device is a display-mirror concern, and when
    // we're active the reporter owns publishing. Adopted queues load PAUSED — a
    // launching/taking-over client stays a controller until the user hits play.
    const adoptIfNoLiveReceiver = useCallback(
        async (session: any) => {
            if (!session || activeId.current !== null) return;
            const hubTracks: Array<any> = session.queue ?? [];
            const hubSig = hubTracks.map((track) => track.id).join(',');
            const state = usePlayerStore.getState();
            const localSig = state
                .getQueue()
                .items.map((item) => item.id)
                .join(',');
            // B-053 diagnostics: the player as found, before the `load` path's await.
            const found = {
                index: playingQueueIndex(state),
                queue: state.getQueue().items.length,
            };

            // Empty hub session: keep our local queue as the offline fallback; allow the
            // first real user play to publish it.
            if (!hubSig) {
                lastQueueSig.current = '';
                return;
            }

            const targetSec = (session.positionMs ?? 0) / 1000;
            const targetIndex = session.index ?? 0;

            if (hubSig === localSig) {
                // We already hold this exact queue and audio is running here. With no
                // active device claimed, a playing local engine IS the live receiver —
                // re-claim at OUR live position. (This used to require having been the
                // active device a moment ago; anything else fell through to the rewind
                // branch below and yanked local playback back to the hub's frozen
                // cursor — which is what stopped auto-advance.)
                // Publishing here IS a claim — it promotes this client to active and starts
                // the session — so it needs more than `playing.current`, which only mirrors the
                // store. There are three windows where the store says PLAYING and the user asked
                // for nothing: while the hub is driving us, while an adopt-pause is still
                // settling, and in the beat right after `hardPause` deliberately set the store
                // PLAYING to correct a desync before pausing for real. A `session` frame landing
                // in that last one turned a watchdog pause into "this client takes the session
                // and plays" — the desktop starting up on its own after a cast transfer failed
                // and the hub handed the slot back as null. `playing.current` is kept as the
                // positive signal because the engine clock resets at every track boundary, and
                // requiring it would pause a client that is legitimately mid-queue.
                // B-058: a play requested since the adopt closes its window here too.
                const weAreTheLiveReceiver =
                    playing.current &&
                    !hubDriven.current.isOpen() &&
                    !isGuardOpen(adoptPauseGuard.current, Date.now(), lastPlayRequest()) &&
                    Date.now() - lastHardPauseAt.current >= 2000;
                if (weAreTheLiveReceiver) {
                    lastQueueSig.current = '';
                    publishQueue();
                    return;
                }
                // Otherwise another device owned this session and went away (a
                // force-stop). The hub kept ITS final position, and that — not our stale
                // local cursor — is where playback should resume. Aligning here is what
                // makes "force-stop the phone, press play on the desktop" continue from
                // the phone's spot instead of wherever this client was last parked.
                // W1: the session's play order too (its custodian kept the last one published),
                // so the song after this one is the one every controller shows. Only when it
                // differs: a session frame comes on every change, and setShuffle without an
                // order would re-shuffle.
                const adopt = adoptOf(session);
                if (adopt && orderDiffers(usePlayerStore.getState(), adopt)) {
                    setShuffle(
                        adopt.shuffle ? PlayerShuffle.TRACK : PlayerShuffle.NONE,
                        adopt.order,
                    );
                }
                const state2 = usePlayerStore.getState();
                const playingRow = playingQueueIndex(state2);
                const drift = Math.abs(positionMs.current - (session.positionMs ?? 0));
                if (targetIndex === playingRow && drift < 2000) {
                    // NOT pinned to hubSig: doing so made publishQueue's dedupe suppress
                    // every later publish, so a local play could never claim the session.
                    lastQueueSig.current = '';
                    return; // genuinely in sync
                }
                logAdopt('align', session, targetIndex, found);
                hubDriven.current.hold(2000);
                lastQueueSig.current = '';
                // Loaded PAUSED outright, as the branch below does. mediaPlayByIndex STARTS the
                // engine, asynchronously, so the pause after it could land first and the track
                // played for a moment: the blip when another device dropped out of the session
                // (seen 2026-09-30 — a `timeupdate` then a `pause` scrobble as Worbus for Android reinstalled).
                if (targetIndex !== playingRow) {
                    setQueue(
                        state2.getQueue().items,
                        targetIndex,
                        targetSec,
                        false,
                        adoptOf(session),
                    );
                }
                armSeek(targetIndex, targetSec, true);
                adoptPauseGuard.current = openAdoptPauseGuard();
                mediaPause();
                return;
            }

            const songs = await resolveSongs(hubTracks);
            if (!songs.length) return;
            logAdopt('load', session, targetIndex, found);
            hubDriven.current.hold(2000);
            // Seek is armed for onCurrentSongChange (a source reload loses an immediate
            // seek); `pause: true` re-asserts the paused state after the async load.
            pendingSeek.current = {
                armedAt: Date.now(),
                index: targetIndex,
                pause: true,
                sec: targetSec,
            };
            // Left empty (not pinned to hubSig) so the first local play republishes and
            // claims the session — the adopted queue is ours to own now.
            lastQueueSig.current = '';
            const guard = openAdoptPauseGuard();
            adoptPauseGuard.current = guard;
            // Loaded PAUSED outright. Loading it playing and pausing straight after was the
            // runaway: setQueue's PLAYING starts the engine asynchronously and the pause
            // could land first, so the audio arrived to a store that already read PAUSED —
            // and since the engines only act on status *changes*, every later pause (ours
            // and the user's click) was a no-op against it.
            setQueue(songs, targetIndex, targetSec, false, adoptOf(session));
            // Net for anything that still manages to start (an in-flight auto-resume, the
            // armed pendingSeek's own load). Only when audio is genuinely rolling — against
            // a truly silent player hardPause's play/pause correction would be the thing
            // making noise.
            setTimeout(() => {
                if (activeId.current === null) {
                    pauseIfRunaway('adopt, 400 ms re-check', guard.armedAt);
                }
            }, 400);
        },
        [armSeek, mediaPause, pauseIfRunaway, publishQueue, resolveSongs, setQueue, setShuffle],
    );

    /**
     * Run hub directives one at a time, in the order the hub sent them.
     *
     * They used to be fired off as independent promises, so a `load` or `queueChanged` that spent
     * a second resolving songs could still be running when the next seek, pause or release
     * arrived — and then finish last, replacing the queue, re-arming the hub-driven window and arming a
     * stale pending seek on top of newer intent. One mutable `pendingSeek` was never enough
     * correlation for that. Serializing costs nothing (the hub sends one directive at a time in
     * the normal case) and makes "last directive wins" actually true.
     */
    const directiveRunner = useRef(
        createDirectiveRunner<any, DoExit>({
            fallback: 'echo',
            onError: (msg, e) => console.error('[hub] directive failed', msg?.cmd, e),
        }),
    );
    const runDirective = useCallback(
        (msg: any): Promise<void> => {
            // I-031: the connection this directive arrived on. It may still be waiting in the
            // chain, or for a load's outcome, when the socket has dropped and come back; the
            // hub forgot it at that `welcome`, and it must not move the new connection's count.
            const conn = doEcho.current.conn;
            return directiveRunner.current(msg, handleDo, (exit) => {
                // The directive has ended, so its number is applied whichever way it
                // went (a throw included), and the hub is owed a report read from the
                // player AFTER it: until one arrives carrying this number, the hub
                // drops what this device reports.
                const moved = echoSettled(doEcho.current, msg?.seq, conn);
                if (moved) {
                    doEcho.current = moved;
                    if (exit !== 'silent') {
                        report(exit === 'echo' ? undefined : exit, true);
                    }
                }
            });
        },
        [handleDo, report],
    );

    // Held in a ref so the long-lived message handler below can call it without
    // the socket effect having to re-subscribe when the query client changes.
    const refreshLibrary = useLbBotLibraryRefresh();
    // The lb-bot index mirror: loaded from IndexedDB at startup, plus its
    // 15-minute backstop pull. The welcome/index triggers are below.
    useLbBotIndexSync();
    // Worbus P1: lb-bot's refusals (downloads off, this hub refused), from any route.
    useLbBotRefusals();
    const libraryRefresh = useRef(refreshLibrary);
    libraryRefresh.current = refreshLibrary;

    // Stream URLs embed the server origin and per-server credentials, so a server (or
    // credential) switch invalidates every memoized entry — otherwise the cast bridge
    // keeps being handed URLs signed for the previous server.
    useEffect(() => {
        streamUrlCache.current.clear();
    }, [serverId]);

    // Push config to the main-process transport on mount + whenever it changes.
    useEffect(() => {
        // F2: the Server tab's "connecting" starts here, and an earlier refusal is the old
        // token's: the transport tries again with whatever was just pushed.
        useHubStore.getState().actions.setStore({ attemptAt: Date.now(), authRefused: false });
        hub?.setSettings(settings.enabled, settings.url, settings.token, settings.name)
            // Worbus P2: then the sign-in that is due, with Connect on only (M4). A secret kept in
            // memory only is gone after a restart, and one that could not be decrypted is dropped:
            // main says a sign-in is owed, and the silent one is made (R7). A device still on a
            // typed token makes its upgrade sign-in (R23). Until a sign-in answers, a device with
            // no credential does not connect.
            .catch(() => undefined)
            // Also after a failed push: the auth state must become known (re-review N1).
            .finally(() => {
                void reconcileSignIn();
            });
    }, [settings.enabled, settings.name, settings.token, settings.url]);

    // Worbus P2 (design §6.5, the owner's 2026-11-02 answer): the hub identity IS the Navidrome
    // account. Every way the account changes lands here: the server list, adding, deleting or
    // editing a server (a new user or address under the same id: review I1), and the logout.
    useEffect(() => {
        if (!hub) return undefined;
        return useAuthStore.subscribe((state, prev) => {
            const change = accountChange(
                accountKey(prev.currentServer),
                accountKey(state.currentServer),
            );
            if (change === 'none') return;
            void followAccountChange(change);
        });
    }, []);

    // The network came back: have the transport look now rather than wait out a backoff that
    // may be parked at 30 s. (Waking from sleep is the main process's own hook.)
    useEffect(() => {
        if (!hub) return undefined;
        const onOnline = () => {
            hub.kick();
            // R31: a device waiting on a sign-in (unreachable, busy, Navidrome down) tries again.
            void reconcileSignIn();
        };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, []);

    // navi-connect: what the hub said about lb-bot (`welcome.lb`) is an answer
    // about THAT hub. Switched off, or pointed somewhere else, it no longer
    // describes anything this app talks to — forget it rather than let it stand
    // for the rest of the session (R17). A token or name change reconnects to
    // the same hub, whose next welcome restates it, so those keep it.
    //
    // Worbus P3 (design §6.5): "pointed somewhere else" is another SERVER - its key (`id:<id>`,
    // else the typed address as before). The same id at another address is no move; the first
    // welcome carrying the id re-keys what was kept under the address (copied, never wiped).
    const serverKey = useServerKey();
    const lbStatusHub = useRef(serverKey);
    useEffect(() => {
        const previous = lbStatusHub.current;
        const move = serverKeyMove(lbStatusHub.current, serverKey);
        const moved = move === 'moved';
        lbStatusHub.current = serverKey;
        if (move === 'rekey') {
            lbBotModeActions().rekey(previous, serverKey);
            // The mirror's own check: a meta under the address is adopted, not cleared.
            clearIndexMirrorForHubChange();
        }
        if (!settings.enabled || moved) {
            clearLbBotStatus();
            // Worbus P1: the progress, the refusal and this session's downloads mode were the
            // old hub's too. The mode falls back to the one remembered for the new URL.
            useHubStore
                .getState()
                .actions.setStore({ lbProgress: null, lbRefused: false, lbTooOld: false });
            lbBotModeActions().forgetSession();
        }
        // B-014: a MOVE only, unlike lbStatus above — switching the hub off is
        // not a different hub identity (R21 already hides the mirror then
        // without deleting it), but pointing at a different one is, and the
        // old hub's mirror otherwise keeps rendering under the new one.
        if (moved) {
            clearIndexMirrorForHubChange();
            // R29 (walk B3): a sign-in verdict - an older server above all - was about the old
            // address. Dropped, so the token field goes and the upgrade sign-in runs here.
            useHubStore.getState().actions.setStore({ signInResult: null });
        }
    }, [settings.enabled, serverKey]);

    // Worbus P3: main's server record and the live socket's address, at start and on each change.
    useEffect(() => {
        if (!hub) return undefined;
        const { setStore } = useHubStore.getState().actions;
        void hub
            .serverState()
            .then((server) => setStore({ server }))
            .catch(() => undefined);
        const offServer = hub.onServer((server) => {
            const before = useHubStore.getState().server?.record.serverId ?? null;
            setStore({ server });
            // Review C1: the record forgot its server or names another one - main forgot the
            // secret issued by the previous one. What this device holds is read again, and that
            // server's user flags are not this one's.
            if (before !== null && server.record.serverId !== before) {
                setStore({ user: null });
                void refreshAuthState().catch(() => undefined);
            }
        });
        // P3: the finder's state, and the Navidrome hosts it may look beside - at start and on
        // every account change (main keeps no other copy of the server list).
        void hub
            .finderState()
            .then((finder) => setStore({ finder }))
            .catch(() => undefined);
        const offFinder = hub.onFinderState((finder) => setStore({ finder }));
        hub.setNavidromeUrls(currentNavidromeUrls());
        const offAccount = useAuthStore.subscribe((state, prev) => {
            if (
                state.currentServer?.url === prev.currentServer?.url &&
                state.currentServer?.remoteUrl === prev.currentServer?.remoteUrl
            ) {
                return;
            }
            hub.setNavidromeUrls(currentNavidromeUrls());
        });
        return () => {
            offServer();
            offFinder();
            offAccount();
        };
    }, []);

    // Wire the inbound hub stream.
    useEffect(() => {
        if (!hub) return undefined;
        const { setStore } = useHubStore.getState().actions;
        const dispose = hub.onMessage((msg: any) => {
            if (msg.t === 'welcome') {
                // Worbus P2: who this socket acts for; absent from an older hub (null).
                const welcomeUser = parseHubUser(msg.user);
                // I-031: the one reset point of the command echo, on both sides.
                doEcho.current = echoWelcome(doEcho.current);
                // Worbus P2: the credential works; the next signed-out earns one silent try again.
                silentSignIn.welcome();
                // R35: a welcome naming a user is a hub of this round, whatever this session found
                // here before (upgraded in place): the older-hub verdict ends.
                if (welcomeUser && useHubStore.getState().signInResult?.kind === 'oldServer') {
                    setStore({ signInResult: null });
                }
                // R23 (a): connected on a typed token - sign in with the account now, so the token
                // is retired once the secret is held.
                if (!useHubStore.getState().authSignedIn) void upgradeFromToken();
                // Review M7: signed in as someone other than the current server's account (a
                // crash mid-switch, a change that was missed): follow it as a switch, once.
                const mismatchKey = `${welcomeUser?.name}\n${currentServerUsername()}`;
                if (
                    accountMismatch(
                        welcomeUser,
                        currentServerUsername(),
                        useHubStore.getState().authSignedIn,
                    ) &&
                    !reconciledMismatches.has(mismatchKey)
                ) {
                    reconciledMismatches.add(mismatchKey);
                    void followAccountChange('switch');
                }
                myId.current = msg.deviceId ?? null;
                noteActive(msg.session?.activeDeviceId ?? null);
                setStore({
                    activeDeviceId: activeId.current,
                    // I-031: a pin waits for an ack on the connection its act was sent on.
                    actPins: NO_PINS,
                    authRefused: false,
                    connected: true,
                    devices: msg.devices ?? [],
                    // Absent from an older hub: no `actAck`, so nothing is pinned.
                    features: Array.isArray(msg.features)
                        ? msg.features.filter((f: unknown) => typeof f === 'string')
                        : [],
                    myDeviceId: myId.current,
                    remoteIsPlaying: msg.session?.isPlaying ?? false,
                    remoteOrder: sessionOrder(msg.session?.order),
                    remotePositionAt: Date.now(),
                    remotePositionMs: msg.session?.positionMs ?? 0,
                    remoteQueue: msg.session?.queue ?? [],
                    remoteQueueIndex: msg.session?.index ?? 0,
                    remoteRepeat: msg.session?.repeat ?? 'none',
                    remoteShuffle: msg.session?.shuffle ?? false,
                    savedQueueId: msg.session?.savedQueueId ?? null,
                    // Worbus P4: absent from a server before project 4 (no line on the Server tab).
                    serverVersion: serverVersionOf(msg.server),
                    signedOut: false,
                    // A refusal from an earlier sign-in is history once a connection works.
                    signInResult: keptSignInResult(useHubStore.getState().signInResult),
                    // I-034: absent from a hub that holds no timer.
                    sleepTimer: sleepTimerFromFrame(
                        msg.session?.sleepTimer,
                        { activeDeviceId: activeId.current, myDeviceId: myId.current },
                        useHubStore.getState().sleepTimer,
                        Date.now(),
                    ),
                    user: welcomeUser,
                });
                // I-033: the hub's row for this device holds the level it was last told, or
                // one it kept from before a restart. Say the real one, whatever was sent on
                // the connection before this.
                volumeReport.current = NO_LEVEL_REPORT;
                volumeToldAt.current = null;
                reportVolume();
                // I-040: the station the session is bound to, with its cursor, so this device
                // knows `after` without a round trip. Only a hub with `station` sends either.
                {
                    const speaksStations = useHubStore.getState().features.includes('station');
                    useStationStore
                        .getState()
                        .actions.welcome(
                            speaksStations ? parseStationCursor(msg.station) : null,
                            speaksStations ? (msg.session?.stationId ?? null) : undefined,
                        );
                }
                reconcileRemoteActive();
                // Reconcile saved-queue history. Capture our LOCAL (possibly offline-
                // accumulated) rows FIRST, then adopt the hub's authoritative list (a
                // replace), then push the local rows up — the hub union-merges them and
                // rebroadcasts the complete list, so nothing offline is lost.
                {
                    const sqActions = useSavedQueuesStore.getState().actions;
                    const sid = serverIdRef.current;
                    const local = useSavedQueuesStore.getState().queues;
                    sqActions.mergeFromHub(
                        (msg.savedQueues ?? []).map((r: any) => mapHubSavedQueue(r, sid)),
                    );
                    if (local.length) {
                        sendAct('syncSavedQueues', { queues: local.map(savedQueueToHubRecord) });
                    }
                }
                // navi-connect: "Mixed for You". A plain replace, unlike the
                // saved queues above — a mix is created by hand on one device
                // and never published concurrently, so the hub's list IS the
                // list and there is nothing local to merge back up.
                useMixesStore.getState().actions.setMixes(mixesFromHub(msg.mixes));
                // navi-connect: lb-bot. `lb` states availability and the proxied
                // routes for this connection (absent from an older hub, which
                // falls back to the /lb/status probe). Then pull the index
                // mirror — on EVERY welcome, whatever `lbIndex` says: it is only
                // a hint, an up-to-date pull costs ~100 bytes, and a notify
                // missed while the hub was down would leave the hint stale.
                adoptLbBotWelcome(msg.lb);
                // Worbus P1: the welcome restates lb-bot's downloads mode (absent = an older
                // peer) and its index progress, and ends a refusal (B-263): a hub that
                // reconnected may have been upgraded to send lb-bot its token.
                const lbState = stateAfterWelcome(msg.lb);
                lbBotModeActions().adopt(lbState.mode);
                setStore({
                    lbProgress: parseProgress(msg.lbIndex?.progress),
                    lbRefused: lbState.refused,
                    // Worbus P2 (review I3): lb-bot without `identity` serves only the primary user.
                    lbTooOld: tooOldFromLb(msg.lb, welcomeUser),
                });
                // A `library` frame sent while this socket was down is lost, so
                // every cached lb-bot answer that marks ownership (Fresh, the
                // Deezer rows, similar artists) is re-asked — as Worbus for Android does on
                // every welcome (R28). Not a library event: no library refetch.
                // After the adopt: it reads the new verdict, and with lb-bot down
                // only marks stale. `lbIndex` lets it skip a reconnect across
                // which lb-bot's index did not move.
                invalidateLbBotOwnership(msg.lbIndex);
                requestIndexSync('welcome');
                // Hub is authoritative: adopt its session rather than pushing ours.
                void adoptIfNoLiveReceiver(msg.session);
            } else if (msg.t === 'session') {
                noteActive(msg.activeDeviceId ?? null);
                setStore({
                    activeDeviceId: activeId.current,
                    // I-031: a position pinned on the track this frame leaves is dropped.
                    actPins: pinsAfterFrame(msg.index ?? 0, msg.queue ?? []),
                    remoteIsPlaying: msg.isPlaying ?? false,
                    remoteOrder: sessionOrder(msg.order),
                    remotePositionAt: Date.now(),
                    remotePositionMs: msg.positionMs ?? 0,
                    remoteQueue: msg.queue ?? [],
                    remoteQueueIndex: msg.index ?? 0,
                    remoteRepeat: msg.repeat ?? 'none',
                    remoteShuffle: msg.shuffle ?? false,
                    savedQueueId: msg.savedQueueId ?? null,
                    // I-034: set, replaced or cleared - and whose it is to guard, when the
                    // frame moves the session to or from this device.
                    sleepTimer: sleepTimerFromFrame(
                        msg.sleepTimer,
                        { activeDeviceId: activeId.current, myDeviceId: myId.current },
                        useHubStore.getState().sleepTimer,
                        Date.now(),
                    ),
                });
                followSavedQueueCursor();
                // I-040: which station the live queue continues as (absent: a hub without it).
                if (useHubStore.getState().features.includes('station')) {
                    useStationStore.getState().actions.sessionStationId(msg.stationId ?? null);
                }
                reconcileRemoteActive();
                // Active device may have just dropped (activeId → null): adopt the
                // last-known queue locally, paused, so we're not stranded mirroring it.
                void adoptIfNoLiveReceiver(msg);
            } else if (msg.t === 'progress') {
                setStore({
                    // I-031: as on `session` - the device may have moved on to the next track.
                    actPins: pinsAfterFrame(msg.index ?? 0, useHubStore.getState().remoteQueue),
                    remoteIsPlaying: msg.isPlaying ?? false,
                    remotePositionAt: Date.now(),
                    remotePositionMs: msg.positionMs ?? 0,
                    remoteQueueIndex: msg.index ?? 0,
                });
                followSavedQueueCursor();
            } else if (msg.t === 'devices') {
                setStore({ devices: msg.devices ?? [] });
            } else if (msg.t === 'savedQueues') {
                // The hub's authoritative saved-queue history changed — reconcile it in.
                useSavedQueuesStore
                    .getState()
                    .actions.mergeFromHub(
                        (msg.queues ?? []).map((r: any) =>
                            mapHubSavedQueue(r, serverIdRef.current),
                        ),
                    );
                // The broadcast's cursor for the live record can be a track behind.
                followSavedQueueCursor();
            } else if (msg.t === 'mixes') {
                useMixesStore.getState().actions.setMixes(mixesFromHub(msg.mixes));
            } else if (msg.t === 'library') {
                // lb-bot placed an album somewhere on the network. Whichever
                // device did the asking, every device's idea of what the library
                // holds — and of what lb-bot still calls missing — is now stale.
                libraryRefresh.current(undefined, {
                    event: typeof msg.event === 'string' ? msg.event : undefined,
                    ndAlbumIds: Array.isArray(msg.ndAlbumIds) ? msg.ndAlbumIds : undefined,
                    ndArtistId: typeof msg.ndArtistId === 'string' ? msg.ndArtistId : undefined,
                });
                // A finished album override or merge announces itself here too (the
                // hub flushes its copy of /lb/overrides on this frame): the album and
                // merge lists and the sibling groups are re-read, trailing and
                // throttled like the `index` frame's.
                refreshLbBotOverrides(1500);
            } else if (msg.t === 'fill') {
                // A fill moved: lb-bot pushed its state or progress through the
                // hub. Nothing in the library changed, so nothing is refetched —
                // the ledger row is updated, through the same function the poll
                // uses (PROTOCOL §15.1).
                if (typeof msg.key === 'string' && typeof msg.kind === 'string') {
                    applyFillFrame(msg);
                }
            } else if (msg.t === 'lb') {
                // The hub's own probe changed its verdict on lb-bot (R18) —
                // the same object as `welcome.lb`, applied the same way. Coming
                // up is also a reason to pull the index: any trigger missed
                // while it was down would otherwise wait for the interval. And
                // it ends the sync's back-off (R22) — a plain 'index' trigger
                // is dropped while a retry is pending, and that retry was most
                // likely earned against the lb-bot that has just come back.
                lbBotModeActions().applyFrame(msg);
                // Worbus P2 (review I3): the frame restates `identity`; with it, an
                // `lbbot_too_old` this user got (lb-bot restarting, R17/R20) is over.
                setStore({ lbTooOld: tooOldFromLb(msg, useHubStore.getState().user) });
                if (adoptLbBotFrame(msg)) onLbBotAvailable();
            } else if (msg.t === 'index') {
                // lb-bot's library index moved. Like `fill`, NOT a library
                // event: nothing is refetched and no cache is cleared — the
                // local mirror pulls the delta and re-renders what reads it.
                if (typeof msg.seq === 'number' && typeof msg.epoch === 'string') {
                    // Worbus P1: the frame carries the index build's countdown (absent = none).
                    setStore({ lbProgress: parseProgress(msg.progress) });
                    // A progress-only frame (the head did not move past what the mirror holds)
                    // updates the bar alone: no mirror pull, no overrides re-read (Worbus for Android
                    // ruling 9). lb-bot sends one every few seconds during a build.
                    const frame = { epoch: msg.epoch, seq: msg.seq };
                    if (!isProgressOnlyFrame(frame, indexMirrorCursor())) {
                        onIndexFrame(msg.seq, msg.epoch);
                        // An override set from another device re-keys the index, so
                        // this frame is how it reaches us (I-019). Trailing and
                        // throttled: bulk builds send a frame every ~2 s.
                        refreshLbBotOverrides(3000);
                    }
                }
            } else if (msg.t === 'station') {
                // I-040: a station's cursor, steering, character or exhaustion moved, maybe
                // because another device topped it up: that is how this one learns `after`.
                const cursor = parseStationCursor(msg);
                if (cursor) useStationStore.getState().actions.stationFrame(cursor);
            } else if (msg.t === 'do') {
                if (msg.cmd === 'setVolume') applyVolume(msg.level);
                else void runDirective(msg);
            } else if (msg.t === 'user') {
                // Worbus P2: the hub re-read this user's flags (a demotion, a promotion) and
                // pushes them to every socket of theirs: the gates move in place. A frame this
                // client cannot read changes nothing, rather than reading as "no user" (today's
                // everything-shown).
                const user = parseHubUser(msg.user);
                if (user) setStore({ user });
            } else if (msg.t === 'signedOut') {
                // Worbus P2: main saw close 4005 (or `signed_out`), forgot the secret and stood
                // down. One silent sign-in with the current server's account; failing that, the
                // Server tab reads "Signed out of the Worbus Server".
                setStore({ authOwed: true, authSignedIn: false, user: null });
                void silentSignIn.signedOut();
            } else if (msg.t === 'oldServer') {
                // R24: main saw a 4001 answer a hello that carried the secret - a hub without
                // sign-in (rolled back). The secret is gone; the Server tab says so and shows the
                // token field for older servers.
                setStore({
                    authOwed: false,
                    authSignedIn: false,
                    signedOut: false,
                    signInResult: { kind: 'oldServer' },
                    user: null,
                });
            } else if (msg.t === 'disconnected') {
                // The main process lost the socket. Clear active/connected so
                // isRemoteSessionActive() releases the player bar and the local
                // watchdog stops force-pausing local audio; reset the guards so a
                // reconnect republishes cleanly.
                doEcho.current = echoDisconnected(doEcho.current);
                activeId.current = null;
                hubDriven.current.close();
                lastQueueSig.current = '';
                // A volume report waiting for its turn has nowhere to go; `welcome` sends one.
                if (volumeReportTimer.current !== null) {
                    clearTimeout(volumeReportTimer.current);
                    volumeReportTimer.current = null;
                }
                // Mixes live on the hub and are not cached locally, so a lost
                // socket means there are none — the alternative is a list of
                // cards whose every button silently does nothing.
                useMixesStore.getState().actions.reset();
                // I-040: the station engine is the hub's; it is asked again on the next welcome.
                useStationStore.getState().actions.connectionLost();
                // lb-bot is reached through the hub, so with the socket gone it
                // is unreachable until the next welcome says otherwise.
                markLbBotUnreachable();
                // savedQueueId is deliberately KEPT: we're still listening to the same
                // thing, so a reconnect must refresh that record rather than fork a
                // near-duplicate of the queue we never stopped playing.
                setStore({
                    activeDeviceId: null,
                    actPins: NO_PINS,
                    connected: false,
                    features: [],
                    savedQueueId: null,
                    // I-034: kept only where this device was the one playing. Its guard
                    // below is then what ends the music, and the control goes on saying so.
                    sleepTimer: sleepTimerOnDisconnect(useHubStore.getState().sleepTimer),
                });
            } else if (msg.t === 'ack') {
                // I-031: the hub's answer to one act of ours, written after every frame that
                // act caused - so the mirror already holds the outcome, and the value pinned
                // when the act was sent can give way to it. Only the newest act on a value
                // holds its pin (act-pins.ts); the ack of a skip or a queue edit releases
                // nothing. A refusal changed nothing on the hub and is told here, with the
                // code and message an `error` frame would have carried.
                if (typeof msg.cid === 'string') releaseActPin(msg.cid);
                if (msg.ok === false) toast.warn({ message: hubFailureMessage(msg) });
            } else if (msg.t === 'error') {
                // Surface hub-side failures (bad token, target offline, …) — they
                // were silent, so a wrong token just looked like "never connects".
                if (msg.code === 'auth') setStore({ authRefused: true });
                // Worbus P2: signed out is a state the Server tab shows, answered by a silent
                // sign-in (the `signedOut` frame from main), not a failure to toast.
                if (msg.code === 'signed_out') return;
                toast.warn({ message: hubFailureMessage(msg) });
            }
        });
        return () => dispose();
    }, [
        adoptIfNoLiveReceiver,
        applyVolume,
        publishQueue,
        reconcileRemoteActive,
        reportVolume,
        runDirective,
    ]);

    // I-034: the playing device's own guard on the session's sleep timer (sleep-timer.ts). The
    // hub pauses the session when the timer runs out, and that pause cannot reach a device
    // whose link has dropped. So while the timer held in the store is this device's to guard,
    // one timeout waits for 5 s past its end, and if the timer is still there then - no frame
    // cleared or replaced it - and this player is still playing, it is paused here. Every
    // change of the held timer (a frame, the lost link, a cancel made offline) asks again, so
    // a timer that is replaced is waited for at its own end and one that is cleared not at all.
    useEffect(() => {
        if (!hub) return undefined;
        let timeout: null | ReturnType<typeof setTimeout> = null;
        const ask = () => {
            if (timeout !== null) clearTimeout(timeout);
            timeout = null;
            const step = sleepGuardStep(
                useHubStore.getState().sleepTimer,
                Date.now(),
                usePlayerStore.getState().player.status === PlayerStatus.PLAYING,
            );
            if (step === null) return;
            if (typeof step === 'number') {
                timeout = setTimeout(ask, step);
                return;
            }
            // Its end is past and the hub has not said so: the timer is over here too.
            useHubStore.getState().actions.setStore({ sleepTimer: null });
            if (step === 'pause') {
                logger.info('[hub] sleep timer ended with no pause from the hub - pausing here');
                notePauseRequest();
                mediaPause();
            }
        };
        const unsubscribe = useHubStore.subscribe((state, prev) => {
            if (state.sleepTimer !== prev.sleepTimer) ask();
        });
        ask();
        return () => {
            unsubscribe();
            if (timeout !== null) clearTimeout(timeout);
        };
    }, [mediaPause]);

    // I-033: report the volume when it changes. The selector is what the hub is told (0 while
    // muted), so muting and unmuting are changes and a slider dragged under mute is not.
    useEffect(() => {
        if (!hub) return undefined;
        const unsubscribe = usePlayerStoreBase.subscribe(
            (state) => volumeLevel(state.player),
            () => reportVolume(),
        );
        return () => {
            unsubscribe();
            if (volumeReportTimer.current !== null) {
                clearTimeout(volumeReportTimer.current);
                volumeReportTimer.current = null;
            }
        };
    }, [reportVolume]);

    // Deleting the history record we're publishing into restarts the session, so the queue
    // still playing gets a fresh card instead of disappearing from Continue Listening.
    useEffect(() => {
        return onQueueSessionReset(() => {
            savedQueueId.current = null;
            savedQueueCoverSong.current = null;
            savedQueuePrevIds.current = [];
            lastQueueSig.current = '';
            publishQueue();
        });
    }, [publishQueue]);

    // Publish on queue-MEMBERSHIP changes too, not just song/status changes.
    // Auto DJ (and any enqueue) appends to the tail without moving the current
    // song or flipping play-state — the two events below drive publishQueue. So
    // without this, a top-up never reaches the hub until the track advances, and
    // a transfer taken mid-track hands the next device a stale (pre-top-up)
    // queue. publishQueue itself is idempotent (dedupes by signature) and gated
    // (the hub-driven window / active-or-none), so this can't echo hub-driven loads.
    useEffect(() => {
        if (!hub) return undefined;
        return usePlayerStoreBase.subscribe(
            // W1: the shuffle mode and the play order too - a toggle or re-shuffle on this device
            // is published (publishQueue's key decides whether the hub is told).
            (state) =>
                `${state
                    .getQueue()
                    .items.map((item) => item.id)
                    .join(',')}|${state.player.shuffle}|${state.queue.shuffled.join('.')}`,
            () => publishQueue(),
        );
    }, [publishQueue]);

    // Feed the refs from player events; publish queue changes + report when active.
    usePlayerEvents(
        {
            onCurrentSongChange: (properties) => {
                const { keep, land: pending } = armedSeekOnTrack(
                    pendingSeek.current,
                    properties.index,
                    Date.now(),
                    PENDING_SEEK_TTL,
                );
                pendingSeek.current = keep;
                if (pending) {
                    landingSeek.current = pending;
                    hubDriven.current.hold(2000);
                    // Small delay so the engine finishes loading the new source
                    // before the seek (same approach as use-queue-restore).
                    setTimeout(() => {
                        const fires = landingSeekFires(landingSeek.current, pending);
                        if (landingSeek.current === pending) landingSeek.current = null;
                        if (!fires) return;
                        mediaSeekToTimestamp(pending.sec);
                        if (pending.pause) {
                            // A load that raced its pause can still start playback
                            // async; re-assert the pause so a paused transfer STAYS
                            // paused. hardPause, not mediaPause: by then the store is
                            // back at PAUSED, which makes a plain pause a no-op against
                            // the playback that won the race.
                            // But only against audio that is actually ROLLING (B-051).
                            // hardPause forces the engine by flipping the store to
                            // PLAYING and back — against a track that loaded paused and
                            // is silent, which every adopt/transfer path now does, that
                            // flip IS the blip (Worbus for Android force-stopped while playing,
                            // 2026-09-30). A runaway shows as advancing progress within
                            // ~1 s, which is what audioIsRolling measures.
                            // B-058: ...and that nobody asked for since the load armed it.
                            setTimeout(() => {
                                pauseIfRunaway('armed seek, 1200 ms re-check', pending.armedAt);
                            }, 1200);
                        }
                    }, 150);
                }
                routeLocalPlayToRemote();
                publishQueue();
                // A track change starts the new song at 0, but the timestamp store can still
                // hold the OUTGOING track's offset (a queue loaded with setQueue is positioned
                // by its restore, 100 ms on). Reporting that pair parks the hub's cursor
                // minutes into a song that just started, which then reads as drift everywhere
                // that compares against it.
                // ...but NOT when a hub-driven load is positioning us (a pending seek, or
                // inside the hub-driven window) — there the hub's own offset is the truth
                // and reporting 0 would rewind the session it just handed us.
                const fromTheTop = !pendingSeek.current && !hubDriven.current.isOpen();
                if (fromTheTop) positionMs.current = 0;
                report(fromTheTop ? { positionMs: 0 } : undefined);
            },
            onPlayerProgress: (properties, prev) => {
                positionMs.current = Math.round(properties.timestamp * 1000);
                // Feed the engine-clock ground truth the watchdogs read — see audioIsRolling.
                playheadRun.current = notePlayheadStep(
                    playheadRun.current,
                    prev.timestamp,
                    properties.timestamp,
                    Date.now(),
                    // Q-051: a seek ends the run instead of joining it. Its writer marks the
                    // write, and zustand runs this handler synchronously inside that write.
                    isTimestampSeek(),
                );
                const rolling = audioIsRolling();
                // Watchdog: while another device is the active receiver, the
                // local engine must stay silent. Startup auto-resume can begin
                // (and keep) playing past the one-shot reconcile, so re-pause any
                // local playback that's still progressing. Fires only while local
                // audio actually advances, so it self-stops once truly paused.
                if (isRemoteActiveNow() && rolling && !hubDriven.current.isOpen()) {
                    hardPause('remote active, progress watchdog');
                    return;
                }
                // Just adopted an orphaned session (no active device) as PAUSED: an
                // in-flight auto-resume can start the engine right after and leave audio
                // running under a bar that reads "paused". Short window only — outside it
                // a local play with no active device is the user legitimately claiming
                // the session, and pausing that would fight them. B-058: so is a play asked
                // for INSIDE it - that closes the window (isGuardOpen).
                if (
                    activeId.current === null &&
                    rolling &&
                    isGuardOpen(adoptPauseGuard.current, Date.now(), lastPlayRequest())
                ) {
                    hardPause('adopt guard, progress watchdog');
                    return;
                }
                // Last net, and the only one that doesn't care what the hub is doing:
                // audio is advancing while the store insists it isn't. That is never
                // something the user asked for — they'd be looking at a paused bar — so
                // there's no intent here to fight. Silence it whether or not a hub session
                // is in play; this is what makes the state recoverable without a restart.
                if (!playing.current && rolling) {
                    hardPause('store paused, progress watchdog');
                    return;
                }
                // ~1 Hz per protocol §5 — the engine fires this several times a second.
                const now = Date.now();
                if (now - lastProgressReportAt.current < 1000) return;
                lastProgressReportAt.current = now;
                report();
            },
            onPlayerStatus: (properties, prev) => {
                playing.current = properties.status === PlayerStatus.PLAYING;
                // Q-051: a tick that lands after the store left PLAYING must not extend the
                // run it had, or the paused store reads as a runaway - see notePlayerStatus.
                playheadRun.current = notePlayerStatus(
                    playheadRun.current,
                    prev.status === PlayerStatus.PLAYING,
                    playing.current,
                );
                routeLocalPlayToRemote();
                publishQueue();
                // B-058: a play asked for inside an adopt's hub-driven window can't claim the
                // session yet (publishQueue returns early) and nothing republishes until the next
                // track - retry once the window lapses. publishQueue re-checks every gate itself:
                // paused meanwhile, it takes B-047's no-claim path. Asked again after each try, so
                // a window re-armed meanwhile is waited out too; claimed, paused or no longer
                // orphaned, the answer is null and it stops.
                const claimWhenWindowLapses = () => {
                    const claimInMs = adoptClaimDelay({
                        adopt: adoptPauseGuard.current,
                        hubDrivenUntil: hubDriven.current.until(),
                        now: Date.now(),
                        orphaned: activeId.current === null,
                        playing: playing.current,
                        request: lastPlayRequest(),
                    });
                    if (claimInMs === null) return;
                    setTimeout(() => {
                        publishQueue();
                        claimWhenWindowLapses();
                    }, claimInMs);
                };
                claimWhenWindowLapses();
                // Not hardPause's own PLAYING (see correctingStore): the pause after it reports.
                if (!correctingStore.current) report();
            },
        },
        [
            hardPause,
            mediaPause,
            mediaSeekToTimestamp,
            pauseIfRunaway,
            publishQueue,
            report,
            routeLocalPlayToRemote,
        ],
    );
};

export const HubHook = () => {
    useHub();
    return null;
};
