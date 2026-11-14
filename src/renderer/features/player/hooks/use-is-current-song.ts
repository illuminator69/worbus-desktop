import { useRemoteAwarePlayerSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { songRowIsPlaying } from '/@/renderer/features/player/utils/row-is-playing';
import { QueueSong, Song } from '/@/shared/types/domain-types';

/** Whether a list row is the playing song: the session's, whichever device plays it (B-451). */
export const useIsCurrentSong = (song: QueueSong | Song) => {
    const currentSong = useRemoteAwarePlayerSong();
    return { isActive: songRowIsPlaying(song as QueueSong, currentSong) };
};
