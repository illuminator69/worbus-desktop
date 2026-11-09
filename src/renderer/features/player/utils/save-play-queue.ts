/**
 * B-371: the Navidrome `savePlayQueue` request "Save queue to server" sends.
 */
import { playingQueueIndex, type PlayOrderState } from '/@/renderer/store/play-order';

export type SavePlayQueueState = PlayOrderState;

/**
 * `items` is the queue in queue order, and `currentIndex` the playing row of it: under shuffle
 * the play position was sent, so another client resumed a different song.
 */
export const savePlayQueueQuery = (
    items: readonly { id: string }[],
    state: SavePlayQueueState,
    timestampSec: number,
): { currentIndex: number | undefined; positionMs: number; songs: string[] } => {
    const row = playingQueueIndex(state);
    return {
        currentIndex: items.length > 0 ? Math.max(0, row) : undefined,
        positionMs: timestampSec * 1000,
        songs: items.map((item) => item.id),
    };
};
