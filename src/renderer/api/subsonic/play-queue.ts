/**
 * B-372: what `getPlayQueue` (the classic call) answers, read for the controller. Pure, so the
 * harness runs it.
 */
interface ClassicPlayQueue<S> {
    changed: string;
    changedBy: string;
    current?: string;
    entry: S[];
    position?: number;
    username: string;
}

export const readClassicPlayQueue = <S extends { id: string }, T>(
    body: { playQueue: ClassicPlayQueue<S> },
    toSong: (song: S) => T,
) => {
    const { changed, changedBy, current, entry, position, username } = body.playQueue;
    return {
        changed,
        changedBy,
        currentIndex: current ? entry.findIndex((item) => item.id === current) : 0,
        entry: entry?.map(toSong) || [],
        positionMs: position ?? 0,
        username,
    };
};
