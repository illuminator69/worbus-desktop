/**
 * Review M2 (cover memory cache): the image ids an album's cover is shown under. The album's own
 * (its id and its `imageId`) and each of its songs' (`imageId`; on Navidrome the song id), found in
 * what the app already holds (the query cache's data, the play queue), since a song's cover key
 * names the song, not its album. Pure, bounded (`MAX_NODES`), cycle-safe; run on a cover change,
 * which is rare.
 */
const MAX_DEPTH = 8;
const MAX_NODES = 500_000;

export const coverIdsOfAlbums = (albumIds: string[], sources: unknown[]): Set<string> => {
    const albums = new Set(albumIds.filter(Boolean));
    const found = new Set(albums);
    if (albums.size === 0) return found;
    const seen = new WeakSet<object>();
    let nodes = 0;
    const walk = (value: unknown, depth: number) => {
        if (!value || typeof value !== 'object' || depth > MAX_DEPTH || nodes > MAX_NODES) return;
        if (seen.has(value)) return;
        seen.add(value);
        nodes += 1;
        if (Array.isArray(value)) {
            for (const item of value) walk(item, depth + 1);
            return;
        }
        const item = value as Record<string, unknown>;
        if (typeof item.imageId === 'string' && item.imageId) {
            const ofAlbum = typeof item.albumId === 'string' && albums.has(item.albumId);
            const isAlbum = typeof item.id === 'string' && albums.has(item.id);
            if (ofAlbum || isAlbum) found.add(item.imageId);
        }
        for (const child of Object.values(item)) walk(child, depth + 1);
    };
    for (const source of sources) walk(source, 0);
    return found;
};
