import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate } from 'react-router';

import { api } from '/@/renderer/api';
import { AppRoute } from '/@/renderer/router/routes';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Album, LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';

interface GoToActionProps {
    items: Album[] | QueueSong[] | Song[];
}

export const GoToAction = ({ items }: GoToActionProps) => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const own = useMemo(() => {
        const firstItem = items[0];

        switch (firstItem._itemType) {
            case LibraryItem.ALBUM:
                return {
                    albumId: firstItem.id,
                    artists: firstItem.albumArtists || [],
                };
            case LibraryItem.SONG:
                return {
                    albumId: firstItem.albumId,
                    artists:
                        (firstItem.artists?.length ? firstItem.artists : firstItem.albumArtists) ||
                        [],
                };
            default:
                return {
                    albumId: null,
                    artists: [],
                };
        }
    }, [items]);

    /**
     * navi-connect: fill in what a hub-derived row does not carry.
     *
     * The side queue shows the **remote session's** queue while playback is on
     * another device, and those rows are built from the hub's wire track rather
     * than from a library read. That track carries the album's *name* and the
     * artist's *name*, and the ids only if the publisher happened to send them —
     * Worbus for Android's `trackJson` sends neither, and the hub's saved-queue whitelist
     * (`SQ_TRACK_FIELDS`) drops `albumId` in any case. So this submenu had no
     * "Go to album" entry at all, and its artist entry navigated to an empty id.
     *
     * One `getSongDetail`, on the gesture that opens the menu, and only when the
     * ids are actually missing — so nothing changes for an ordinary library row,
     * which always has them. Resolving the whole remote queue up front would be
     * one request per track per queue edit, which is the trap
     * `resolveHubTracks` already documents.
     */
    const firstItem = items[0];
    const needsResolve =
        items.length === 1 &&
        firstItem._itemType === LibraryItem.SONG &&
        (!own.albumId || own.artists.every((artist) => !artist.id));

    const resolved = useQuery({
        enabled: needsResolve && Boolean(firstItem._serverId) && Boolean(firstItem.id),
        queryFn: () =>
            api.controller
                .getSongDetail({
                    apiClientProps: { serverId: firstItem._serverId },
                    query: { id: firstItem.id },
                })
                .catch(() => null),
        queryKey: ['go-to-action', 'song', firstItem._serverId, firstItem.id],
        staleTime: 5 * 60 * 1000,
    });

    const albumId = own.albumId || resolved.data?.albumId || null;
    const artists = own.artists.some((artist) => artist.id)
        ? own.artists
        : ((resolved.data?.artists?.length ? resolved.data.artists : resolved.data?.albumArtists) ??
          []);

    const handleGoToAlbum = useCallback(() => {
        if (!albumId) return;
        navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId }));
    }, [albumId, navigate]);

    const handleGoToArtist = useCallback(
        (albumArtistId: string) => {
            navigate(generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId }));
        },
        [navigate],
    );

    const hasAlbum = !!albumId;

    return (
        <ContextMenu.Submenu disabled={items.length !== 1}>
            <ContextMenu.SubmenuTarget>
                <ContextMenu.Item
                    leftIcon="externalLink"
                    onSelect={(e) => e.preventDefault()}
                    rightIcon="arrowRightS"
                >
                    {t('page.contextMenu.goTo')}
                </ContextMenu.Item>
            </ContextMenu.SubmenuTarget>
            <ContextMenu.SubmenuContent>
                {hasAlbum && (
                    <ContextMenu.Item leftIcon="album" onSelect={handleGoToAlbum}>
                        {t('page.contextMenu.goToAlbum')}
                    </ContextMenu.Item>
                )}
                {/* An id-less credit is a name the hub sent with no library row
                    behind it. Rendering it would be a control that navigates to
                    an empty artist route, which is worse than not offering it. */}
                {artists
                    .filter((artist) => artist.id)
                    .map((artist) => (
                        <ContextMenu.Item
                            key={artist.id}
                            leftIcon="artist"
                            onSelect={() => handleGoToArtist(artist.id)}
                        >
                            {`${t('page.contextMenu.goTo')} ${artist.name}`}
                        </ContextMenu.Item>
                    ))}
            </ContextMenu.SubmenuContent>
        </ContextMenu.Submenu>
    );
};
