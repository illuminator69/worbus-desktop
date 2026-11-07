import { SavedQueueKind, useSavedQueuesStore } from '/@/renderer/store/saved-queues.store';
import { QueueSong } from '/@/shared/types/domain-types';

// navi-connect: session identity + kind/name stamping for saved queues.
//
// Worbus for desktop's setQueue carries no notion of WHERE a queue came from, so a call site that knows
// (an album/playlist play, a radio/journey/mood-flow generator) announces it here right before it
// builds the queue. That announcement does two things:
//
//   1. it names the queue — stamped ONCE, at birth, and never rewritten by playback; and
//   2. it declares "this is a NEW listening session", which is the only thing that mints a new
//      history record. Editing the playing queue (reorder, remove, play-next, Auto DJ top-up,
//      shuffle) is not a new session — it updates the record in place. Matching on queue
//      membership instead used to fork a near-duplicate card on every single edit.

interface SourceHint {
    at: number;
    // Resuming a saved queue continues THAT record — the announcement carries its id so the
    // session is re-adopted instead of duplicated.
    id?: string;
    kind: SavedQueueKind;
    name?: string;
}

// A hint is only trusted briefly — it must belong to the queue change it preceded, not a stale one.
const HINT_TTL_MS = 4000;

let pending: null | SourceHint = null;
// When a new session was announced (0 = none). Separate from the hint, because a session can be
// restarted with no idea what to call it — see restartQueueSession.
let newSessionPendingAt = 0;

// navi-connect (I-040): the station store listens here. A new listening session is the one
// thing that ends a queue's station binding (a radio arms its own just before announcing).
const sessionBeginListeners = new Set<() => void>();

/**
 * A play call site announces that it is about to start a NEW listening session, and what to call
 * it. Editing an existing queue must NOT call this.
 */
export const beginQueueSession = (kind: SavedQueueKind, name?: string, id?: string): void => {
    pending = { at: Date.now(), id, kind, name };
    newSessionPendingAt = pending.at;
    for (const listener of sessionBeginListeners) listener();
};

/** Subscribe to [beginQueueSession]; returns an unsubscribe. */
export const onQueueSessionBegin = (listener: () => void): (() => void) => {
    sessionBeginListeners.add(listener);
    return () => sessionBeginListeners.delete(listener);
};

/** @deprecated Prefer [beginQueueSession] — kept as the historical name of the same call. */
export const markNextQueueSource = beginQueueSession;

/** True when a new-session announcement is still fresh. Does not consume it. */
export const isNewQueueSessionPending = (): boolean =>
    newSessionPendingAt > 0 && Date.now() - newSessionPendingAt <= HINT_TTL_MS;

/** Consume the new-session flag — called by whichever path actually mints the record. */
export const consumeQueueSession = (): void => {
    newSessionPendingAt = 0;
    pending = null;
};

const sessionResetListeners = new Set<() => void>();

/** Subscribe to [restartQueueSession]; returns an unsubscribe. */
export const onQueueSessionReset = (listener: () => void): (() => void) => {
    sessionResetListeners.add(listener);
    return () => sessionResetListeners.delete(listener);
};

/**
 * The history UI can delete the record the live queue is publishing into (a single delete, or
 * "clear history"). That leaves what you're listening to homeless: our id points at a record the
 * hub has tombstoned, and the publish dedupe means nothing re-mints until the queue changes — so
 * the playing queue silently vanishes from Continue Listening until you start something else.
 * Deleting therefore restarts the session: a fresh id, name re-inferred from the queue itself
 * (no hint — the original announcement is long gone), republished immediately.
 */
export const restartQueueSession = (): void => {
    pending = null;
    newSessionPendingAt = Date.now();
    for (const listener of sessionResetListeners) listener();
};

// Two queues are "the same listening session" when this much of their membership matches.
// Deliberately strict: an Auto DJ top-up appends a couple of tracks, a reorder changes none.
const SAME_QUEUE_THRESHOLD = 0.8;

/**
 * The id of an existing history record that IS this queue, if there is one.
 *
 * Session identity lives in a ref, so it dies with the renderer: relaunching Worbus for desktop (or opening
 * it and casting) republished the restored queue with a brand-new UUID, minting a fresh card for
 * music that was already in the history — four launches, four identical "Queue · N tracks" rows.
 * Matching the stored history closes that gap; it also means replaying something you already have
 * refreshes that card instead of cloning it.
 */
export const findMatchingSavedQueueId = (ids: string[]): null | string => {
    if (ids.length === 0) return null;
    const wanted = new Set(ids);
    let best: null | { id: string; score: number; updatedAt: number } = null;
    for (const queue of useSavedQueuesStore.getState().queues) {
        if (queue.songs.length === 0) continue;
        const shared = queue.songs.filter((song) => wanted.has(song.id)).length;
        const score = shared / Math.max(queue.songs.length, ids.length);
        if (score < SAME_QUEUE_THRESHOLD) continue;
        if (
            !best ||
            score > best.score ||
            (score === best.score && queue.updatedAt > best.updatedAt)
        ) {
            best = { id: queue.id, score, updatedAt: queue.updatedAt };
        }
    }
    return best?.id ?? null;
};

/**
 * Resolve the kind+name for a freshly-minted queue: the pending hint if still fresh, otherwise
 * inferred from the songs.
 *
 * The name is now optional, and is only ever a REAL name — an album, a playlist, a radio seed.
 * Synthesizing "Queue · 12 tracks" and storing it as though it were the queue's origin was a
 * mistake: the count froze at birth (so a grown queue's title contradicted its own subtitle), the
 * string duplicated the subtitle word for word, and it travelled to the hub where the other client
 * inherited it. A queue with no real origin simply has no `sourceName`, and the display layer
 * decides what to call it (see saved-queue-format.ts).
 *
 * Does NOT consume the hint; the minting path calls [consumeQueueSession] once it has committed.
 */
export const resolveQueueSource = (
    songs: QueueSong[],
): { id?: string; kind: SavedQueueKind; name?: string } => {
    const hint = pending;
    if (hint && Date.now() - hint.at <= HINT_TTL_MS) {
        return {
            id: hint.id,
            kind: hint.kind,
            name: hint.name?.trim() || undefined,
        };
    }

    // Infer: one album => the album; one artist => that artist; otherwise a plain queue.
    const albumIds = new Set(songs.map((s) => s.albumId).filter(Boolean));
    if (albumIds.size === 1 && songs.length > 0 && songs[0].album) {
        return { kind: 'album', name: songs[0].album };
    }
    const artists = new Set(songs.map((s) => s.artistName).filter(Boolean));
    if (artists.size === 1 && songs.length > 0 && songs[0].artistName) {
        return { kind: 'manual', name: songs[0].artistName };
    }
    return { kind: 'manual' };
};
