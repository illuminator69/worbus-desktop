/**
 * W1 (B-305): what this device tells the hub about the queue it plays, beside the tracks, in an
 * `act:setQueue` (navi-connect/DESIGN-w1-play-order-2026-11-10.md §1).
 */
import { isShuffleOn, playingQueueIndex, type PlayOrderState } from '/@/renderer/store/play-order';

export type PublicationFields =
    | { index: number; order: null | number[]; shuffle: boolean }
    | { index: number };

export type PublicationState = PlayOrderState;

/**
 * The `setQueue` fields that place the playhead: `index` is the playing ROW of the tracks sent
 * (it was the play position, which under shuffle named another song). `withOrder`: the hub
 * lists `playOrder` in `welcome.features`, so it is also told what this device plays next:
 * `shuffle`, and `order` (the rows in play order, null without shuffle). An older hub is sent
 * neither.
 */
export const publicationFields = (
    state: PublicationState,
    withOrder: boolean,
): PublicationFields => {
    const index = playingQueueIndex(state);
    if (!withOrder) return { index };
    const shuffle = isShuffleOn(state);
    return { index, order: shuffle ? [...state.queue.shuffled] : null, shuffle };
};

/**
 * The publish dedupe's key: the track ids, and with a playOrder hub the order too, so a shuffle
 * toggle or a re-shuffle on this device is published like a queue edit. `order` null = no
 * shuffle. The same key is built from a frame this device adopts, so the adopt is not echoed.
 */
export const publicationSignature = (
    ids: readonly string[],
    order: null | readonly number[],
    withOrder: boolean,
): string => (withOrder ? `${ids.join(',')}|${order ? order.join('.') : '-'}` : ids.join(','));
