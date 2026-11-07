import clsx from 'clsx';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate } from 'react-router';

import { DiscoverRow } from './discover-row';
import styles from './discover-row.module.css';
import { DiscoverTile } from './discover-tile';

import { AcquireButton } from '/@/renderer/features/lbbot/components/acquire-button';
import {
    useLbBotAvailable,
    useLbBotFreshReleases,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    useFreshDays,
    useFreshScope,
    useFreshSort,
    useFreshType,
} from '/@/renderer/features/lbbot/stores/fresh-filters.store';
import { externalAlbumPath } from '/@/renderer/features/lbbot/utils/external-paths';
import {
    freshScopeInEffect,
    freshShelf,
    freshShelfReason,
    freshTileTarget,
} from '/@/renderer/features/lbbot/utils/fresh-order';
import { useLibraryContextMenu } from '/@/renderer/features/shared/hooks/use-library-context-menu';
import { AppRoute } from '/@/renderer/router/routes';
import { LibraryItem } from '/@/shared/types/domain-types';

/** The Fresh feed as a row, which is what `DESIGN-lbbot-client-integration.md`
 *  specified in the first place - the whole tab came first and the row never
 *  followed. The tab stays: this is the glance, `/fresh` is the full feed with
 *  its filters.
 *
 *  B-286: the glance is the page's first rows. It reads the page's persisted
 *  filters (window, scope, type, sort) and the page's order (`fresh-order.ts`),
 *  from the same query key as the page, so visiting one after the other fetches
 *  nothing new, and the reason line follows the scope: the site-wide scope is a
 *  chart and never says "already in your library" (lb-bot's rule that the two
 *  scopes are never conflated). A filter leaving nothing renders nothing. */
export const FreshRow = ({ title }: { title: string }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const openMenu = useLibraryContextMenu();
    const days = useFreshDays();
    const storedScope = useFreshScope();
    const sort = useFreshSort();
    const type = useFreshType();

    const available = useLbBotAvailable();
    const query = useLbBotFreshReleases(days);
    // As on the page: a placeholder is the previous window's answer, held dimmed while this
    // window's loads, and dropped when lb-bot cannot answer at all.
    const switching = query.isPlaceholderData;
    const data = switching && !available ? undefined : query.data;
    const loading = available && (query.isLoading || switching);
    const scope = freshScopeInEffect(data?.releases, storedScope);

    const releases = useMemo(
        () =>
            freshShelf(
                data?.releases,
                { scope, sort, type },
                // The page's clock rule: read when the rows or the filters change.
                // eslint-disable-next-line react-hooks/purity
                Date.now(),
            ),
        [data, scope, sort, type],
    );

    const cards = useMemo(
        () =>
            releases.map((release) => {
                // The page's rule: a row with no album and no release group opens nothing and
                // offers nothing to fetch (the "All" scope brings such rows onto the shelf).
                const target = freshTileTarget(release);
                return {
                    content: (
                        <DiscoverTile
                            // One tap to fetch it, but never blind: the control
                            // reviews lb-bot's ranked sources first and opens the
                            // picker whenever there is anything left to decide.
                            action={
                                target?.kind === 'external' && !release.releaseOwned ? (
                                    <AcquireButton
                                        artist={release.artist}
                                        className={styles.action}
                                        onReview={() => navigate(externalAlbumPath(release))}
                                        rgid={target.rgid}
                                        title={release.releaseName}
                                    />
                                ) : undefined
                            }
                            badge={
                                <span
                                    className={clsx(
                                        styles.ownedBadge,
                                        release.releaseOwned ? styles.owned : styles.notOwned,
                                    )}
                                    data-owned-badge={release.releaseOwned ? 'owned' : 'not-owned'}
                                >
                                    {release.releaseOwned
                                        ? t('common.owned')
                                        : t('common.notOwned')}
                                </span>
                            }
                            badgePlacement="top-start"
                            imageUrl={release.coverUrl}
                            isStale={switching}
                            isUnowned={!release.releaseOwned}
                            itemType={LibraryItem.ALBUM}
                            // An owned release opens the library album directly.
                            // `releaseAlbumId` exists precisely so a tile badged "in
                            // library" does not have to route through the virtual
                            // page and wait for its redirect, which cannot fire at
                            // all for an album lb-bot filled itself.
                            onClick={
                                target
                                    ? () =>
                                          navigate(
                                              target.kind === 'library'
                                                  ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                                                        albumId: target.albumId,
                                                    })
                                                  : externalAlbumPath(release),
                                          )
                                    : undefined
                            }
                            onContextMenu={(event) =>
                                void openMenu(
                                    event,
                                    release.releaseAlbumId
                                        ? { id: release.releaseAlbumId, kind: 'album' }
                                        : null,
                                )
                            }
                            subtitle={release.artist}
                            title={release.releaseName}
                        />
                    ),
                    id: `${release.releaseGroupMbid || release.releaseMbid}-${release.artist}`,
                };
            }),
        [navigate, openMenu, releases, switching, t],
    );

    return (
        <DiscoverRow
            because={freshShelfReason(scope, days, type)}
            cards={cards}
            isEmpty={cards.length === 0}
            isLoading={loading}
            seeAll={{ label: 'See all', to: AppRoute.FRESH }}
            title={title}
        />
    );
};
