import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forwardRef, Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import styles from './album-detail-header.module.css';

import { queryKeys } from '/@/renderer/api/query-keys';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { JoinedArtists } from '/@/renderer/features/albums/components/joined-artists';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { useIsPlayerFetching, usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    albumRadioSeed,
    playStationRadio,
    stationsReady,
} from '/@/renderer/features/player/station/station-client';
import { HeroActions } from '/@/renderer/features/shared/components/hero-actions';
import { LibraryHeader } from '/@/renderer/features/shared/components/library-header';
import { useSetFavorite } from '/@/renderer/features/shared/hooks/use-set-favorite';
import { useSetRating } from '/@/renderer/features/shared/hooks/use-set-rating';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServer, useShowFavorites, useShowRatings } from '/@/renderer/store';
import { useArtistRadioCount } from '/@/renderer/store/settings.store';
import { formatPartialIsoDateUTC, formatSizeString } from '/@/renderer/utils';
import { normalizeReleaseTypes } from '/@/renderer/utils/normalize-release-types';
import { LibraryItem, ServerType } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

export const AlbumDetailHeader = forwardRef<HTMLDivElement>((_props, ref) => {
    const { albumId } = useParams() as { albumId: string };
    const { t } = useTranslation();
    const server = useCurrentServer();
    const showRatings = useShowRatings();
    const showFavorites = useShowFavorites();
    const queryClient = useQueryClient();
    const albumRadioCount = useArtistRadioCount();
    const detailQuery = useQuery(
        albumQueries.detail({ query: { id: albumId }, serverId: server?.id }),
    );

    const showRating =
        showRatings &&
        (detailQuery?.data?._serverType === ServerType.NAVIDROME ||
            detailQuery?.data?._serverType === ServerType.SUBSONIC);

    const { addToQueueByData, addToQueueByFetch } = usePlayer();

    const setRating = useSetRating();
    const setFavorite = useSetFavorite();

    const handleFavorite = showFavorites
        ? () => {
              if (!detailQuery?.data) return;
              setFavorite(
                  detailQuery.data._serverId,
                  [detailQuery.data.id],
                  LibraryItem.ALBUM,
                  !detailQuery.data.userFavorite,
              );
          }
        : undefined;

    const handleUpdateRating = showRating
        ? (rating: number) => {
              if (!detailQuery?.data) return;

              if (detailQuery.data.userRating === rating) {
                  return setRating(
                      detailQuery.data._serverId,
                      [detailQuery.data.id],
                      LibraryItem.ALBUM,
                      0,
                  );
              }

              return setRating(
                  detailQuery.data._serverId,
                  [detailQuery.data.id],
                  LibraryItem.ALBUM,
                  rating,
              );
          }
        : undefined;

    const handlePlay = (type: Play) => {
        if (!server?.id || !albumId) return;
        addToQueueByFetch(server.id, [albumId], LibraryItem.ALBUM, type);
    };

    const handleMoreOptions = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!detailQuery?.data) return;
        ContextMenuController.call({
            cmd: { items: [detailQuery.data], type: LibraryItem.ALBUM },
            event: e,
        });
    };

    // Album radio is busy while the player fetches (`isPlayerFetching`, the fallback's query) and
    // while the station path builds its queue, which runs outside that query key: either way a
    // second press is ignored, as the artist page's Artist radio does.
    const isPlayerFetching = useIsPlayerFetching();
    const [radioPending, setRadioPending] = useState(false);
    const radioBusy = isPlayerFetching || radioPending;

    const handleAlbumRadio = async () => {
        if (!server?.id || !albumId || radioBusy) return;
        setRadioPending(true);
        try {
            // navi-connect (I-040): a station seeded with up to five of the album's own tracks.
            if (stationsReady() && detailQuery?.data) {
                const seeded = await albumRadioSeed(server.id, detailQuery.data).catch(() => null);
                if (
                    seeded &&
                    (await playStationRadio({
                        ...seeded,
                        player: { addToQueueByData },
                        serverId: server.id,
                        sessionName: detailQuery.data.name,
                    }))
                ) {
                    return;
                }
            }

            const albumRadioSongs = await queryClient.fetchQuery({
                ...songsQueries.albumRadio({
                    query: {
                        albumId: albumId,
                        count: albumRadioCount,
                    },
                    serverId: server.id,
                }),
                queryKey: queryKeys.player.fetch({ albumId: albumId }),
            });
            if (albumRadioSongs && albumRadioSongs.length > 0) {
                addToQueueByData(albumRadioSongs, Play.NOW);
            }
        } catch (error) {
            console.error('Failed to load album radio:', error);
        } finally {
            setRadioPending(false);
        }
    };

    // The board's meta line (`.meta`): the album artist in the accent, then the release date (the
    // full date when the album has one, else the year), songs and minutes, size and plays, each
    // only when known.
    const album = detailQuery?.data;
    const metaParts = useMemo(() => {
        if (!album) return [];
        const parts: Array<{ id: string; value: string }> = [];
        if (album.releaseDate) {
            parts.push({ id: 'released', value: formatPartialIsoDateUTC(album.releaseDate) });
        } else if (album.releaseYear != null && album.releaseYear > 0) {
            parts.push({ id: 'released', value: String(album.releaseYear) });
        }
        if (album.songCount) {
            const minutes = Math.round((album.duration || 0) / 60000);
            parts.push({
                id: 'length',
                value:
                    minutes > 0
                        ? t('page.albumDetail.songsAndMinutes', {
                              count: album.songCount,
                              minutes,
                          })
                        : t('page.albumDetail.songs', { count: album.songCount }),
            });
        }
        if (album.size) parts.push({ id: 'size', value: formatSizeString(album.size) });
        if (album.playCount) {
            parts.push({ id: 'plays', value: t('entity.play', { count: album.playCount }) });
        }
        return parts;
    }, [album, t]);

    // The kicker: the release type ("Album", "EP", "Single"), else the item type, then the
    // edition when the album names one.
    const kicker = useMemo(() => {
        const releaseTypes = album?.releaseType
            ? normalizeReleaseTypes([album.releaseType], t)
            : null;
        const type = releaseTypes?.length ? releaseTypes[0] : t('entity.album', { count: 1 });
        return album?.version ? `${type} · ${album.version}` : type;
    }, [album?.releaseType, album?.version, t]);

    const hasArtist = Boolean(album?.albumArtistName || album?.albumArtists?.length);

    return (
        <LibraryHeader
            hero={{ image: 184, title: 48 }}
            item={{
                children: kicker,
                dominantColor: album?.dominantColor,
                explicitStatus: album?.explicitStatus ?? null,
                imageId: album?.imageId,
                imageUrl: album?.imageUrl,
                route: AppRoute.LIBRARY_ALBUMS,
                type: LibraryItem.ALBUM,
            }}
            ref={ref}
            title={album?.name || ''}
        >
            {(hasArtist || metaParts.length > 0) && (
                <div className={styles.meta}>
                    {hasArtist && (
                        <JoinedArtists
                            artistName={album?.albumArtistName || ''}
                            artists={album?.albumArtists || []}
                            linkProps={{ className: styles.artistLink, fw: 800 }}
                            rootTextProps={{ className: styles.inherit }}
                        />
                    )}
                    {metaParts.map((part, index) => (
                        <Fragment key={part.id}>
                            {(hasArtist || index > 0) && ' · '}
                            {part.value}
                        </Fragment>
                    ))}
                </div>
            )}
            <HeroActions
                actions={[
                    {
                        icon: 'mediaPlayNext',
                        key: 'next',
                        label: t('page.albumDetail.playNext'),
                        onClick: () => handlePlay(Play.NEXT),
                        variant: 'filled',
                    },
                    {
                        icon: 'mediaPlayLast',
                        key: 'queue',
                        label: t('page.albumDetail.addToQueue'),
                        onClick: () => handlePlay(Play.LAST),
                        variant: 'filled',
                    },
                    {
                        busy: radioBusy,
                        icon: 'radio',
                        key: 'radio',
                        label: t('player.albumRadio'),
                        onClick: () => void handleAlbumRadio(),
                        variant: 'accent-outline',
                    },
                ]}
                favorite={album?.userFavorite}
                onFavorite={handleFavorite}
                onMore={handleMoreOptions}
                onPlay={() => handlePlay(Play.NOW)}
                onRating={handleUpdateRating}
                rating={album?.userRating || 0}
            />
        </LibraryHeader>
    );
});
