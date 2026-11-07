import { useSuspenseQuery, UseSuspenseQueryResult } from '@tanstack/react-query';
import { forwardRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createSearchParams, generatePath, useParams } from 'react-router';

import styles from './album-artist-detail-header.module.css';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { usePlayArtistReleases } from '/@/renderer/features/artists/hooks/use-play-artist-releases';
import { useDeleteArtistImage } from '/@/renderer/features/artists/mutations/delete-artist-image-mutation';
import { useUploadArtistImage } from '/@/renderer/features/artists/mutations/upload-artist-image-mutation';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { ownedPlayIds } from '/@/renderer/features/discography/artist-shelves';
import { useDiscographyItems } from '/@/renderer/features/discography/hooks/use-discography-items';
import { useEffectiveArtistMbid } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useIsPlayerFetching, usePlayer } from '/@/renderer/features/player/context/player-context';
import { playArtistRadio } from '/@/renderer/features/player/station/station-client';
import { HeroActions } from '/@/renderer/features/shared/components/hero-actions';
import { LibraryHeader } from '/@/renderer/features/shared/components/library-header';
import { useSetFavorite } from '/@/renderer/features/shared/hooks/use-set-favorite';
import { useSetRating } from '/@/renderer/features/shared/hooks/use-set-rating';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServer, useShowFavorites, useShowRatings } from '/@/renderer/store';
import { useArtistRadioCount } from '/@/renderer/store/settings.store';
import { hasFeature } from '/@/shared/api/utils';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { FileButton } from '/@/shared/components/file-button/file-button';
import { Group } from '/@/shared/components/group/group';
import {
    AlbumArtistDetailResponse,
    AlbumListResponse,
    LibraryItem,
    ServerType,
} from '/@/shared/types/domain-types';
import { ServerFeature } from '/@/shared/types/features-types';
import { Play } from '/@/shared/types/types';

interface AlbumArtistDetailHeaderProps {
    albumsQuery: UseSuspenseQueryResult<AlbumListResponse, Error>;
}

function ArtistImageUploadOverlay({
    data,
    onUploadFile,
}: {
    data?: AlbumArtistDetailResponse;
    onUploadFile: (file: File) => Promise<void>;
}) {
    const deleteArtistImageMutation = useDeleteArtistImage({});
    const server = useCurrentServer();

    if (!data) return null;
    if (!hasFeature(server, ServerFeature.ARTIST_IMAGE_UPLOAD)) return null;

    return (
        <Group gap="xs">
            <FileButton
                accept="image/*"
                onChange={async (file) => {
                    if (!file) return;
                    await onUploadFile(file);
                }}
            >
                {(props) => (
                    <ActionIcon
                        icon="uploadImage"
                        iconProps={{ size: 'lg' }}
                        radius="xl"
                        size="xs"
                        variant="default"
                        {...props}
                    />
                )}
            </FileButton>
            <ActionIcon
                disabled={!data?.uploadedImage}
                icon="delete"
                iconProps={{ size: 'lg' }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (!data?._serverId) return;
                    deleteArtistImageMutation.mutate({
                        apiClientProps: {
                            serverId: data._serverId,
                        },
                        query: { id: data.id },
                    });
                }}
                radius="xl"
                size="xs"
                variant="default"
            />
        </Group>
    );
}

