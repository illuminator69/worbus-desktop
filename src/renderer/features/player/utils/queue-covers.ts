import { PREVIEW_ID_PREFIX } from '../../../../shared/types/preview-types.ts';

/**
 * B-437: the persisted play queue's cover ids, refreshed on start. Each queued song keeps the cover
 * id it was read with; on Navidrome that id is versioned (`<id>&_=<imageHash>`, B-428) and answered
 * `immutable`, so a cover replaced outside the app stayed old in the queue, restart or not. On start
 * the app asks Navidrome for the queue's songs again and moves each changed cover id; nothing else in
 * the queue changes. `queue-covers.harness.ts` runs these without React.
 */

interface QueuedSong {
    _serverId: string;
    _serverType: string;
    id: string;
    imageId: null | string;
}

/** The ids to ask `serverId` about, each once, in batches of `size`: its Navidrome songs only (no
 *  other server's, no preview). The batches bound the request URL (`id=` repeated). */
export const queueCoverAsks = (
    songs: readonly QueuedSong[],
    serverId: string,
    size: number,
): string[][] => {
    const ids = [
        ...new Set(
            songs
                .filter(
                    (song) =>
                        song._serverId === serverId &&
                        song._serverType === 'navidrome' &&
                        !!song.id &&
                        !song.id.startsWith(PREVIEW_ID_PREFIX),
                )
                .map((song) => song.id),
        ),
    ];
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
    return batches;
};

/** Song id -> its current cover id, for the songs whose cover id changed. A song missing from the
 *  answer, or answered with no cover id, keeps the one it has. */
export const coverIdChanges = (
    queued: readonly Pick<QueuedSong, 'id' | 'imageId'>[],
    fresh: readonly { id: string; imageId: null | string }[],
): Map<string, string> => {
    const now = new Map<string, string>();
    for (const song of fresh) if (song.imageId) now.set(song.id, song.imageId);
    const changes = new Map<string, string>();
    for (const song of queued) {
        const current = now.get(song.id);
        if (current && current !== song.imageId) changes.set(song.id, current);
    }
    return changes;
};
