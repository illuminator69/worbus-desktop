/**
 * The query `/lb/album/sources` is asked with. The release the caller already resolved rides along
 * when there is one: lb-bot otherwise re-resolves the group at MusicBrainz, and its resolver caches a
 * transient failure for five minutes without retrying inside that window, so one 503 made this a
 * hard "Could not resolve album" for the same album for the next five minutes. These values came
 * from /lb/album/releases, so they cost nothing.
 *
 * `refresh` is Search again after a refusal (R12, review F4): lb-bot's own `refresh=1`, so it
 * searches afresh instead of answering from what it kept, and the hub skips its one-minute cache.
 */
export const albumSourcesParams = (args: {
    album?: string;
    artist?: string;
    refresh?: boolean;
    releaseMbid?: string;
    rgid: string;
    total?: number;
}): Record<string, string> => ({
    rgid: args.rgid,
    ...(args.releaseMbid
        ? {
              album: args.album ?? '',
              artist: args.artist ?? '',
              release_mbid: args.releaseMbid,
              total: String(args.total ?? 0),
          }
        : {}),
    ...(args.refresh ? { refresh: '1' } : {}),
});
