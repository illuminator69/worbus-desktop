import { t } from 'i18next';
import isElectron from 'is-electron';
import { useCallback, useEffect } from 'react';

import { notePlayRequest } from '/@/renderer/features/hub/utils/play-request';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useIsRadioActive, useRadioStore } from '/@/renderer/features/radio/hooks/use-radio-player';
import { usePlayerActions, useVolumeWheelStep } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';

const mpvPlayer = isElectron() ? window.api.mpvPlayer : null;
const mpvPlayerListener = isElectron() ? window.api.mpvPlayerListener : null;
const ipc = isElectron() ? window.api.ipc : null;

const toggleRadioPlayPause = () => {
    const radio = useRadioStore.getState();

    if (radio.isPlaying) {
        radio.actions.pause();
    } else if (radio.currentStreamUrl) {
        radio.actions.play();
    }
};

export const useMainPlayerListener = () => {
    const isRadioActive = useIsRadioActive();
    const volumeWheelStep = useVolumeWheelStep();
    // navi-connect: these are the OS-level transports — media keys, the tray menu, the
    // Windows thumbar, the macOS dock. They must drive the SESSION, exactly like the
    // in-app playerbar does, so they go through the player CONTEXT (which routes to the
    // active remote device) rather than the raw store. Talking to the store meant a media
    // key toggled the local engine, which is paused by design during remote playback — so
    // "pause" started local audio instead of pausing what you could actually hear.
    const {
        decreaseVolume,
        increaseVolume,
        mediaNext,
        mediaPause,
        mediaPlay,
        mediaPrevious,
        mediaSkipBackward,
        mediaSkipForward,
        mediaStop,
        mediaToggleMute,
        mediaTogglePlayPause,
        toggleRepeat,
        toggleShuffle,
    } = usePlayer();
    // The mpv failure path is about THIS machine's engine — pause it locally, never the
    // remote device.
    const { mediaPause: mediaPauseLocal } = usePlayerActions();

    const handleMpvError = useCallback(
        (message: string) => {
            toast.error({
                id: 'mpv-error',
                message,
                title: t('error.playbackError') as string,
            });
            mediaPauseLocal();
            mpvPlayer!.pause();
        },
        [mediaPauseLocal],
    );

    useEffect(() => {
        if (!mpvPlayerListener) {
            return;
        }

        mpvPlayerListener.rendererPlayPause(() => {
            if (!isRadioActive) {
                mediaTogglePlayPause();
                return;
            }

            toggleRadioPlayPause();
        });

        mpvPlayerListener.rendererNext(() => {
            if (!isRadioActive) {
                mediaNext(false);
            }
        });

        mpvPlayerListener.rendererNextAlbum(() => {
            if (!isRadioActive) {
                mediaNext(true);
            }
        });

        mpvPlayerListener.rendererPrevious(() => {
            if (!isRadioActive) {
                mediaPrevious(false);
            }
        });

        mpvPlayerListener.rendererPreviousAlbum(() => {
            if (!isRadioActive) {
                mediaPrevious(true);
            }
        });

        mpvPlayerListener.rendererPlay((data) => {
            if (!isRadioActive) {
                // navi-connect (B-058): the app menu, a global shortcut, MPRIS and Worbus for desktop's remote
                // send this for a person pressing play; mpv's own `resumed` echo says only that
                // the engine started (a startup auto-resume is one), so it is not marked.
                if (!(data as undefined | { fromEngine?: boolean })?.fromEngine) notePlayRequest();
                mediaPlay();
            } else {
                const radio = useRadioStore.getState();
                if (radio.currentStreamUrl) {
                    radio.actions.play();
                }
            }
        });

        mpvPlayerListener.rendererPause(() => {
            if (!isRadioActive) {
                mediaPause();
            } else {
                useRadioStore.getState().actions.pause();
            }
        });

        mpvPlayerListener.rendererStop(() => {
            if (!isRadioActive) {
                mediaStop({ reset: false });
            } else {
                useRadioStore.getState().actions.stop();
            }
        });

        mpvPlayerListener.rendererSkipForward(() => {
            mediaSkipForward();
        });

        mpvPlayerListener.rendererSkipBackward(() => {
            mediaSkipBackward();
        });

        mpvPlayerListener.rendererToggleShuffle(() => {
            toggleShuffle();
        });

        mpvPlayerListener.rendererToggleRepeat(() => {
            toggleRepeat();
        });

        mpvPlayerListener.rendererVolumeMute(() => {
            mediaToggleMute();
        });

        mpvPlayerListener.rendererVolumeUp(() => {
            increaseVolume(volumeWheelStep);
        });

        mpvPlayerListener.rendererVolumeDown(() => {
            decreaseVolume(volumeWheelStep);
        });

        mpvPlayerListener.rendererError((message: string) => {
            handleMpvError(message);
        });

        return () => {
            ipc?.removeAllListeners('renderer-player-play-pause');
            ipc?.removeAllListeners('renderer-player-next');
            ipc?.removeAllListeners('renderer-player-previous');
            ipc?.removeAllListeners('renderer-player-play');
            ipc?.removeAllListeners('renderer-player-pause');
            ipc?.removeAllListeners('renderer-player-stop');
            ipc?.removeAllListeners('renderer-player-skip-forward');
            ipc?.removeAllListeners('renderer-player-skip-backward');
            ipc?.removeAllListeners('renderer-player-toggle-shuffle');
            ipc?.removeAllListeners('renderer-player-toggle-repeat');
            ipc?.removeAllListeners('renderer-player-volume-mute');
            ipc?.removeAllListeners('renderer-player-volume-up');
            ipc?.removeAllListeners('renderer-player-volume-down');
            ipc?.removeAllListeners('renderer-player-error');
        };
    }, [
        decreaseVolume,
        handleMpvError,
        increaseVolume,
        isRadioActive,
        mediaNext,
        mediaPause,
        mediaPlay,
        mediaPrevious,
        mediaSkipForward,
        mediaSkipBackward,
        mediaStop,
        mediaToggleMute,
        mediaTogglePlayPause,
        toggleRepeat,
        toggleShuffle,
        volumeWheelStep,
    ]);
};

const MainPlayerListenerHookInner = () => {
    useMainPlayerListener();
    return null;
};

export const MainPlayerListenerHook = () => {
    const isElectronEnv = isElectron();
    const mpvPlayerListener = isElectronEnv ? window.api.mpvPlayerListener : null;

    if (mpvPlayerListener === null) {
        return null;
    }

    return <MainPlayerListenerHookInner />;
};
