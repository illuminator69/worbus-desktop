import { useSuspenseQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { useParams } from 'react-router';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { useNativeScrollPersist } from '/@/renderer/components/native-scroll-area/use-native-scroll-persist'; // navi-connect (B-228)
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { AlbumDetailContent } from '/@/renderer/features/albums/components/album-detail-content';
import { AlbumDetailHeader } from '/@/renderer/features/albums/components/album-detail-header';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import {
    LibraryBackgroundImage,
    LibraryBackgroundOverlay,
} from '/@/renderer/features/shared/components/library-background-overlay';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useAlbumBackground, useCurrentServerId } from '/@/renderer/store';
import { useCoverWashOn } from '/@/renderer/themes/cover/cover-wash.store';
import { useCoverHeaderWash } from '/@/renderer/themes/cover/use-cover-header-wash';
import { LibraryItem } from '/@/shared/types/domain-types';

const ALBUM_DETAIL_BG_FALLBACK = 'var(--theme-colors-foreground-muted)';

const AlbumDetailRoute = () => {
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const { albumBackground, albumBackgroundBlur } = useAlbumBackground();

    // navi-connect (B-228): Back to an album lands where it was left, as on the artist page.
    useNativeScrollPersist({ enabled: true, scrollRef: scrollAreaRef });

    const { albumId } = useParams() as { albumId: string };
    const serverId = useCurrentServerId();

    const detailQuery = useSuspenseQuery({
        ...albumQueries.detail({ query: { id: albumId }, serverId }),
    });

    const imageUrl =
        useItemImageUrl({
            id: detailQuery?.data?.imageId || undefined,
            itemType: LibraryItem.ALBUM,
            type: 'itemCard',
        }) || '';

    const washOn = useCoverWashOn();
    const { background: headerBackground } = useCoverHeaderWash({
        id: detailQuery?.data?.imageId || undefined,
        serverId,
        src: imageUrl,
    });

    // With the cover wash on, no band while the cover is unresolved: the window wash shows instead.
    const background = headerBackground ?? (washOn ? undefined : ALBUM_DETAIL_BG_FALLBACK);

    const showBlurredImage = albumBackground;

    // The hero's band, drawn behind the hero and again in the bar (B-216), laid out against the hero.
    const band = showBlurredImage ? (
        <LibraryBackgroundImage
            blur={albumBackgroundBlur}
            headerRef={headerRef}
            imageUrl={imageUrl}
        />
    ) : (
        <LibraryBackgroundOverlay background={background} headerRef={headerRef} />
    );

    return (
        <AnimatedPage key={`album-detail-${albumId}`}>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: background,
                    band,
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.PlayButton
                                ids={[albumId]}
                                itemType={LibraryItem.ALBUM}
                                variant="default"
                            />
                            <LibraryHeaderBar.Title>{detailQuery.data.name}</LibraryHeaderBar.Title>
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
                    <AlbumDetailHeader ref={headerRef as React.Ref<HTMLDivElement>} />
                    <AlbumDetailContent />
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const AlbumDetailRouteWithBoundary = () => {
    return (
        <PageErrorBoundary>
            <AlbumDetailRoute />
        </PageErrorBoundary>
    );
};

export default AlbumDetailRouteWithBoundary;
