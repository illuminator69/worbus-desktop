import { ReactNode, Suspense, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useGridCarouselContainerQuery } from '/@/renderer/components/grid-carousel/grid-carousel-v2';
import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { AlbumInfiniteCarousel } from '/@/renderer/features/albums/components/album-infinite-carousel';
import { FreshRow } from '/@/renderer/features/discover/components/fresh-row';
import { MixesRow } from '/@/renderer/features/discover/components/mixes-row';
import { RediscoveryRow } from '/@/renderer/features/discover/components/rediscovery-row';
import { SimilarArtistsRow } from '/@/renderer/features/discover/components/similar-artists-row';
import { DISCOVER_ROWS, DiscoverRowId } from '/@/renderer/features/discover/discover-rows';
import { AlbumInfiniteFeatureCarousel } from '/@/renderer/features/home/components/album-infinite-feature-carousel';
import { AlbumInfiniteSingleFeatureCarousel } from '/@/renderer/features/home/components/album-infinite-single-feature-carousel';
import { ContinueListeningRow } from '/@/renderer/features/home/components/continue-listening-row';
import { FeaturedGenres } from '/@/renderer/features/home/components/featured-genres';
import { IndexProgressBar } from '/@/renderer/features/home/components/index-progress-bar';
import { PlaylistInfiniteCarousel } from '/@/renderer/features/home/components/playlist-infinite-carousel';
import styles from '/@/renderer/features/home/routes/home-route.module.css';
import {
    useLbBotAvailable,
    useLbBotRouteSupport,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { MoodSection } from '/@/renderer/features/moods/components/mood-section';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { SongInfiniteCarousel } from '/@/renderer/features/songs/components/song-infinite-carousel';
import {
    HomeFeatureStyle,
    HomeItem,
    useCurrentServer,
    useHomeFeature,
    useHomeFeatureStyle,
    useHomeItems,
    useWindowSettings,
} from '/@/renderer/store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { AlbumListSort, ServerType, SongListSort, SortOrder } from '/@/shared/types/domain-types';
import { Platform } from '/@/shared/types/types';

/** Discover's rows that Home can show, by Home id. */
const HOME_DISCOVER_ROWS: Partial<
    Record<HomeItem, { discoverId: DiscoverRowId; titleKey: string }>
> = {
    [HomeItem.FRESH]: { discoverId: 'fresh', titleKey: 'page.home.fresh' },
    [HomeItem.MIXES]: { discoverId: 'mixes', titleKey: 'page.home.yourMixes' },
    [HomeItem.REDISCOVERY]: { discoverId: 'rediscovery', titleKey: 'page.home.rediscover' },
    [HomeItem.SIMILAR_ARTISTS]: {
        discoverId: 'similar-artists',
        titleKey: 'page.home.fansAlsoLike',
    },
};

/**
 * One of Discover's rows on Home, or nothing: an lb-bot row needs lb-bot and its route (the same
 * reading as Discover's), a library row is always answerable. Each row hides itself when it has
 * nothing to show.
 */
const HomeDiscoverRow = ({ id }: { id: HomeItem }) => {
    const { t } = useTranslation();
    const lbBotAvailable = useLbBotAvailable();
    const supportsRoute = useLbBotRouteSupport();
    const entry = HOME_DISCOVER_ROWS[id];
    const row = entry && DISCOVER_ROWS.find((r) => r.id === entry.discoverId);
    if (!entry || !row) return null;
    if (row.capability.kind === 'lbbot') {
        if (!lbBotAvailable || !supportsRoute(row.capability.route)) return null;
    } else if (row.capability.kind !== 'library') {
        return null;
    }

    const title = t(entry.titleKey);
    switch (row.id) {
        case 'fresh':
            return <FreshRow title={title} />;
        case 'mixes':
            return <MixesRow title={title} />;
        case 'rediscovery':
            return <RediscoveryRow title={title} />;
        case 'similar-artists':
            return <SimilarArtistsRow title={title} />;
        default:
            return null;
    }
};

const HomeRoute = () => {
    const { t } = useTranslation();
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const server = useCurrentServer();
    const { windowBarStyle } = useWindowSettings();
    const homeFeature = useHomeFeature();
    const homeFeatureStyle = useHomeFeatureStyle();
    const homeItems = useHomeItems();
    const containerQuery = useGridCarouselContainerQuery();

    const isJellyfin = server?.type === ServerType.JELLYFIN;

    const albumShelf = (
        id: HomeItem,
        sortBy: AlbumListSort,
        sortOrder: SortOrder,
        title: string,
    ) => (
        <AlbumInfiniteCarousel
            containerQuery={containerQuery}
            enableRefresh
            queryKey={['home', 'album', id] as const}
            rowCount={1}
            sortBy={sortBy}
            sortOrder={sortOrder}
            title={title}
        />
    );

    const songShelf = (id: HomeItem, sortBy: SongListSort, title: string) => (
        <SongInfiniteCarousel
            containerQuery={containerQuery}
            enableRefresh
            queryKey={['home', 'song', id] as const}
            rowCount={1}
            sortBy={sortBy}
            sortOrder={SortOrder.DESC}
            title={title}
        />
    );

    // One id to element map: the library carousels as before, and Discover's rows by id.
    const shelf = (id: HomeItem): ReactNode => {
        switch (id) {
            case HomeItem.GENRES:
                return <FeaturedGenres />;
            case HomeItem.MOST_PLAYED:
                return isJellyfin
                    ? songShelf(id, SongListSort.PLAY_COUNT, t('page.home.mostPlayed'))
                    : albumShelf(
                          id,
                          AlbumListSort.PLAY_COUNT,
                          SortOrder.DESC,
                          t('page.home.mostPlayed'),
                      );
            case HomeItem.PLAYLISTS:
                return (
                    <PlaylistInfiniteCarousel
                        containerQuery={containerQuery}
                        enableRefresh
                        title={t('page.home.playlists')}
                    />
                );
            case HomeItem.RANDOM:
                return albumShelf(id, AlbumListSort.RANDOM, SortOrder.ASC, t('page.home.explore'));
            case HomeItem.RECENTLY_ADDED:
                return albumShelf(
                    id,
                    AlbumListSort.RECENTLY_ADDED,
                    SortOrder.DESC,
                    t('page.home.newlyAdded'),
                );
            case HomeItem.RECENTLY_PLAYED:
                return isJellyfin
                    ? songShelf(id, SongListSort.RECENTLY_PLAYED, t('page.home.recentlyPlayed'))
                    : albumShelf(
                          id,
                          AlbumListSort.RECENTLY_PLAYED,
                          SortOrder.DESC,
                          t('page.home.recentlyPlayed'),
                      );
            case HomeItem.RECENTLY_RELEASED:
                return albumShelf(
                    id,
                    AlbumListSort.RELEASE_DATE,
                    SortOrder.DESC,
                    t('page.home.recentlyReleased'),
                );
            default:
                return <HomeDiscoverRow id={id} />;
        }
    };

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: 'var(--theme-colors-background)',
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>{t('page.home.title')}</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                }}
                ref={scrollAreaRef}
            >
                <LibraryContainer>
                    <Stack
                        gap="2xl"
                        mb="5rem"
                        pt={windowBarStyle === Platform.WEB ? '5rem' : '3rem'}
                        px="2rem"
                        ref={containerQuery.ref}
                    >
                        {/* Worbus P1: the index bar folds open under the title, in the same Stack
                            child, so the shelves' gap below is unchanged while it is folded. */}
                        <div>
                            <TextTitle className={styles.title} data-home-title order={1}>
                                {t('page.home.title')}
                            </TextTitle>
                            <IndexProgressBar />
                        </div>
                        <MoodSection>
                            <Stack gap="2xl">
                                {homeFeature && (
                                    <div data-home-shelf="feature">
                                        {homeFeatureStyle === HomeFeatureStyle.MULTIPLE ? (
                                            <AlbumInfiniteFeatureCarousel />
                                        ) : (
                                            <AlbumInfiniteSingleFeatureCarousel />
                                        )}
                                    </div>
                                )}
                                <div data-home-shelf="continue">
                                    <ContinueListeningRow />
                                </div>
                                {homeItems
                                    .filter((item) => !item.disabled)
                                    .map((item) => (
                                        <div data-home-shelf={item.id} key={item.id}>
                                            {shelf(item.id as HomeItem)}
                                        </div>
                                    ))}
                            </Stack>
                        </MoodSection>
                    </Stack>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const HomeRouteWithBoundary = () => {
    return (
        <PageErrorBoundary>
            <Suspense fallback={<Spinner container />}>
                <HomeRoute />
            </Suspense>
        </PageErrorBoundary>
    );
};

export default HomeRouteWithBoundary;
