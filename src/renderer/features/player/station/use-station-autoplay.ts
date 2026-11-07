import type { StationAnswer, StationResult, StationSeed } from '/@/shared/types/station-types';

import React, { useEffect } from 'react';

import { eventEmitter } from '/@/renderer/events/event-emitter';
import { UserFavoriteEventPayload } from '/@/renderer/events/events';
import {
    enqueueToRemote,
    isRemoteSessionActive,
    remoteAct,
} from '/@/renderer/features/hub/utils/remote-queue';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    autoplayIsOn,
    autoplayToggleChip,
    ChipId,
    ChipTapPlan,
    keepsNext,
    planChipTap,
    QueueEntry,
    remoteEditActs,
    removableStationRows,
    REPLACE_COUNT,
    selectedChip,
} from '/@/renderer/features/player/station/station-chips';
import {
    currentCharacter,
    nextStation,
    probeStations,
    resolveStationSongs,
    signalStation,
    startStation,
} from '/@/renderer/features/player/station/station-client';
import {
    afterResolving,
    AnswerOutcome,
    AutoplayInput,
    continueSeedIds,
    decideAutoplay,
    excludeIds,
    idsInPlayOrder,
    NEXT_COUNT,
    outcomeOf,
    remainingLocal,
    remainingRemote,
    RETRY_DELAY_MS,
    RETRY_MAX,
    SERVED_ELSEWHERE_GRACE_MS,
    StationBinding,
} from '/@/renderer/features/player/station/station-logic';
import {
    getStationMode,
    servedIdsOf,
    useStationMode,
    useStationStore,
} from '/@/renderer/features/player/station/station-store';
import { onQueueSessionBegin } from '/@/renderer/features/player/utils/saved-queue-source';
import {
    isShuffleEnabled,
    useCurrentServerId,
    useHubStore,
    usePlayerStore,
    usePlayerStoreBase,
    useSettingsStore,
    useTimestampStoreBase,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import { LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';
import { Play, PlayerStatus } from '/@/shared/types/types';

/**
 * navi-connect stations (I-040): autoplay through the hub's engine. Mounted beside upstream's
 * `<AutoDJHook/>`; exactly one of the two runs (see `stationMode`).
 *
 * It keeps a short lookahead: when fewer than two tracks remain after the current one, in play
 * order, it asks for five more. A queue that belongs to a station asks that station (`next`,
 * `after` its cursor); any other queue continues as a new station seeded from the tracks just
 * played (`start` with `bindSession`). Skips and play-throughs are the hub's to judge from the
 * session's reports, so the next batch is steered within a few tracks.
 *
 * Two places can drive: this device while it plays, and this device as a controller while
 * another one plays (it then appends through the hub, as every edit from here does). If both
 * ask at once the hub's `after` rule serves one of them; the other learns the new cursor and
 * waits for that batch to land (SERVED_ELSEWHERE_GRACE_MS).
 */

interface Snapshot {
    /** The queue rows in play order, for the chips' edits (I-041). */
    entries: QueueEntry[];
    input: Omit<AutoplayInput, 'bound' | 'elsewhereRecent' | 'inFlight' | 'mode'>;
    /** Identifies the trigger: what is playing and how much is left. Retries are counted per key. */
    key: string;
    /** Songs this client already holds, so the answer's ids resolve without a request each. */
    known: Map<string, Song>;
    /** What is left of the playing track, ms, or null when its length is unknown (B-145). */
    playingLeftMs: null | number;
    /** The playing row's place in `entries`. */
    position: number;
    remote: boolean;
    /** Local rows by `_uniqueId`, for an in-place removal. */
    rows: Map<string, QueueSong>;
}

const readSnapshot = (): Snapshot => {
    const hub = useHubStore.getState();
    const deviceId = hub.myDeviceId ?? undefined;
    // What the bound station served this client: how a remote session's rows, which carry ids
    // only, are told apart from the user's (and a local row a controller added).
    const servedIds = servedIdsOf(useStationStore.getState());
    if (isRemoteSessionActive()) {
        const ids = hub.remoteQueue.map((track) => track.id);
        const order = hub.remoteOrder;
        const playOrder = idsInPlayOrder(ids, order);
        const position =
            order && order.length === ids.length
                ? order.indexOf(hub.remoteQueueIndex)
                : hub.remoteQueueIndex;
        const remaining = remainingRemote(hub.remoteQueueIndex, ids.length, order);
        const playIndexes =
            order && order.length === ids.length ? order : ids.map((_, index) => index);
        return {
            entries: playIndexes.map((queueIndex) => ({
                id: ids[queueIndex],
                key: String(queueIndex),
                queueIndex,
                stationAdded: servedIds.has(ids[queueIndex]),
            })),
            input: {
                deviceId,
                driving: true,
                enabled: useSettingsStore.getState().autoDJ.enabled,
                isPlaying: hub.remoteIsPlaying,
                queueIds: ids,
                remaining,
                savedQueueId: hub.savedQueueId,
                seedIds: continueSeedIds(playOrder, Math.max(0, position)),
                seedName: hub.remoteQueue[hub.remoteQueueIndex]?.title || undefined,
            },
            key: `r:${ids[hub.remoteQueueIndex] ?? ''}:${hub.remoteQueueIndex}:${remaining}:${ids.length}`,
            known: new Map(),
            playingLeftMs: (() => {
                const duration = hub.remoteQueue[hub.remoteQueueIndex]?.durationMs;
                if (!duration) return null;
                const at =
                    hub.remotePositionMs +
                    (hub.remoteIsPlaying ? Date.now() - hub.remotePositionAt : 0);
                return duration - at;
            })(),
            position: Math.max(0, position),
            remote: true,
            rows: new Map(),
        };
    }

    const state = usePlayerStore.getState();
    const items = state.getQueue().items;
    const playIndex = state.player.index;
    const shuffled = isShuffleEnabled(state) ? state.queue.shuffled : null;
    const playOrderSongs = shuffled ? shuffled.map((index) => items[index]) : items;
    const playOrder = playOrderSongs.map((song) => song?.id ?? '');
    const current = playOrderSongs[playIndex];
    const remaining = remainingLocal(playIndex, playOrderSongs.length);
    const queueIndexOf = new Map(items.map((song, index) => [song._uniqueId, index]));
    // This queue reaches the hub as a `setQueue` once its tracks are built (use-hub), so for a
    // moment after a replace the session, and `hub.savedQueueId`, are still the queue before it.
    const sessionHoldsQueue =
        !hub.connected ||
        (hub.remoteQueue.length === items.length &&
            hub.remoteQueue.every((track, index) => track.id === items[index]?.id));
    return {
        entries: playOrderSongs
            .filter((song): song is QueueSong => Boolean(song))
            .map((song) => ({
                id: song.id,
                key: song._uniqueId,
                queueIndex: queueIndexOf.get(song._uniqueId) ?? -1,
                stationAdded: Boolean(song._stationId) || servedIds.has(song.id),
            })),
        input: {
            deviceId,
            driving: true,
            enabled: useSettingsStore.getState().autoDJ.enabled,
            isPlaying: Boolean(current?.id) && state.player.status === PlayerStatus.PLAYING,
            queueIds: items.map((song) => song.id),
            remaining,
            savedQueueId: hub.savedQueueId,
            seedIds: current ? continueSeedIds(playOrder, playIndex) : [],
            seedName: current?.name || undefined,
            sessionHoldsQueue,
        },
        key: `l:${current?._uniqueId ?? ''}:${remaining}:${items.length}`,
        known: new Map(items.map((song) => [song.id, song as Song])),
        playingLeftMs: current?.duration
            ? current.duration - (useTimestampStoreBase.getState().timestamp || 0) * 1000
            : null,
        position: playIndex,
        remote: false,
        rows: new Map(items.map((song) => [song._uniqueId, song])),
    };
};

/**
 * A chip's queue edit (I-041), around the playing track and the one after it, which
 * `removableStationRows` never includes: take out `remove`, then add `add` at the end. Locally an
 * in-place removal and an append; on a remote session one `remove` act per row, highest index
 * first, and one `enqueue` (through the player context), never a `setQueue`, which would make
 * the playing device reload its queue.
 */
/**
 * Wait until the hub's mirror of a remote session holds `length` rows (or `ms` passed). An edit
 * sent through the hub lands a round trip later; until then the mirror still shows the queue
 * before it, and a top-up decided on that would ask for a batch the edit already supplied.
 */
const remoteSettled = (length: number, ms = 4000): Promise<void> =>
    new Promise((resolve) => {
        if (useHubStore.getState().remoteQueue.length === length) return resolve();
        const timer = setTimeout(done, ms);
        const unsub = useHubStore.subscribe((state) => {
            if (state.remoteQueue.length === length) done();
        });
        function done() {
            clearTimeout(timer);
            unsub();
            resolve();
        }
    });

const editQueue = async (
    snap: Snapshot,
    remove: QueueEntry[],
    add: Song[],
    addToQueue: (songs: Song[]) => Promise<void> | void,
): Promise<void> => {
    if (snap.remote) {
        const acts = remoteEditActs(
            remove.map((row) => row.queueIndex),
            add.length,
        );
        const removing = acts.filter((act) => act.action === 'remove').length;
        for (const act of acts) {
            if (act.action === 'remove') remoteAct('remove', { index: act.index });
            // The session's one `enqueue` at the end.
            else await addToQueue(add);
        }
        await remoteSettled(
            snap.entries.length - removing + (acts.length > removing ? add.length : 0),
        );
        return;
    }
    if (remove.length > 0) {
        const rows = remove
            .map((row) => snap.rows.get(row.key))
            .filter((row): row is QueueSong => Boolean(row));
        usePlayerStore.getState().clearSelected(rows);
    }
    if (add.length > 0) await addToQueue(add);
};

type ChipRunner = (chip: ChipId, plan: ChipTapPlan) => Promise<void>;
let chipRunner: ChipRunner | null = null;

/**
 * A chip was tapped (I-041). The preference and what the chip row shows change at once; the
 * signal and the queue edit then run in the autoplay hook, one at a time with its own requests,
 * and the top-up decision runs straight after, so the queue changes now, not at the next top-up.
 */
export const tapStationChip = (chip: ChipId): void => {
    const settings = useSettingsStore.getState();
    const station = useStationStore.getState();
    const hub = useHubStore.getState();
    const snap = readSnapshot();
    const plan = planChipTap(
        chip,
        {
            autoplay: settings.autoDJ.enabled,
            bound: station.bound,
            // B-143: the hub edits the session's bound station's queue itself, wherever it plays.
            hubEdits:
                hub.connected &&
                hub.features.includes('stationEdits') &&
                Boolean(station.bound) &&
                !station.bound?.unbound,
            mode: getStationMode(),
            preferred: settings.station?.character ?? 'balanced',
        },
        {
            keepNext: keepsNext(snap.playingLeftMs),
            playOrder: snap.entries,
            position: snap.position,
        },
    );
    settings.actions.setSettings({
        autoDJ: { enabled: plan.autoplay },
        ...(plan.character ? { station: { character: plan.character } } : {}),
    });
    if (plan.kickAutoDj) station.actions.kickAutoDj();
    if (station.bound && plan.optimistic) {
        station.actions.adopt({ ...station.bound, ...plan.optimistic });
    }
    if (chipRunner) {
        void chipRunner(chip, plan);
    } else if (plan.signal) {
        // The hook is not running (the engine's probe has not answered): steer, edit nothing.
        void signalStation(plan.signal.kind, {
            ...(plan.apply ? { apply: true } : {}),
            ...(plan.signal.kind === 'character' ? { value: plan.signal.value } : {}),
        });
    }
};

/**
 * The side queue's Autoplay toggle (F4): a tap on Off or on a character, through the same plan as
 * the chips. Turning a stopped station back on restarts it in its own character, not this
 * device's preference. A tap that would select what is already selected does nothing.
 */
export const toggleStationAutoplay = (on: boolean): void => {
    const settings = useSettingsStore.getState();
    const bound = useStationStore.getState().bound;
    const mode = getStationMode();
    const preferred = settings.station?.character ?? 'balanced';
    const selected = selectedChip({ autoplay: settings.autoDJ.enabled, bound, mode, preferred });
    if (autoplayIsOn(selected) === on) return;
    tapStationChip(autoplayToggleChip(on, mode !== 'fallback', bound?.character ?? preferred));
};

const StationAutoplayInner = () => {
    const player = usePlayer();
    const serverId = useCurrentServerId();

    useEffect(() => {
        let disposed = false;
        let inFlight = false;
        // A new listening session, or a new hub queue, makes an answer still in flight stale.
        let sessionSerial = 0;
        const generation = () => `${sessionSerial}:${useHubStore.getState().savedQueueId ?? ''}`;
        let retry: { count: number; key: string; timer: null | ReturnType<typeof setTimeout> } = {
            count: 0,
            key: '',
            timer: null,
        };
        // The station a 404 already restarted, so an expired one is started again only once.
        let restartedFrom: null | string = null;

        const scheduleRecheck = (key: string, delay = RETRY_DELAY_MS) => {
            if (retry.timer) clearTimeout(retry.timer);
            if (retry.key !== key) retry = { count: 0, key, timer: null };
            if (retry.count >= RETRY_MAX) return;
            retry.count += 1;
            retry.timer = setTimeout(() => {
                retry.timer = null;
                void evaluate();
            }, delay);
        };

        // Waiters for the request in flight to end: a chip's edit runs after it, never beside it.
        let idleWaiters: Array<() => void> = [];
        const waitIdle = () =>
            inFlight
                ? new Promise<void>((resolve) => idleWaiters.push(resolve))
                : Promise.resolve();

        const release = () => {
            inFlight = false;
            useStationStore.getState().actions.setInFlight(false);
            const waiters = idleWaiters;
            idleWaiters = [];
            for (const resolve of waiters) resolve();
        };

        /** The station's songs, marked as its own (the chips take out only those). */
        const stationSongs = (songs: Song[], stationId: string): Song[] =>
            songs.map((song) => ({ ...song, _stationId: stationId }));

        /**
         * Add at the end of the queue being listened to. On a remote session this is the one
         * `enqueue` (never a setQueue), awaited until the hub's mirror shows it, so no top-up is
         * decided on the queue as it was before.
         */
        const addToQueue = async (songs: Song[]) => {
            if (songs.length === 0) return;
            if (isRemoteSessionActive()) {
                const before = useHubStore.getState().remoteQueue.length;
                if (await enqueueToRemote(songs, 'end')) {
                    await remoteSettled(before + songs.length);
                    return;
                }
            }
            player.addToQueueByData(songs, Play.LAST);
            eventEmitter.emit('AUTODJ_QUEUE_ADDED', { songCount: songs.length });
        };

        const append = async (songs: Song[], stationId: string) => {
            if (songs.length === 0) return;
            useStationStore.getState().actions.noteServed(
                stationId,
                songs.map((song) => song.id),
            );
            await addToQueue(stationSongs(songs, stationId));
        };

        /** Carry out what an answer means. Returns true when it asks to look again at once. */
        const apply = async (
            outcome: AnswerOutcome,
            asked: 'next' | 'start',
            snap: Snapshot,
            askedAt: string,
            previous: null | StationBinding,
        ): Promise<'again' | 'done' | { restart: StationBinding }> => {
            const actions = useStationStore.getState().actions;
            switch (outcome.kind) {
                case 'adopt':
                    actions.adopt(outcome.binding, {
                        elsewhere: outcome.servedElsewhere,
                        hold: asked === 'start',
                    });
                    if (outcome.recheck) {
                        scheduleRecheck(
                            snap.key,
                            outcome.servedElsewhere ? SERVED_ELSEWHERE_GRACE_MS : RETRY_DELAY_MS,
                        );
                    }
                    return 'done';
                case 'append': {
                    const songs = await resolveStationSongs(outcome.tracks, serverId, snap.known);
                    if (disposed || generation() !== askedAt) return 'done';
                    const resolved = afterResolving(outcome, songs.length);
                    if (resolved.kind !== 'append') {
                        // Nothing in the batch is on this server: the cursor moved past it, so
                        // this is a partial answer. Ask again shortly; never append stubs.
                        useStationStore.setState({ lastPartial: true });
                        return apply(resolved, asked, snap, askedAt, previous);
                    }
                    actions.adopt(outcome.binding, { hold: asked === 'start' });
                    // "Fewer tracks than asked" only when there were: a hub that cannot reach
                    // AudioMuse answers every Tier 1 batch `partial`, full ones included.
                    useStationStore.setState({
                        lastPartial: outcome.partial && songs.length < NEXT_COUNT,
                    });
                    await append(songs, outcome.binding.stationId);
                    return 'done';
                }
                case 'continue': {
                    // Another device bound the session first: this queue is that station's now.
                    const cursor = useStationStore.getState().cursors[outcome.stationId];
                    actions.adopt(
                        {
                            character: cursor?.character ?? currentCharacter(),
                            engine: null,
                            exhausted: cursor?.exhausted ?? false,
                            name: cursor?.name ?? '',
                            origin: cursor?.origin ?? null,
                            rev: cursor?.rev ?? 0,
                            seed: cursor?.seed ?? null,
                            seq: cursor?.seq ?? 0,
                            stationId: outcome.stationId,
                            stopped: cursor?.stopped ?? false,
                        },
                        { hold: true },
                    );
                    return 'again';
                }
                case 'fallback':
                    // Latched by the client: this hook unmounts and Auto DJ takes over.
                    return 'done';
                case 'restart':
                    if (!previous || restartedFrom === previous.stationId) {
                        // Restarted once already: let the queue continue as a new station.
                        actions.adopt(null, { hold: true });
                        return 'again';
                    }
                    return { restart: previous };
                case 'retry':
                default:
                    if (outcome.kind === 'retry' && outcome.transient) scheduleRecheck(snap.key);
                    return 'done';
            }
        };

        // `depth` bounds the chains one answer can start (409 -> next -> 404 -> start ...).
        const evaluate = async (depth = 0, fromTap = false): Promise<void> => {
            if (disposed || inFlight) return;
            const snap = readSnapshot();
            const s = useStationStore.getState();
            const decision = decideAutoplay(
                {
                    ...snap.input,
                    bound: s.bound,
                    elsewhereRecent: Date.now() - s.elsewhereAt < SERVED_ELSEWHERE_GRACE_MS,
                    // B-144: a tap's top-up does not wait for playback to resume.
                    ignorePaused: fromTap,
                    inFlight,
                    mode: getStationMode(),
                },
                currentCharacter(),
            );
            if (decision.kind === 'wait') {
                if (decision.reason === 'served-elsewhere') {
                    scheduleRecheck(snap.key, SERVED_ELSEWHERE_GRACE_MS);
                }
                return;
            }

            inFlight = true;
            s.actions.setInFlight(true);
            const askedAt = generation();
            const previous = s.bound;
            let next: 'again' | 'done' | { restart: StationBinding } = 'done';
            try {
                logger.info('Station autoplay', {
                    after: decision.kind === 'next' ? decision.body.after : undefined,
                    kind: decision.kind,
                    remaining: snap.input.remaining,
                });
                const result: StationResult<StationAnswer> =
                    decision.kind === 'next'
                        ? await nextStation(decision.body)
                        : await startStation(decision.body);
                if (disposed || generation() !== askedAt) return;
                next = await apply(
                    outcomeOf(result, useStationStore.getState().bound, decision.kind, {
                        askedBind: decision.kind === 'start' && Boolean(decision.body.bindSession),
                    }),
                    decision.kind,
                    snap,
                    askedAt,
                    previous,
                );

                if (typeof next === 'object') {
                    // 404 station_unknown: the hub lost this station (it expired, or the hub's
                    // state went). Start it once again from the seed this client kept, or from
                    // what just played when it kept none.
                    restartedFrom = next.restart.stationId;
                    const seed: null | StationSeed =
                        next.restart.seed ??
                        (snap.input.seedIds.length > 0
                            ? {
                                  ids: [...snap.input.seedIds],
                                  kind: 'tracks',
                                  ...(snap.input.seedName ? { name: snap.input.seedName } : {}),
                              }
                            : null);
                    useStationStore.getState().actions.adopt(null, { hold: true });
                    if (!seed) {
                        next = 'again';
                    } else {
                        // An unbound station stays unbound: its restart asks no bind either.
                        const bindSession =
                            snap.input.savedQueueId && !next.restart.unbound
                                ? snap.input.savedQueueId
                                : undefined;
                        const restarted = await startStation({
                            ...(bindSession ? { bindSession } : {}),
                            character: next.restart.character,
                            count: NEXT_COUNT,
                            exclude: decision.body.exclude,
                            ...(next.restart.origin ? { origin: next.restart.origin } : {}),
                            seed,
                        });
                        if (disposed || generation() !== askedAt) return;
                        next = await apply(
                            outcomeOf(restarted, null, 'start', {
                                askedBind: Boolean(bindSession),
                            }),
                            'start',
                            snap,
                            askedAt,
                            null,
                        );
                        if (typeof next === 'object') next = 'done';
                    }
                }
            } catch (error) {
                logger.error('Station autoplay failed', { error: (error as Error).message });
                scheduleRecheck(snap.key);
            } finally {
                if (!disposed) release();
            }
            if (next === 'again' && depth < 3) void evaluate(depth + 1);
        };

        // What to watch: the local queue and player, the hub's session mirror (for a remote
        // session), and the binding's identity and exhaustion. Not its cursor: a cursor moved by
        // another device is waited on, not answered (SERVED_ELSEWHERE_GRACE_MS).
        const unsubPlayer = usePlayerStoreBase.subscribe(
            (state) => {
                const queue = state.getQueue();
                const shuffled = isShuffleEnabled(state);
                const length = shuffled ? state.queue.shuffled.length : queue.items.length;
                const index = state.player.index;
                const song = shuffled
                    ? queue.items[state.queue.shuffled[index]]
                    : queue.items[index];
                return {
                    length,
                    remaining: length - index - 1,
                    status: state.player.status,
                    uniqueId: song?._uniqueId,
                };
            },
            () => void evaluate(),
            {
                equalityFn: (a, b) =>
                    a.uniqueId === b.uniqueId &&
                    a.remaining === b.remaining &&
                    a.length === b.length &&
                    a.status === b.status,
            },
        );

        let hubSig = '';
        const unsubHub = useHubStore.subscribe((state) => {
            const sig = [
                state.connected,
                state.activeDeviceId,
                state.remoteQueueIndex,
                state.remoteQueue.length,
                state.remoteQueue[state.remoteQueueIndex]?.id,
                state.remoteIsPlaying,
                state.remoteOrder?.length ?? 0,
                state.savedQueueId,
            ].join('|');
            if (sig === hubSig) return;
            hubSig = sig;
            // After the rest of this frame's handler: use-hub writes the session's queue first and
            // its `stationId` after, so looking now saw a new queue still bound to the old
            // station, and a controller topped the new queue up from the old radio (walk W7).
            queueMicrotask(() => void evaluate());
        });

        let stationSig = '';
        const unsubStation = useStationStore.subscribe((state) => {
            const sig = `${state.bound?.stationId ?? ''}|${state.bound?.exhausted ?? ''}`;
            if (sig === stationSig) return;
            stationSig = sig;
            void evaluate();
        });

        const unsubSession = onQueueSessionBegin(() => {
            sessionSerial += 1;
        });

        // I-041: a chip's signal and queue edit, after any request of this hook's own.
        chipRunner = async (chip, plan) => {
            await waitIdle();
            if (disposed) return;
            let swapped = false;
            inFlight = true;
            useStationStore.getState().actions.setInFlight(true);
            const askedAt = generation();
            try {
                const store = useStationStore.getState();
                const tapped = store.bound;
                // An answer that landed while this waited may have restated the old state.
                if (tapped && plan.optimistic) {
                    store.actions.adopt({ ...tapped, ...plan.optimistic });
                }

                if (plan.apply && plan.signal && tapped) {
                    // B-143: the hub cuts the station's rows, inserts a batch for a character,
                    // and tells the playing device; this queue changes through the session and
                    // its queueChanged like any other edit. Nothing is removed, enqueued or asked
                    // for from here.
                    const signal = plan.signal;
                    const answer = await signalStation(signal.kind, {
                        apply: true,
                        ...(signal.kind === 'character' ? { value: signal.value } : {}),
                    });
                    if (answer?.edited === false) {
                        logger.info('Station chip: the hub edited nothing', {
                            kind: signal.kind,
                            reason: answer.reason,
                        });
                    }
                    const now = useStationStore.getState().bound;
                    if (answer?.applied && now?.stationId === tapped.stationId) {
                        useStationStore.getState().actions.adopt({
                            ...now,
                            ...(signal.kind === 'character'
                                ? { character: signal.value, exhausted: false, stopped: false }
                                : { stopped: true }),
                            rev: Math.max(now.rev, answer.rev),
                        });
                    }
                    return;
                }

                if (plan.signal?.kind === 'stop') {
                    // Off: take out what the station queued that has not played, then stop it
                    // for every device. Nothing more is added while it stays Off.
                    const snap = readSnapshot();
                    await editQueue(
                        snap,
                        removableStationRows(
                            snap.entries,
                            snap.position,
                            keepsNext(snap.playingLeftMs),
                        ),
                        [],
                        addToQueue,
                    );
                    await signalStation('stop');
                    return;
                }
                if (chip === 'off') {
                    // No station: only the preference changed. Already stopped: still take out
                    // anything of the station's left behind.
                    if (!tapped) return;
                    const snap = readSnapshot();
                    await editQueue(
                        snap,
                        removableStationRows(
                            snap.entries,
                            snap.position,
                            keepsNext(snap.playingLeftMs),
                        ),
                        [],
                        addToQueue,
                    );
                    return;
                }

                if (plan.signal?.kind === 'character' && tapped) {
                    const value = plan.signal.value;
                    const answer = await signalStation('character', { value });
                    if (disposed || generation() !== askedAt) return;
                    const now = useStationStore.getState().bound;
                    if (answer?.applied && now?.stationId === tapped.stationId) {
                        // The hub has the change: exhaustion and a stop are lifted with it.
                        useStationStore.getState().actions.adopt({
                            ...now,
                            character: value,
                            exhausted: false,
                            rev: Math.max(now.rev, answer.rev),
                            stopped: false,
                        });
                    }
                }

                const bound = useStationStore.getState().bound;
                if (!plan.replaceCount || !bound || disposed) return;
                const before = readSnapshot();
                if (
                    removableStationRows(
                        before.entries,
                        before.position,
                        keepsNext(before.playingLeftMs),
                    ).length === 0
                )
                    return;
                // Swap what the station had queued for a batch in the new character, now.
                const result = await nextStation({
                    after: bound.seq,
                    count: REPLACE_COUNT,
                    exclude: excludeIds(before.input.queueIds),
                    stationId: bound.stationId,
                });
                if (disposed || generation() !== askedAt) return;
                const outcome = outcomeOf(result, useStationStore.getState().bound, 'next');
                if (outcome.kind !== 'append') {
                    // Nothing to swap in (exhausted, served elsewhere, a failure): keep what is
                    // queued rather than leave the queue shorter.
                    if (outcome.kind === 'adopt') store.actions.adopt(outcome.binding);
                    return;
                }
                const songs = await resolveStationSongs(outcome.tracks, serverId, before.known);
                if (disposed || generation() !== askedAt) return;
                useStationStore.getState().actions.adopt(outcome.binding);
                if (songs.length === 0) return;
                useStationStore.getState().actions.noteServed(
                    outcome.binding.stationId,
                    songs.map((song) => song.id),
                );
                // Read the queue again: the playing track may have moved on while this asked.
                const latest = readSnapshot();
                await editQueue(
                    latest,
                    removableStationRows(
                        latest.entries,
                        latest.position,
                        keepsNext(latest.playingLeftMs),
                    ),
                    stationSongs(songs, outcome.binding.stationId),
                    addToQueue,
                );
                // The swap put a batch after the next track: the top-up has nothing to add.
                swapped = true;
            } catch (error) {
                logger.error('Station chip failed', { chip, error: (error as Error).message });
            } finally {
                if (!disposed) release();
                if (plan.topUp && !swapped && !disposed) void evaluate(0, true);
            }
        };

        // Autoplay switched On at a queue's end continues it at once; switched Off, only a radio
        // goes on (decideAutoplay).
        const unsubAutoplay = useSettingsStore.subscribe(
            (state) => state.autoDJ.enabled,
            () => void evaluate(),
        );

        void evaluate();

        return () => {
            disposed = true;
            if (retry.timer) clearTimeout(retry.timer);
            unsubPlayer();
            unsubHub();
            unsubStation();
            unsubSession();
            unsubAutoplay();
            chipRunner = null;
            useStationStore.getState().actions.setInFlight(false);
        };
    }, [player, serverId]);

    return null;
};

/**
 * Mounted whenever the engine is there, Autoplay On or Off: a radio keeps going either way, and
 * the switch decides only whether a queue no radio built is continued (decideAutoplay).
 * Upstream's Auto DJ, the fallback, obeys the switch as upstream does.
 */
export const StationAutoplayHook = () => {
    const mode = useStationMode();
    if (mode !== 'stations') return null;
    return React.createElement(StationAutoplayInner);
};

// --- The probe, and likes ------------------------------------------------------------------------

const PROBE_EVERY_MS = 10 * 60 * 1000;
const PROBE_AFTER_FAILURE_MS = 60 * 1000;
/** A star is sent once it has settled: the favorite mutation reverts an optimistic one that failed. */
const LIKE_SETTLE_MS = 1500;

const SONG_TYPES = new Set<LibraryItem>([
    LibraryItem.PLAYLIST_SONG,
    LibraryItem.QUEUE_SONG,
    LibraryItem.SONG,
]);

/** The ids of the queue being listened to: this device's, or the session's while another plays. */
const listenedQueueIds = (): Set<string> =>
    new Set(
        isRemoteSessionActive()
            ? useHubStore.getState().remoteQueue.map((track) => track.id)
            : usePlayerStore
                  .getState()
                  .getQueue()
                  .items.map((song) => song.id),
    );

/**
 * Always mounted (desktop). Asks the hub what its engine can do on every connection that
 * advertises `station`, again every 10 minutes and a minute after it said no; and sends likes.
 * A star goes from this client straight to Navidrome and the hub never sees it, so a like or
 * unlike of a track in a station's queue is told to the station here.
 */
const StationServiceInner = () => {
    useEffect(() => {
        let disposed = false;
        let timer: null | ReturnType<typeof setTimeout> = null;
        let probing = false;

        const schedule = (delay: number) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void probe(), delay);
        };

        const probe = async () => {
            const hub = useHubStore.getState();
            if (disposed || probing || !hub.connected || !hub.features.includes('station')) return;
            probing = true;
            try {
                const catalog = await probeStations();
                if (disposed) return;
                useStationStore.getState().actions.setCatalog(catalog);
                logger.info('Station engine probed', {
                    available: catalog?.available ?? false,
                    engine: catalog?.engine ?? null,
                });
                schedule(catalog?.available ? PROBE_EVERY_MS : PROBE_AFTER_FAILURE_MS);
            } finally {
                probing = false;
            }
        };

        let connectionSig = '';
        const unsubHub = useHubStore.subscribe((state) => {
            const sig = `${state.connected}|${state.features.includes('station')}`;
            if (sig === connectionSig) return;
            connectionSig = sig;
            if (state.connected && state.features.includes('station')) {
                void probe();
            } else if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });
        // A 503 latched the fallback: ask again in a minute rather than waiting ten.
        let latched = useStationStore.getState().fallbackLatched;
        const unsubStation = useStationStore.subscribe((state) => {
            if (state.fallbackLatched && !latched) schedule(PROBE_AFTER_FAILURE_MS);
            latched = state.fallbackLatched;
        });

        const pendingLikes = new Map<string, ReturnType<typeof setTimeout>>();
        const onFavorite = (payload: UserFavoriteEventPayload) => {
            if (!SONG_TYPES.has(payload.itemType)) return;
            if (!useStationStore.getState().bound || getStationMode() !== 'stations') return;
            const queued = listenedQueueIds();
            for (const id of payload.id) {
                if (!queued.has(id)) continue;
                const waiting = pendingLikes.get(id);
                if (waiting) clearTimeout(waiting);
                pendingLikes.set(
                    id,
                    setTimeout(() => {
                        pendingLikes.delete(id);
                        void signalStation(payload.favorite ? 'like' : 'unlike', { trackId: id });
                    }, LIKE_SETTLE_MS),
                );
            }
        };
        eventEmitter.on('USER_FAVORITE', onFavorite);

        const hub = useHubStore.getState();
        connectionSig = `${hub.connected}|${hub.features.includes('station')}`;
        void probe();

        return () => {
            disposed = true;
            if (timer) clearTimeout(timer);
            for (const waiting of pendingLikes.values()) clearTimeout(waiting);
            unsubHub();
            unsubStation();
            eventEmitter.off('USER_FAVORITE', onFavorite);
        };
    }, []);

    return null;
};

export const StationServiceHook = () => React.createElement(StationServiceInner);
