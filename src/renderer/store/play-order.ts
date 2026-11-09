/**
 * W1: the play order, and the one rule for what each edit does to it.
 * navi-connect/DESIGN-w1-play-order-2026-11-10.md §2 and §5 (desktop).
 *
 * With track shuffle on, `queue.shuffled` lists the rows of `queue.default` in the order they
 * play, and `player.index` is a POSITION in it: `queue.shuffled[player.index]` is the playing
 * row. Without shuffle the play order is the queue order and the two are the same number.
 * Read raw, the position was taken for a row (B-305, B-367, B-371), so `player.index` is private
 * to `src/renderer/store/` and everything else reads it through the three selectors here
 * (play-order-guard.harness.ts and ESLint's `no-restricted-syntax` keep it that way).
 *
 * The same rule is applied by the hub (to its mirror, for a controller's edits) and by Worbus
 * for Android (its ShuffleOrder), so a published order means the same everywhere:
 * - shuffle on, or a re-shuffle: the playing row first, every other row after it at random;
 * - a new queue under shuffle: its start row first, the rest at random;
 * - Play next: right after the playing row, in the order given;
 * - Add to queue (and a station or Auto DJ top-up): at the end, in the order given;
 * - any other insert: right after its queue predecessor's play position;
 * - remove: dropped, the rest keep their order; removing the playing row plays the row after it;
 * - move: queue order only, every row keeps its play position.
 *
 * Kept free of imports so `node --test` can run it. `'track'` is `PlayerShuffle.TRACK`.
 */

/** The player store's slice the play order lives in. */
export interface PlayOrderState {
    player: { index: number; shuffle: string };
    queue: { default: readonly string[]; shuffled: readonly number[] };
}

const TRACK = 'track';

/** Track shuffle is on and has an order. */
export const isShuffleOn = (state: PlayOrderState): boolean =>
    state.player.shuffle === TRACK && state.queue.shuffled.length > 0;

/** The playing row of `queue.default`, or -1 when nothing plays. */
export const playingQueueIndex = (state: PlayOrderState): number => {
    const position = state.player.index;
    const rows = state.queue.default.length;
    if (position < 0 || position >= rows) return -1;
    if (!isShuffleOn(state)) return position;
    const row = state.queue.shuffled[position];
    return row === undefined ? -1 : row;
};

/**
 * The rows of `queue.default` in the order they play: `queue.shuffled` under shuffle, else
 * 0..n-1. A new array each call: read it from a snapshot, not as a hook's selector.
 */
export const playOrder = (state: PlayOrderState): number[] =>
    isShuffleOn(state) ? [...state.queue.shuffled] : state.queue.default.map((_, row) => row);

/** The playing row's position in `playOrder`, for code that walks the play order. */
export const playPosition = (state: PlayOrderState): number => state.player.index;

/** `order` lists each of `rows` rows exactly once. */
export const isPermutation = (order: unknown, rows: number): order is number[] => {
    if (!Array.isArray(order) || order.length !== rows) return false;
    const seen = new Set<number>();
    for (const row of order) {
        if (!Number.isInteger(row) || row < 0 || row >= rows || seen.has(row)) return false;
        seen.add(row);
    }
    return true;
};

/** A fresh order of `rows` rows: `first` first (when it is a row), the rest by `shuffle`. */
export const orderWithFirst = (
    rows: number,
    first: number,
    shuffle: (rows: number[]) => number[],
): number[] => {
    const all = Array.from({ length: rows }, (_, row) => row);
    if (first < 0 || first >= rows) return shuffle(all);
    return [first, ...shuffle(all.filter((row) => row !== first))];
};

/**
 * The play order after a queue edit, by row identity (`_uniqueId`): rows that survive keep their
 * relative order (remove, move); a run of new rows goes at the end when no surviving row comes
 * after it in the queue (Add to queue, a top-up), else right after its queue predecessor's play
 * position (Play next lands at current + 1, so its predecessor is the playing row), in the order
 * given. A run at the very top of the queue goes first.
 *
 * `playNextAfter` (Play next): every new row goes right after that row's play position, in queue
 * order. Said, not inferred: with the playing row last in the queue, Play next appends to it
 * exactly as Add to queue does.
 */
export const orderAfterEdit = (
    beforeIds: readonly string[],
    beforeOrder: readonly number[],
    afterIds: readonly string[],
    playNextAfter?: string,
): number[] => {
    const rowAfter = new Map<string, number>();
    afterIds.forEach((id, row) => rowAfter.set(id, row));
    const order = beforeOrder
        .map((row) => rowAfter.get(beforeIds[row]))
        .filter((row): row is number => row !== undefined);
    const kept = new Set(order);
    const anchor = playNextAfter === undefined ? undefined : rowAfter.get(playNextAfter);
    if (anchor !== undefined && kept.has(anchor)) {
        const added = afterIds.map((_, row) => row).filter((row) => !kept.has(row));
        order.splice(order.indexOf(anchor) + 1, 0, ...added);
        return order;
    }
    // The last surviving row in queue order: new rows after it are appended.
    let lastKept = -1;
    for (const row of kept) lastKept = Math.max(lastKept, row);
    for (let row = 0; row < afterIds.length; row += 1) {
        if (kept.has(row)) continue;
        if (row > lastKept) {
            order.push(row);
        } else if (row === 0) {
            order.unshift(row);
        } else {
            order.splice(order.indexOf(row - 1) + 1, 0, row);
        }
        kept.add(row);
    }
    return order;
};

/**
 * The playing position after a queue edit: the playing row's new position when it survived,
 * else the row that came after it in play order (the last one when nothing did); -1 for an
 * empty queue.
 */
export const positionAfterEdit = (
    beforeIds: readonly string[],
    beforeOrder: readonly number[],
    beforePosition: number,
    afterIds: readonly string[],
    afterOrder: readonly number[],
): number => {
    if (afterOrder.length === 0) return -1;
    const positionOf = new Map<string, number>();
    afterOrder.forEach((row, position) => positionOf.set(afterIds[row], position));
    for (let position = Math.max(0, beforePosition); position < beforeOrder.length; position += 1) {
        const found = positionOf.get(beforeIds[beforeOrder[position]]);
        if (found !== undefined) return found;
    }
    return afterOrder.length - 1;
};
