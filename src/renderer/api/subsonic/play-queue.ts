/**
 * B-372: a saved play queue as either call answers it - `getPlayQueue` (the current song by id)
 * or `getPlayQueueByIndex` (by row) - read by one rule. A server with no saved queue leaves the
 * object out (Navidrome does so for both calls), and that reads as an empty queue. Pure, so the
 * harness runs it.
 */
export interface SavedPlayQueueBody<S> {
    changed?: string;
    changedBy?: string;
    current?: string;
    currentIndex?: number;
    entry?: S[];
    position?: number;
    username?: string;
}

export const readSavedPlayQueue = <S extends { id: number | string }, T>(
    raw: SavedPlayQueueBody<S> | undefined,
    toSong: (song: S) => T,
) => {
    const entry = raw?.entry ?? [];
    const byId = raw?.current ? entry.findIndex((item) => item.id === raw.current) : -1;
    return {
        changed: raw?.changed ?? '',
        changedBy: raw?.changedBy ?? '',
        currentIndex: raw?.currentIndex ?? Math.max(byId, 0),
        entry: entry.map(toSong),
        positionMs: raw?.position ?? 0,
        username: raw?.username ?? '',
    };
};

/** The classic call's answer. */
export const readClassicPlayQueue = <S extends { id: number | string }, T>(
    body: { playQueue?: SavedPlayQueueBody<S> },
    toSong: (song: S) => T,
) => readSavedPlayQueue(body?.playQueue, toSong);
