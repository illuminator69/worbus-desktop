import { api } from '/@/renderer/api';
import { isPreviewId } from '/@/renderer/features/preview/preview-track';
import { LibraryItem, Song } from '/@/shared/types/domain-types';

// navi-connect: shared id → Song resolution for anything that arrives as bare hub track
// metadata (a `do:load`/`do:queueChanged` directive, or a saved-queue record minted by the
// other client). Extracted so the hub hook and the saved-queue restore path can't drift.

/** The minimal track shape the hub wire format carries. */
export interface HubTrackLike {
    album?: null | string;
    artist?: null | string;
    durationMs?: null | number;
    favorite?: boolean;
    id: string;
    imageUrl?: null | string;
    /** navi-connect: set on an `ext:` preview track. Whitelisted by the hub's
     *  `SQ_TRACK_FIELDS`, so it survives a saved-queue round trip. */
    mime?: null | string;
    rating?: null | number;
    /** navi-connect: the preview's own signed URL — see `streamUrl` below. */
    streamUrl?: null | string;
    title?: null | string;
}

/**
 * Synthesize a playable Song from hub track metadata. Used for any id the server
 * couldn't resolve — the id is a valid Navidrome id on this single-server setup, so
 * playback (and cover art, which is keyed by the same id) still works.
 */
export const placeholderSong = (track: HubTrackLike, serverId: string): Song =>
    ({
        // Non-negotiable: plenty of code reads `_itemType` without guarding it (use-scrobble does
        // `song._itemType.includes('song')`), so a stub without it crashes the moment it becomes the
        // playing song — which is every restore of a hub-derived queue.
        _itemType: LibraryItem.SONG,
        _serverId: serverId,
        album: track.album ?? '',
        albumArtists: [],
        albumId: undefined,
        artistName: track.artist ?? '',
        artists: track.artist ? [{ id: '', name: track.artist }] : [],
        duration: track.durationMs ?? 0,
        id: track.id,
        // The song id doubles as the cover-art id across this system; build the cover
        // with our own server creds (imageUrl left unset).
        imageId: isPreviewId(track.id) ? null : track.id,
        imageUrl: track.imageUrl ?? undefined,
        name: track.title ?? '',
        userFavorite: track.favorite ?? false,
        userRating: track.rating ?? null,
        // navi-connect: an `ext:` track carries its own stream URL and MIME, and
        // that is the ONLY thing that makes it playable on the receiving side —
        // there is no Navidrome id behind it to resolve. Dropping them here is
        // what a transfer of a preview queue would otherwise look like: a
        // perfectly normal playing bar over silence.
        ...(isPreviewId(track.id)
            ? { _previewMime: track.mime ?? undefined, _previewStreamUrl: track.streamUrl ?? '' }
            : {}),
    }) as unknown as Song;

/**
 * Resolve hub tracks to full Songs, STRICTLY 1:1 with the input. Filtering out songs
 * missing from this server's library (or a transient getSongDetail failure) would
 * shorten the queue and shift every index after it — the hub's `index` would then point
 * at the wrong track, which reads as the queue "resetting" after a transfer. Mirrors
 * Worbus for Android's resolveQueue.
 */
export const resolveHubTracks = async (
    tracks: HubTrackLike[],
    serverId: null | string,
    // Songs this client already holds, by id. A queue edit resends the WHOLE queue, so
    // without this an Auto DJ top-up of five tracks fired one getSongDetail per track in
    // the queue — hundreds of requests, on the client that is playing, for five new ids.
    known?: Map<string, Song>,
): Promise<Song[]> => {
    if (!serverId || !tracks?.length) return [];
    const results = await Promise.all(
        tracks.map((track) => {
            const already = known?.get(track.id);
            if (already) return Promise.resolve(already);
            // A preview has no library row to fetch, and asking is not merely
            // wasted: `getSongDetail` on an `ext:` id is a 404 per track per
            // queue edit, on the device that is playing.
            if (isPreviewId(track.id)) return Promise.resolve(null);
            return api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id: track.id } })
                .catch(() => null);
        }),
    );
    return results.map((song, i) => song ?? placeholderSong(tracks[i], serverId));
};
