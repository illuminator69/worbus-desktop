/**
 * B-351: the rows the play queue list draws for the local player. Kept free of imports so
 * `node --test` can run it.
 */

/** The player store's slice the list reads. */
export interface QueueListState {
    player: { index: number; shuffle: string };
    queue: { default: readonly string[]; shuffled: readonly number[] };
}

/** `items` is the queue in queue order (`getQueue().items`). */
export const queueListRows = <T>(items: readonly T[], _state: QueueListState): T[] => [...items];
