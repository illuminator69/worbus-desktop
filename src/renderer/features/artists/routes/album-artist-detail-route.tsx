import { useSuspenseQueries } from '@tanstack/react-query';
import { Suspense, useRef } from 'react';
import { useParams } from 'react-router';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { useNativeScrollPersist } from '/@/renderer/components/native-scroll-area/use-native-scroll-persist';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { AlbumArtistDetailContent } from '/@/renderer/features/artists/components/album-artist-detail-content';
import { AlbumArtistDetailHeader } from '/@/renderer/features/artists/components/album-artist-detail-header';
import { LbBotDiscographyPrefetch } from '/@/renderer/features/artists/components/lbbot-discography-prefetch';
import { useIndexMirrorReady } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import {
    LibraryBackgroundImage,
    LibraryBackgroundOverlay,
} from '/@/renderer/features/shared/components/library-background-overlay';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useArtistBackground, useCurrentServer, useCurrentServerId } from '/@/renderer/store';
import { useCoverHeaderWash } from '/@/renderer/themes/cover/use-cover-header-wash';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { AlbumListSort, LibraryItem, SortOrder } from '/@/shared/types/domain-types';

const AlbumArtistDetailRouteContent = () => {
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const server = useCurrentServer();
    const serverId = useCurrentServerId();
    const { artistBackground, artistBackgroundBlur } = useArtistBackground();

    useNativeScrollPersist({ enabled: true, scrollRef: scrollAreaRef });

    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };

    const routeId = (artistId || albumArtistId) as string;

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
    // navi-connect: and for lb-bot's index mirror to have been read from disk,
    // which it almost always already has. Waiting for it here, beside the
    // Navidrome queries this page suspends on anyway, is what lets the album
    // grid below paint its owned and missing tiles in one pass: a lookup
    // against a mirror not yet loaded would miss, and the missing tiles would
    // then splice in a moment later and shift everything under them.
    useIndexMirrorReady();

    const imageUrl = useItemImageUrl({
        id: detailQuery.data?.imageId || undefined,
        imageUrl: detailQuery.data?.imageUrl,
        itemType: LibraryItem.ALBUM_ARTIST,
        type: 'header',
    });

    const libraryBackgroundImageUrl = useItemImageUrl({
        id: detailQuery.data?.imageId || undefined,
        imageUrl: detailQuery.data?.imageUrl,
        itemType: LibraryItem.ALBUM_ARTIST,
        type: 'itemCard',
    });

    const selectedImageUrl = imageUrl || detailQuery.data?.imageUrl;

    const { background } = useCoverHeaderWash({
        id: detailQuery.data?.imageId || undefined,
        serverId: detailQuery.data?._serverId,
        src: selectedImageUrl,
    });

    const showBlurredImage = artistBackground;

    // if (isColorLoading) {
    //     return <Spinner container />;
    // }

    // The hero's band, drawn behind the hero and again in the bar (B-216), laid out against the hero.
    const band = showBlurredImage ? (
        <LibraryBackgroundImage
            blur={artistBackgroundBlur}
            headerRef={headerRef}
            imageUrl={libraryBackgroundImageUrl || ''}
        />
    ) : (
        <LibraryBackgroundOverlay background={background} headerRef={headerRef} />
    );

    return (
        <AnimatedPage key={`album-artist-detail-${routeId}`}>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: background || undefined,
                    band,
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.PlayButton
                                ids={[routeId]}
                                itemType={LibraryItem.ALBUM_ARTIST}
                                variant="default"
                            />
                            <LibraryHeaderBar.Title>
                                {detailQuery.data?.name}
                            </LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    // The bar follows the hero's title, not a pixel offset (B-220).
                    fadeWithTitle: true,
                    target: headerRef,
                }}
                ref={scrollAreaRef}
            >
                {band}
                <LibraryContainer>
                    <AlbumArtistDetailHeader
                        albumsQuery={albumsQuery}
                        ref={headerRef as React.Ref<HTMLDivElement>}
                    />
                    <AlbumArtistDetailContent albumsQuery={albumsQuery} detailQuery={detailQuery} />
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const AlbumArtistDetailRoute = () => {
    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };
    const routeId = (artistId || albumArtistId) as string;

    return (
        <>
            <LbBotDiscographyPrefetch routeId={routeId} />
            <Suspense
                fallback={<Spinner container />}
                key={`album-artist-detail-suspense-${routeId}`}
            >
                <AlbumArtistDetailRouteContent />
            </Suspense>
        </>
    );
};

const AlbumArtistDetailRouteWithBoundary = () => {
    return (
        <PageErrorBoundary>
            <AlbumArtistDetailRoute />
        </PageErrorBoundary>
    );
};

export default AlbumArtistDetailRouteWithBoundary;
