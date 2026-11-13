import { queryClient } from '/@/renderer/lib/react-query';
import { usePlayerStoreBase } from '/@/renderer/store/player.store';
import { coverIdsOfAlbums } from '/@/shared/components/image/cover-ids';
import { imageMemoryCache } from '/@/shared/components/image/image-memory-cache';

/**
 * Review M2 (cover memory cache): an album's cover changed (lb-bot's "cover only" save, an
 * override or undo that ended, a `library` frame naming the album once Navidrome has rescanned it).
 * Every size of the album's cover and of its songs' covers is dropped from memory and the elements
 * showing one ask again; Navidrome answers covers `public, no-cache` with an ETag carrying the
 * album's update time, so that ask brings the new image. The songs are the ones the app holds (the
 * query cache's data and the play queue): a song's cover key names the song, not its album.
 */
export const forgetAlbumCovers = (albumIds: (null | string | undefined)[]): void => {
    const ids = albumIds.filter((id): id is string => !!id);
    if (ids.length === 0) return;
    const sources: unknown[] = queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data);
    sources.push(usePlayerStoreBase.getState().queue.songs);
    imageMemoryCache.forgetItems(coverIdsOfAlbums(ids, sources));
};
