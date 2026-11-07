import { useSuspenseQueries } from '@tanstack/react-query';
import { Suspense, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useParams } from 'react-router';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { useNativeScrollPersist } from '/@/renderer/components/native-scroll-area/use-native-scroll-persist';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import artistStyles from '/@/renderer/features/artists/components/album-artist-detail-content.module.css';
import { LbBotDiscographyPrefetch } from '/@/renderer/features/artists/components/lbbot-discography-prefetch';
import { Discography } from '/@/renderer/features/discography/components/discography';
import { LbBotIndexButton } from '/@/renderer/features/lbbot/components/lbbot-index-button';
import {
    useEffectiveArtistMbid,
    useIndexMirrorReady,
    useLbBotDiscography,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryBackgroundOverlay } from '/@/renderer/features/shared/components/library-background-overlay';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeader } from '/@/renderer/features/shared/components/library-header';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServer, useCurrentServerId } from '/@/renderer/store';
import { useCoverHeaderWash } from '/@/renderer/themes/cover/use-cover-header-wash';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Album, AlbumListSort, LibraryItem, SortOrder } from '/@/shared/types/domain-types';

const NO_ALBUMS: Album[] = [];

/** The page's frame: both artist routes reach it, as `artistId` or as `albumArtistId`. */
const useArtistRouteIds = () => {
    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };
    return { albumArtistId, artistId, routeId: (artistId || albumArtistId) as string };
};

/**
 * R2: an artist's full discography (F7's `<Discography>`, unchanged) on its own page, under a compact
 * hero, so the artist page itself can stay short. R13 (B-247, B-248): the body keeps the artist
 * page's margins (its content container), and the hero has no Play or Shuffle, so the name has the
 * row; the artist page plays the artist.
 */
const ArtistDiscographyRouteContent = () => {
    const { t } = useTranslation();
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const server = useCurrentServer();
    const serverId = useCurrentServerId();
    const { artistId, routeId } = useArtistRouteIds();

    useNativeScrollPersist({ enabled: true, scrollRef: scrollAreaRef });

    // The artist page's two queries, so going between the two pages reads one cache entry each.
    const [detailQuery, albumsQuery] = useSuspenseQueries({
        queries: [
            artistsQueries.albumArtistDetail({ query: { id: routeId }, serverId: server?.id }),
            albumQueries.list({
                query: {
                    artistIds: [routeId],
                    limit: -1,
                    sortBy: AlbumListSort.RELEASE_DATE,
                    sortOrder: SortOrder.DESC,
                    startIndex: 0,
                },
                serverId,
            }),
        ],
    });
    // As on the artist page: the mirror read from disk before the first paint, so owned and missing
    // tiles land in one pass.
    useIndexMirrorReady();

    const artistName = detailQuery.data?.name || '';
    const owned = albumsQuery.data?.items ?? NO_ALBUMS;
    // I-019: Navidrome's tag unless the user chose a MusicBrainz artist; the menu needs both.
    const tagMbid = detailQuery.data?.mbz;
    const artistMbid = useEffectiveArtistMbid(routeId, tagMbid);
    // Read here for the menu; the discography reads the same entries itself.
    const discographyQuery = useLbBotDiscography(routeId, artistMbid);

    const artistLink = artistId
        ? generatePath(AppRoute.LIBRARY_ARTISTS_DETAIL, { artistId })
        : generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: routeId });

    const imageUrl = useItemImageUrl({
        id: detailQuery.data?.imageId || undefined,
        imageUrl: detailQuery.data?.imageUrl,
        itemType: LibraryItem.ALBUM_ARTIST,
        type: 'header',
    });

    const { background } = useCoverHeaderWash({
        id: detailQuery.data?.imageId || undefined,
        serverId: detailQuery.data?._serverId,
        src: imageUrl || detailQuery.data?.imageUrl,
    });

    return (
        <AnimatedPage key={`artist-discography-${routeId}`}>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: background || undefined,
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>{artistName}</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                    target: headerRef,
                }}
                ref={scrollAreaRef}
            >
                <LibraryBackgroundOverlay background={background} headerRef={headerRef} />
                <LibraryContainer>
                    <LibraryHeader
                        hero={{ image: 96, round: true, title: 34 }}
                        imageUrl={imageUrl}
                        item={{
                            blurHash: detailQuery.data?.blurHash,
                            children: t('page.albumArtistDetail.discographyKicker'),
                            imageId: detailQuery.data?.imageId,
                            imageUrl: detailQuery.data?.imageUrl,
                            route: artistLink,
                            thumbHash: detailQuery.data?.thumbHash,
                            type: LibraryItem.ALBUM_ARTIST,
                        }}
                        ref={headerRef}
                        title={artistName}
                        titleTo={artistLink}
                    />
                    <div className={artistStyles.contentContainer}>
                        <div className={artistStyles.detailContainer}>
                            <Discography
                                artistMbid={artistMbid}
                                artistName={artistName}
                                menu={
                                    <LbBotIndexButton
                                        artistMbid={artistMbid}
                                        artistName={artistName}
                                        discography={discographyQuery.data}
                                        ndId={routeId}
                                        tagMbid={tagMbid}
                                    />
                                }
                                ndId={routeId}
                                owned={owned}
                            />
                        </div>
                    </div>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const ArtistDiscographyRoute = () => {
    const { routeId } = useArtistRouteIds();

    return (
        <>
            <LbBotDiscographyPrefetch routeId={routeId} />
            <Suspense
                fallback={<Spinner container />}
                key={`artist-discography-suspense-${routeId}`}
            >
                <ArtistDiscographyRouteContent />
            </Suspense>
        </>
    );
};

const ArtistDiscographyRouteWithBoundary = () => {
    return (
        <PageErrorBoundary>
            <ArtistDiscographyRoute />
        </PageErrorBoundary>
    );
};

export default ArtistDiscographyRouteWithBoundary;
