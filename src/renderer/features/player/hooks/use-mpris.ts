import isElectron from 'is-electron';
import React, { useEffect, useMemo } from 'react';

import { getItemImageUrl, useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { getRemoteAwareSnapshot } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { isRemoteSessionActive } from '/@/renderer/features/hub/utils/remote-queue';
import { lyricsMetadataToLrc } from '/@/renderer/features/lyrics/components/lyrics-export-form';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import {
    useIsRadioActive,
    useRadioPlayer,
} from '/@/renderer/features/radio/hooks/use-radio-player';
import {
    useHubIsRemoteActive,
    useHubStore,
    usePlayerSong,
    usePlayerStore,
} from '/@/renderer/store';
import { LibraryItem, QueueSong } from '/@/shared/types/domain-types';
import { PlayerShuffle, PlayerStatus, ServerType } from '/@/shared/types/types';

const ipc = isElectron() ? window.api.ipc : null;
const utils = isElectron() ? window.api.utils : null;
const mpris = isElectron() && (utils?.isLinux() || utils?.isMacOS()) ? window.api.mpris : null;

export const useMPRIS = () => {
    const player = usePlayerStore();
    const currentSong = usePlayerSong();
    const isRemote = useHubIsRemoteActive();
    const isRadioActive = useIsRadioActive();
    const { metadata: radioMetadata, stationName } = useRadioPlayer();

    const imageUrl = useItemImageUrl({
        id: currentSong?.imageId || undefined,
        imageUrl: currentSong?.imageUrl,
        itemType: LibraryItem.SONG,
        type: 'itemCard',
    });

    const radioSong = useMemo((): QueueSong | undefined => {
        if (!isRadioActive) {
            return undefined;
        }

        const title = radioMetadata?.title || stationName || 'Radio';
        const artist = radioMetadata?.artist || stationName || null;
        const album = stationName || null;

        const radioId = `radio-${stationName || 'unknown'}`;

        return {
            _itemType: LibraryItem.SONG,
            _serverId: '',
            _serverType: ServerType.NAVIDROME,
            _uniqueId: radioId,
            album: album || null,
            albumArtistName: artist || '',
            albumArtists: artist
                ? [
                      {
                          id: '',
                          imageId: null,
                          imageUrl: null,
                          name: artist,
                          userFavorite: false,
                          userRating: null,
                      },
                  ]
                : [],
            albumId: '',
            artistName: artist || '',
            artists: artist
                ? [
                      {
                          id: '',
                          imageId: null,
                          imageUrl: null,
                          name: artist,
                          userFavorite: false,
                          userRating: null,
                      },
                  ]
                : [],
            bitDepth: null,
            bitRate: 0,
            blurHash: null,
            bpm: null,
            channels: null,
            codec: null,
            comment: null,
            compilation: null,
            container: null,
            createdAt: '',
            date: null,
            discNumber: 0,
            discSubtitle: null,
            duration: 0,
            explicitStatus: null,
            folderId: null,
            gain: null,
            genres: [],
            id: radioId,
            imageId: null,
            imageUrl: null,
            lastPlayedAt: null,
            libraryId: null,
            libraryName: null,
            lyrics: null,
            mbzAlbumId: null,
            mbzAlbumType: null,
            mbzRecordingId: null,
            mbzReleaseGroupId: null,
            mbzTrackId: null,
            missing: null,
            name: title,
            originalDate: null,
            originalYear: null,
            participants: null,
            path: null,
            peak: null,
            playCount: 0,
            releaseDate: null,
            releaseYear: null,
            sampleRate: null,
            size: 0,
            sortName: title,
            tags: null,
            thumbHash: null,
            trackNumber: 0,
            trackSubtitle: null,
            updatedAt: new Date().toISOString(),
            userFavorite: false,
            userRating: null,
            year: null,
        };
    }, [isRadioActive, radioMetadata, stationName]);

    useEffect(() => {
        if (!mpris) {
            return;
        }

        mpris?.requestPosition((data: { position: number }) => {
            player.mediaSeekToTimestamp(data.position);
        });

        mpris?.requestSeek((data: { offset: number }) => {
            player.mediaSkipForward(data.offset);
        });

        mpris?.requestToggleRepeat(() => {
            player.toggleRepeat();
        });

        mpris?.requestToggleShuffle(() => {
            player.toggleShuffle();
        });

        mpris?.requestVolume((data: { volume: number }) => {
            player.setVolume(data.volume);
        });

        return () => {
            ipc?.removeAllListeners('mpris-request-toggle-repeat');
            ipc?.removeAllListeners('mpris-request-toggle-shuffle');
            ipc?.removeAllListeners('request-position');
            ipc?.removeAllListeners('request-seek');
            ipc?.removeAllListeners('request-volume');
        };
    }, [player]);

    // Update MPRIS when song, imageUrl, or radio metadata changes — for LOCAL playback. While
    // another device plays, the effect below owns MPRIS; this one re-publishes the local song
    // and status when playback comes back here.
    useEffect(() => {
        if (!mpris || isRemote) {
            return;
        }

        // Use radio song while a station is loaded (playing or paused)
        const songToUpdate = isRadioActive ? radioSong : currentSong;
        const imageUrlToUpdate = isRadioActive ? null : imageUrl;

        mpris?.updateSong(songToUpdate, imageUrlToUpdate);
        mpris?.updateStatus(usePlayerStore.getState().player.status);
    }, [currentSong, imageUrl, isRadioActive, isRemote, radioSong]);

    // navi-connect (B-050): MPRIS must describe the SESSION, not this client's local engine.
    // While another device plays (a cast from here, Worbus for Android), the local player sits paused on
    // the pre-transfer track — so the desktop's media widget read "paused" on a stale song and
    // never followed a track change. Same rule as use-media-session's `publish`. The hub store
    // carries the ~1 Hz progress mirror, so each field is published only on an actual change.
    useEffect(() => {
        if (!mpris || !isRemote) {
            return;
        }

        let lastSongId: string | undefined;
        let lastStatus: PlayerStatus | undefined;
        let lastPositionSec = -1;

        const publish = () => {
            const { isRemote: remote, song, status } = getRemoteAwareSnapshot();
            if (!remote) return;
            if (song?.id !== lastSongId) {
                lastSongId = song?.id;
                const songImageUrl = song
                    ? getItemImageUrl({
                          id: song.imageId || undefined,
                          imageUrl: song.imageUrl,
                          itemType: LibraryItem.SONG,
                          type: 'itemCard',
                      })
                    : null;
                mpris.updateSong(song, songImageUrl ?? null);
            }
            if (status !== lastStatus) {
                lastStatus = status;
                mpris.updateStatus(status);
            }
            const hub = useHubStore.getState();
            const positionMs =
                hub.remotePositionMs +
                (hub.remoteIsPlaying ? Date.now() - hub.remotePositionAt : 0);
            const positionSec = Math.max(0, Math.floor(positionMs / 1000));
            if (positionSec !== lastPositionSec) {
                lastPositionSec = positionSec;
                mpris.updatePosition(positionSec);
            }
        };

        const unsubscribe = useHubStore.subscribe(publish);
        publish();
        return unsubscribe;
    }, [isRemote]);

    usePlayerEvents(
        {
            onCurrentSongChange: () => {
                // The effect above will handle the update when currentSong changes
            },
            onPlayerLyricsFetched: (properties) => {
                if (!mpris) {
                    return;
                }

                const formattedLyrics = lyricsMetadataToLrc(
                    properties.lyrics,
                    properties.offsetMs ?? 0,
                    properties.synced,
                );

                mpris?.updateLyrics(formattedLyrics);
            },
            onPlayerProgress: (properties) => {
                if (!mpris || isRemoteSessionActive()) {
                    return;
                }

                const timestamp = properties.timestamp;
                mpris?.updatePosition(timestamp);
            },
            onPlayerRepeat: (properties) => {
                if (!mpris) {
                    return;
                }

                mpris?.updateRepeat(properties.repeat);
            },
            onPlayerSeekToTimestamp: (properties) => {
                if (!mpris || isRemoteSessionActive()) {
                    return;
                }

                const timestamp = properties.timestamp;
                mpris?.updateSeek(timestamp);
            },
            onPlayerShuffle: (properties) => {
                if (!mpris) {
                    return;
                }

                const isShuffleEnabled = properties.shuffle !== PlayerShuffle.NONE;
                mpris?.updateShuffle(isShuffleEnabled);
            },
            onPlayerStatus: (properties) => {
                if (!mpris || isRemoteSessionActive()) {
                    return;
                }

                mpris?.updateStatus(properties.status);
            },
            onPlayerVolume: (properties) => {
                if (!mpris) {
                    return;
                }

                mpris?.updateVolume(properties.volume);
            },
        },
        [],
    );
};

const MPRISHookInner = () => {
    useMPRIS();
    return null;
};

export const MPRISHook = () => {
    const isElectronEnv = isElectron();
    const utils = isElectronEnv ? window.api.utils : null;
    const mpris = isElectronEnv && (utils?.isLinux() || utils?.isMacOS()) ? window.api.mpris : null;

    if (mpris === null) {
        return null;
    }

    return React.createElement(MPRISHookInner);
};
