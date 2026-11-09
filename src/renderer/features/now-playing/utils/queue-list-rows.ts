/**
 * B-351: the rows the play queue list draws for the local player.
 */
import { playOrder, type PlayOrderState } from '/@/renderer/store/play-order';

export type QueueListState = PlayOrderState;

/**
 * `items` is the queue in queue order (`getQueue().items`). Under shuffle the list draws them in
 * play order, as Worbus for Android does since B-341, so what is listed below the playing song
 * is what plays next; the list then takes no drags (a drag reorders the queue, not the play
 * order). The store's `getQueueOrder` keeps queue order: next/previous read it with the play
 * position.
 */
export const queueListRows = <T>(items: readonly T[], state: QueueListState): T[] =>
    playOrder(state)
        .map((row) => items[row])
        .filter((item): item is T => item !== undefined);
