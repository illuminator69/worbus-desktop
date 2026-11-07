import { useMemo } from 'react';
import { generatePath, useNavigate } from 'react-router';

import { type GapBoxLocationState } from '/@/renderer/features/lbbot/components/gap-box';
import {
    gapsByAlbumId,
    useHubSupports,
    useLbBotAvailable,
    useLbBotDiscography,
    useLbBotDownloadsShown,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AppRoute } from '/@/renderer/router/routes';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Album } from '/@/shared/types/domain-types';

interface FindMissingTracksActionProps {
    album: Album | undefined;
}

/**
 * "Find 3 missing tracks" for an album the library holds only part of.
 *
 * It lives in the context menu rather than on the tile on purpose: tapping an
 * incomplete album opens the album, because the gap is the exception and not the
 * headline. Worbus for Android shipped it the other way round first and it was wrong.
 *
 * Renders nothing at all unless lb-bot knows this exact album is incomplete —
 * same fail-soft contract as the rest of the surface, only stricter: not
 * configured, unreachable, unindexed and complete all look identical from here.
 *
 * R11 (B-223): it opens the album page with its gaps box unfolded to the missing tracks (the modal
 * it used to open is gone; the album page can be reached from anywhere an album menu opens).
 */
export const FindMissingTracksAction = ({ album }: FindMissingTracksActionProps) => {
    const navigate = useNavigate();
    const artistId = album?.albumArtists?.[0]?.id ?? '';
    const discographyQuery = useLbBotDiscography(artistId);
    // A hub older than this app proxies no gap routes, and a 404 from an unknown
    // route is an ordinary HTTP response — so without asking, this would be a
    // menu entry that silently does nothing.
    const supported = useHubSupports('POST /lb/gap/search');
    // The same gate as the album page's box, so the entry never opens a page with no box on it.
    const available = useLbBotAvailable();
    // Worbus P1: the box it opens fills nothing while downloading is off, so it is not offered.
    const downloadsShown = useLbBotDownloadsShown();

    const release = useMemo(
        () => (album ? gapsByAlbumId(discographyQuery.data).get(album.id) : undefined),
        [discographyQuery.data, album],
    );

    if (!album || !release?.groupId || !supported || !available || !downloadsShown) return null;

    // lb-bot already knows the count, so the label says it rather than making the
    // user open a modal to find out whether it is worth opening.
    const missing = Math.max((release.totalTracks ?? 0) - (release.presentTracks ?? 0), 0);

    return (
        <ContextMenu.Item
            leftIcon="download"
            onSelect={() =>
                navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: album.id }), {
                    state: { lbGapView: 'tracks' } satisfies GapBoxLocationState,
                })
            }
        >
            {missing ? `Find ${missing} missing tracks` : 'Find missing tracks'}
        </ContextMenu.Item>
    );
};
