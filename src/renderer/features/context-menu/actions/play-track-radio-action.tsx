import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { queryKeys } from '/@/renderer/api/query-keys';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { keepsCurrentSong } from '/@/renderer/features/player/station/keep-current'; // navi-connect (B-175)
import {
    currentSongId, // navi-connect (B-175)
    playStationRadio,
    trackRadioSeed,
} from '/@/renderer/features/player/station/station-client';
import { markNextQueueSource } from '/@/renderer/features/player/utils/saved-queue-source';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { useArtistRadioCount, useCurrentServerId, usePlayButtonBehavior } from '/@/renderer/store';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

interface PlayTrackRadioActionProps {
    disabled?: boolean;
    skipFirstSong?: boolean;
    song: Song;
}

export const PlayTrackRadioAction = ({
    disabled,
    skipFirstSong,
    song,
}: PlayTrackRadioActionProps) => {
    const { t } = useTranslation();
    const player = usePlayer();
    const serverId = useCurrentServerId();
    const queryClient = useQueryClient();
    const playButtonBehavior = usePlayButtonBehavior();

    const radioCount = useArtistRadioCount();

    const handlePlayTrackRadio = useCallback(
        async (playType: Play) => {
            if (!serverId || !song) return;

            // navi-connect (I-040): Play starts a station on the hub when it has the engine; the
            // queue is the song, then what the station serves, and autoplay continues it.
            if (
                playType === Play.NOW &&
                (await playStationRadio({
                    ...trackRadioSeed(song),
                    player,
                    serverId,
                    sessionName: song.name,
                }))
            ) {
                return;
            }

            try {
                const similarSongs = await queryClient.fetchQuery({
                    ...songsQueries.similar({
                        query: {
                            count: radioCount,
                            songId: song.id,
                        },
                        serverId,
                    }),
                    queryKey: queryKeys.player.fetch({ similarSongs: song.id }),
                });

                if (similarSongs && similarSongs.length > 0) {
                    // We need to skip the first song when adding to the queue as NEXT or LAST, otherwise you will have a duplicate song
                    const shouldSkipFirstSong =
                        skipFirstSong && (playType === Play.NEXT || playType === Play.LAST);
                    const queueSongs = shouldSkipFirstSong ? similarSongs : [song, ...similarSongs];
                    if (playType === Play.NOW) {
                        markNextQueueSource('radio', song.name);
                        // navi-connect (B-175): from the song playing now, keep it playing.
                        if (keepsCurrentSong(queueSongs, currentSongId())) {
                            player.playKeepingCurrent(queueSongs);
                            return;
                        }
                    }
                    player.addToQueueByData(queueSongs, playType);
                }
            } catch (error) {
                console.error('Failed to load track radio:', error);
            }
        },
        [player, queryClient, radioCount, serverId, skipFirstSong, song],
    );

    const handlePlayTrackRadioNow = useCallback(() => {
        handlePlayTrackRadio(Play.NOW);
    }, [handlePlayTrackRadio]);

    const handlePlayTrackRadioNext = useCallback(() => {
        handlePlayTrackRadio(Play.NEXT);
    }, [handlePlayTrackRadio]);

    const handlePlayTrackRadioLast = useCallback(() => {
        handlePlayTrackRadio(Play.LAST);
    }, [handlePlayTrackRadio]);

    const defaultPlayTrackRadioAction = useCallback(() => {
        handlePlayTrackRadio(playButtonBehavior);
    }, [handlePlayTrackRadio, playButtonBehavior]);

    return (
        <ContextMenu.Submenu>
            <ContextMenu.SubmenuTarget>
                <ContextMenu.Item
                    disabled={disabled}
                    leftIcon="radio"
                    onSelect={defaultPlayTrackRadioAction}
                    rightIcon="arrowRightS"
                >
                    {t('player.trackRadio')}
                </ContextMenu.Item>
            </ContextMenu.SubmenuTarget>
            <ContextMenu.SubmenuContent>
                <ContextMenu.Item leftIcon="mediaPlay" onSelect={handlePlayTrackRadioNow}>
                    {t('player.play')}
                </ContextMenu.Item>
                <ContextMenu.Item leftIcon="mediaPlayNext" onSelect={handlePlayTrackRadioNext}>
                    {t('player.addNext')}
                </ContextMenu.Item>
                <ContextMenu.Item leftIcon="mediaPlayLast" onSelect={handlePlayTrackRadioLast}>
                    {t('player.addLast')}
                </ContextMenu.Item>
            </ContextMenu.SubmenuContent>
        </ContextMenu.Submenu>
    );
};
