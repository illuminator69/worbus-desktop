import { useCallback } from 'react';

import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useCurrentServer } from '/@/renderer/store';
import { usePlayButtonBehavior } from '/@/renderer/store/settings.store';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

/**
 * Plays an artist's albums by id, keeping only the songs this artist is on (a compilation's other
 * artists are left out). The caller picks the ids: the discography page plays its filtered view,
 * the artist page its owned albums. The artist is `routeId`, the page's id under either route
 * (`albumArtistId` is undefined on `/library/artists/:artistId`, where it filtered out every song).
 */
export const usePlayArtistReleases = ({ routeId }: { routeId: string }) => {
    const serverId = useCurrentServer()?.id;
    const { addToQueueByFetch } = usePlayer();
    const playButtonBehavior = usePlayButtonBehavior();

    return useCallback(
        (albumIds: string[], type?: Play) => {
            if (!serverId || !routeId) return;

            if (albumIds.length === 0) return;

            const filter = (song: Song) => {
                if (song.albumArtists.some((artist) => artist.id === routeId)) {
                    return true;
                }

                return song.artists.some((artist) => artist.id === routeId);
            };

            addToQueueByFetch(serverId, albumIds, LibraryItem.ALBUM, type || playButtonBehavior, {
                filter,
            });
        },
        [addToQueueByFetch, playButtonBehavior, routeId, serverId],
    );
};