export const AlbumArtistDetailHeader = forwardRef<HTMLDivElement, AlbumArtistDetailHeaderProps>(
    ({ albumsQuery }, ref) => {
        const { albumArtistId, artistId } = useParams() as {
            albumArtistId?: string;
            artistId?: string;
        };
        const routeId = (artistId || albumArtistId) as string;
        const server = useCurrentServer();
        const showRatings = useShowRatings();
        const showFavorites = useShowFavorites();
        const { t } = useTranslation();
        const detailQuery = useSuspenseQuery(
            artistsQueries.albumArtistDetail({
                query: { id: routeId },
                serverId: server?.id,
            }),
        );

        const setFavorite = useSetFavorite();
        const setRating = useSetRating();
        const uploadArtistImageMutation = useUploadArtistImage({});

        // Play and Shuffle play every owned album, newest first (the default discography view's
        // order); the discography page plays its own filtered view.
        const mbzId = useEffectiveArtistMbid(routeId, detailQuery.data?.mbz);
        const { items, known } = useDiscographyItems({
            artistMbid: mbzId,
            ndId: routeId,
            owned: albumsQuery.data?.items ?? null,
        });
        const playIds = useMemo(() => ownedPlayIds(items), [items]);
        const playReleases = usePlayArtistReleases({ routeId });

        // The board's meta line: songs, then "X of Y releases" when lb-bot knows the artist (X owned
        // or partly), then at most three genres.
        const songCount = detailQuery.data?.songCount;
        const genres = detailQuery.data?.genres;
        const meta = useMemo(() => {
            const parts: string[] = [];
            if (songCount !== null && songCount !== undefined) {
                parts.push(t('page.albumArtistDetail.songsInLibrary', { count: songCount }));
            }
            if (known && items.length > 0) {
                parts.push(
                    t('page.albumArtistDetail.releasesOwned', {
                        owned: items.filter(
                            (item) => item.ownership === 'owned' || item.ownership === 'partly',
                        ).length,
                        total: items.length,
                    }),
                );
            }
            const names = (genres ?? [])
                .slice(0, 3)
                .map((genre) => genre.name)
                .filter(Boolean);
            if (names.length > 0) parts.push(names.join(', '));
            return parts.join(' · ');
        }, [genres, items, known, songCount, t]);

        const artistRadioCount = useArtistRadioCount();
        const isPlayerFetching = useIsPlayerFetching();
        const { addToQueueByData } = usePlayer();
        const artistName = detailQuery.data?.name;
        const serverId = server?.id;
        const handleArtistRadio = useCallback(async () => {
            if (!serverId || !routeId || !artistName) return;
            // navi-connect (B-149): the artist's own most played songs, then a station from them
            // (with the engine) or Navidrome's similar songs.
            try {
                await playArtistRadio({
                    artist: { id: routeId, name: artistName },
                    count: artistRadioCount,
                    player: { addToQueueByData },
                    playType: Play.NOW,
                    serverId,
                });
            } catch (error) {
                console.error('Failed to load artist radio:', error);
            }
        }, [addToQueueByData, artistName, artistRadioCount, routeId, serverId]);

        const artistSongsLink = `${generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL_SONGS, {
            albumArtistId: routeId,
        })}?${createSearchParams({ artistId: routeId, artistName: artistName || '' })}`;

        const handleFavorite = useCallback(() => {
            if (!detailQuery.data) return;
            setFavorite(
                detailQuery.data._serverId,
                [detailQuery.data.id],
                LibraryItem.ALBUM_ARTIST,
                !detailQuery.data.userFavorite,
            );
        }, [detailQuery.data, setFavorite]);

        const handleUpdateRating = useCallback(
            (rating: number) => {
                if (!detailQuery.data) return;

                if (detailQuery.data.userRating === rating) {
                    return setRating(
                        detailQuery.data._serverId,
                        [detailQuery.data.id],
                        LibraryItem.ALBUM_ARTIST,
                        0,
                    );
                }

                return setRating(
                    detailQuery.data._serverId,
                    [detailQuery.data.id],
                    LibraryItem.ALBUM_ARTIST,
                    rating,
                );
            },
            [detailQuery.data, setRating],
        );

        const handleMoreOptions = useCallback(
            (e: React.MouseEvent<HTMLButtonElement>) => {
                if (!detailQuery.data) return;
                ContextMenuController.call({
                    cmd: { items: [detailQuery.data], type: LibraryItem.ALBUM_ARTIST },
                    event: e,
                });
            },
            [detailQuery.data],
        );

        const headerImageUrl = useItemImageUrl({
            id: detailQuery.data?.imageId || undefined,
            imageUrl: detailQuery.data?.imageUrl,
            itemType: LibraryItem.ALBUM_ARTIST,
            type: 'header',
        });

        const showRating = showRatings && detailQuery?.data?._serverType === ServerType.NAVIDROME;

        const canUploadArtistImage =
            hasFeature(server, ServerFeature.ARTIST_IMAGE_UPLOAD) &&
            Boolean(detailQuery.data?._serverId);

        const handleArtistImageUpload = useCallback(
            async (file: File) => {
                const artist = detailQuery.data;
                if (!artist?._serverId) return;

                const buffer = await file.arrayBuffer();
                uploadArtistImageMutation.mutate({
                    apiClientProps: {
                        serverId: artist._serverId,
                    },
                    body: { image: new Uint8Array(buffer) },
                    query: { id: artist.id },
                });
            },
            [detailQuery.data, uploadArtistImageMutation],
        );

        return (
            <LibraryHeader
                hero={{ image: 168, round: true, title: 54 }}
                imageOverlay={
                    <ArtistImageUploadOverlay
                        data={detailQuery.data}
                        onUploadFile={handleArtistImageUpload}
                    />
                }
                imageUrl={headerImageUrl}
                item={{
                    blurHash: detailQuery.data?.blurHash,
                    children: t('entity.artist', { count: 1 }),
                    imageId: detailQuery.data?.imageId,
                    imageUrl: detailQuery.data?.imageUrl,
                    route: AppRoute.LIBRARY_ALBUM_ARTISTS,
                    thumbHash: detailQuery.data?.thumbHash,
                    type: LibraryItem.ALBUM_ARTIST,
                }}
                onImageFileDrop={canUploadArtistImage ? handleArtistImageUpload : undefined}
                ref={ref}
                title={detailQuery.data?.name || ''}
            >
                {meta && <div className={styles.meta}>{meta}</div>}
                <HeroActions
                    actions={[
                        {
                            icon: 'mediaShuffle',
                            key: 'shuffle',
                            label: t('page.albumArtistDetail.shuffle'),
                            onClick: () => playReleases(playIds, Play.SHUFFLE),
                            variant: 'filled',
                        },
                        {
                            busy: isPlayerFetching,
                            icon: 'radio',
                            key: 'radio',
                            label: t('player.artistRadio'),
                            onClick: () => void handleArtistRadio(),
                            variant: 'filled',
                        },
                        {
                            icon: 'playlist',
                            key: 'tracks',
                            label: t('page.albumArtistDetail.allTracks'),
                            to: artistSongsLink,
                            variant: 'outline',
                        },
                    ]}
                    favorite={detailQuery.data?.userFavorite}
                    onFavorite={showFavorites ? handleFavorite : undefined}
                    onMore={handleMoreOptions}
                    onPlay={() => playReleases(playIds, Play.NOW)}
                    onRating={showRating ? handleUpdateRating : undefined}
                    rating={detailQuery.data?.userRating || 0}
                />
            </LibraryHeader>
        );
    },
);
