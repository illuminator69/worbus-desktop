/**
 * B-371: the Navidrome `savePlayQueue` request "Save queue to server" sends. Kept free of imports
 * so `node --test` can run it.
 */

/** The player store's slice the request reads. */
export interface SavePlayQueueState {
    player: { index: number; shuffle: string };
    queue: { default: readonly string[]; shuffled: readonly number[] };
}

export const savePlayQueueQuery = (
    items: readonly { id: string }[],
    state: SavePlayQueueState,
    timestampSec: number,
): { currentIndex: number | undefined; positionMs: number; songs: string[] } => ({
    currentIndex: items.length > 0 ? state.player.index : undefined,
    positionMs: timestampSec * 1000,
    songs: items.map((item) => item.id),
});
