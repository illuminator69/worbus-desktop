import { useQuery } from '@tanstack/react-query';

import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import {
    useEffectiveArtistMbid,
    useLbBotDiscography,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useCurrentServer } from '/@/renderer/store';

/**
 * navi-connect: start lb-bot's discography read for this artist OUTSIDE the
 * page's Suspense boundary (the artist page and the discography page mount it
 * beside theirs).
 *
 * Inside it, the read could not begin until both Navidrome queries had answered
 * (the album list is `limit: -1`, so for a large artist that is the slow one),
 * because a component that suspends never commits, and react-query starts a
 * plain query's fetch on commit. For an artist in the local index mirror none
 * of this matters (the read is synchronous and never touches the network); this
 * is the fallback, for an artist the mirror does not hold.
 *
 * It waits for the artist's MBID before asking, because lb-bot looks an artist
 * up by MBID first and the query key does not carry it: a read without it can
 * answer `{indexed: false}` for an artist indexed under its MBID alone, and the
 * page would then serve that answer from the cache. The artist detail it reads
 * the MBID from is the same query the page suspends on, so it costs no request.
 * Renders nothing.
 */
export const LbBotDiscographyPrefetch = ({ routeId }: { routeId: string }) => {
    const server = useCurrentServer();
    const tagMbid = useQuery({
        ...artistsQueries.albumArtistDetail({ query: { id: routeId }, serverId: server?.id }),
        select: (detail) => detail?.mbz ?? null,
        // The page's own boundary reports a failure; this is only a trigger.
        throwOnError: false,
    }).data;
    // I-019: the same MBID the page itself will ask with, so the fallback read
    // lands on the entry the page uses.
    const mbid = useEffectiveArtistMbid(routeId, tagMbid);
    useLbBotDiscography(tagMbid === undefined ? '' : routeId, mbid);
    return null;
};
