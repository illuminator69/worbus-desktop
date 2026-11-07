import { t } from 'i18next';
import { useCallback, useEffect, useState, WheelEvent } from 'react';

import styles from './volume-group.module.css';

import {
    useRemoteAwarePlayerSong,
    useRemoteAwareVolume,
} from '/@/renderer/features/hub/hooks/use-remote-aware';
import {
    SliderHold,
    sliderHoldRemaining,
    VOLUME_HOLD_MS,
} from '/@/renderer/features/hub/utils/volume-hold';
import { DlnaVolumeButton } from '/@/renderer/features/player/components/dlna/volume-button';
import { CustomPlayerbarSlider } from '/@/renderer/features/player/components/playerbar-slider';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useAudioDevices } from '/@/renderer/features/settings/components/playback/audio-settings';
import { useSetRating } from '/@/renderer/features/shared/hooks/use-set-rating';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import {
    useCurrentServer,
    useHotkeySettings,
    useHubActiveDeviceId,
    useHubIsRemoteActive,
    usePlaybackSettings,
    usePlaybackType,
    usePlayerMuted,
    useSettingsStoreActions,
    useShowRatings,
    useVolumeWheelStep,
    useVolumeWidth,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Popover } from '/@/shared/components/popover/popover';
import { Rating } from '/@/shared/components/rating/rating';
import { useMediaQuery } from '/@/shared/hooks/use-media-query';
import { useThrottledCallback } from '/@/shared/hooks/use-throttled-callback';
import { LibraryItem, ServerType } from '/@/shared/types/domain-types';
import { PlayerType } from '/@/shared/types/types';

/**
 * The bar's volume group (F1): the star rating directly above the volume, as the board draws it.
 * The stars float above the row, so the volume stays level with the bar's other icons. The rating and volume hotkeys live in these
 * components, so they stay mounted.
 */
export const VolumeGroup = () => {
    const showRatings = useShowRatings();
    const playbackType = usePlaybackType();
    return (
        <div className={styles.group}>
            {showRatings && (
                <div className={styles.rating}>
                    <RatingButton />
                </div>
            )}
            <div className={styles.volume}>
                {playbackType === PlayerType.DLNA ? <DlnaVolumeButton /> : <VolumeButton />}
            </div>
        </div>
    );
};

const RatingButton = () => {
    const server = useCurrentServer();
    const currentSong = useRemoteAwarePlayerSong();
    const setRating = useSetRating();
    const { bindings } = useHotkeySettings();
    const isSongDefined = Boolean(currentSong?.id);
    const showRating =
        isSongDefined &&
        (server?.type === ServerType.NAVIDROME || server?.type === ServerType.SUBSONIC);
    const handleUpdateRating = (rating: number) => {
        if (!currentSong) return;
        setRating(currentSong._serverId, [currentSong.id], LibraryItem.SONG, rating);
    };
    useHotkeys([
        [bindings.rate0.isGlobal ? '' : bindings.rate0.hotkey, () => handleUpdateRating(0)],
        [bindings.rate1.isGlobal ? '' : bindings.rate1.hotkey, () => handleUpdateRating(1)],
        [bindings.rate2.isGlobal ? '' : bindings.rate2.hotkey, () => handleUpdateRating(2)],
        [bindings.rate3.isGlobal ? '' : bindings.rate3.hotkey, () => handleUpdateRating(3)],
        [bindings.rate4.isGlobal ? '' : bindings.rate4.hotkey, () => handleUpdateRating(4)],
        [bindings.rate5.isGlobal ? '' : bindings.rate5.hotkey, () => handleUpdateRating(5)],
    ]);
    return (
        <>
            {showRating && (
                <Rating
                    onChange={handleUpdateRating}
                    size="xs"
                    value={currentSong?.userRating || 0}
                />
            )}
        </>
    );
};

const VolumeButton = () => {
    const { bindings } = useHotkeySettings();
    const volume = useRemoteAwareVolume();
    // Whose volume that is: the active remote device's, or (null) this machine's.
    const isRemote = useHubIsRemoteActive();
    const activeDeviceId = useHubActiveDeviceId();
    const volumeScope = isRemote ? activeDeviceId : null;
    const muted = usePlayerMuted();
    const volumeWheelStep = useVolumeWheelStep();
    const volumeWidth = useVolumeWidth();
    const { decreaseVolume, increaseVolume, mediaToggleMute, setVolume } = usePlayer();
    // At 1180 px and under the slider folds into the icon: a click opens it in a popover, and a
    // click while it is open mutes, as the icon does on its own at full width (F1).
    const isFolded = useMediaQuery('(max-width: 1180px)');
    const [sliderOpen, setSliderOpen] = useState(false);

    const playbackType = usePlaybackType();
    const playbackSettings = usePlaybackSettings();
    const { setSettings } = useSettingsStoreActions();
    const audioDevices = useAudioDevices(playbackType);

    const currentAudioDeviceId =
        playbackType === PlayerType.LOCAL
            ? playbackSettings.mpvAudioDeviceId
            : playbackSettings.audioDeviceId;

    const handleSelectAudioDevice = useCallback(
        (deviceId: null | string) => {
            setSettings({
                playback:
                    playbackType === PlayerType.LOCAL
                        ? { mpvAudioDeviceId: deviceId }
                        : { audioDeviceId: deviceId },
            });
        },
        [playbackType, setSettings],
    );

    // navi-connect: the slider shows its own value only while it is being dragged, and once let
    // go until the level it asked for is observed (or 2.5 s pass); the rest of the time it shows
    // `volume`. It used to be a copy of `volume`, kept in step by one effect while a second
    // effect sent every change of the copy. On a remote device `volume` is the hub's echo of
    // what was sent, so each echo overwrote the drag and was then sent back, anything changed
    // elsewhere was sent back once, and mounting sent one too. Now the slider is the only thing
    // that sends, and only when it is moved (volume-hold.ts).
    const [sliderHold, setSliderHold] = useState<null | SliderHold>(null);
    const sendVolume = useThrottledCallback(setVolume, 100);

    useEffect(() => {
        if (!sliderHold) return undefined;
        const left = sliderHoldRemaining(sliderHold, volumeScope, volume, Date.now());
        if (left === 0) {
            setSliderHold(null);
            return undefined;
        }
        const timer = setTimeout(() => setSliderHold(null), left);
        return () => clearTimeout(timer);
    }, [sliderHold, volume, volumeScope]);

    // A hold made on another device's volume is not shown for even one frame.
    const sliderValue = sliderHold && sliderHold.scope === volumeScope ? sliderHold.value : volume;

    const handleVolumeDown = useCallback(() => {
        decreaseVolume(volumeWheelStep);
    }, [decreaseVolume, volumeWheelStep]);

    const handleVolumeUp = useCallback(() => {
        increaseVolume(volumeWheelStep);
    }, [increaseVolume, volumeWheelStep]);

    const handleVolumeSlider = useCallback(
        (e: number) => {
            setSliderHold({
                dragging: true,
                scope: volumeScope,
                until: Date.now() + VOLUME_HOLD_MS,
                value: e,
            });
            sendVolume(e);
        },
        [sendVolume, volumeScope],
    );

    // The value itself was sent by the change before it - the throttle always delivers the last.
    const handleVolumeSliderEnd = useCallback(
        (e: number) => {
            setSliderHold({
                dragging: false,
                scope: volumeScope,
                until: Date.now() + VOLUME_HOLD_MS,
                value: e,
            });
        },
        [volumeScope],
    );

    const handleMute = useCallback(() => {
        mediaToggleMute();
    }, [mediaToggleMute]);

    // navi-connect: through the player context, like the hotkeys below. On this machine that is
    // the same step from the same volume as before. On a remote device it steps from the level
    // last asked for instead of a `devices` frame that has not caught up, so notches inside one
    // round trip add up rather than each repeating the first.
    const handleVolumeWheel = useCallback(
        (e: WheelEvent<HTMLButtonElement | HTMLDivElement>) => {
            if (e.deltaY > 0 || e.deltaX > 0) {
                handleVolumeDown();
            } else {
                handleVolumeUp();
            }
        },
        [handleVolumeDown, handleVolumeUp],
    );

    const handleVolumeDownThrottled = useThrottledCallback(handleVolumeDown, 100);
    const handleVolumeUpThrottled = useThrottledCallback(handleVolumeUp, 100);

    useHotkeys([
        [bindings.volumeDown.isGlobal ? '' : bindings.volumeDown.hotkey, handleVolumeDownThrottled],
        [bindings.volumeUp.isGlobal ? '' : bindings.volumeUp.hotkey, handleVolumeUpThrottled],
        [bindings.volumeMute.isGlobal ? '' : bindings.volumeMute.hotkey, handleMute],
    ]);

    const slider = (
        <CustomPlayerbarSlider
            className={styles.slider}
            max={100}
            min={0}
            onChange={handleVolumeSlider}
            onChangeEnd={handleVolumeSliderEnd}
            onClick={(e) => {
                e.stopPropagation();
            }}
            onWheel={handleVolumeWheel}
            size={6}
            value={sliderValue}
            w={volumeWidth}
        />
    );

    const icon = (
        <ContextMenu>
            <ContextMenu.Target>
                {/*
                 * ActionIcon renders a Mantine Tooltip wrapper, which does not
                 * forward the onContextMenu/ref that Radix injects via asChild to
                 * the underlying button. Wrap in a real DOM node so right-click
                 * reliably opens the menu.
                 */}
                <div style={{ alignItems: 'center', display: 'flex' }}>
                    <ActionIcon
                        icon={muted ? 'volumeMute' : volume > 50 ? 'volumeMax' : 'volumeNormal'}
                        iconProps={{
                            color: muted ? 'muted' : undefined,
                            size: 'xl',
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isFolded && !sliderOpen) setSliderOpen(true);
                            else handleMute();
                        }}
                        onWheel={handleVolumeWheel}
                        size="sm"
                        tooltip={{
                            label: muted ? t('player.muted') : volume,
                            openDelay: 0,
                        }}
                        variant="subtle"
                    />
                </div>
            </ContextMenu.Target>
            <ContextMenu.Content>
                <ContextMenu.Item
                    isSelected={!currentAudioDeviceId}
                    onSelect={() => handleSelectAudioDevice(null)}
                >
                    {t('setting.audioDeviceDefault', { defaultValue: 'System default' })}
                </ContextMenu.Item>
                {audioDevices.length > 0 && <ContextMenu.Divider />}
                {audioDevices.map((device) => (
                    <ContextMenu.Item
                        isSelected={device.value === currentAudioDeviceId}
                        key={device.value}
                        onSelect={() => handleSelectAudioDevice(device.value)}
                    >
                        {device.label || device.value}
                    </ContextMenu.Item>
                ))}
            </ContextMenu.Content>
        </ContextMenu>
    );

    if (!isFolded) {
        return (
            <>
                {icon}
                {slider}
            </>
        );
    }

    return (
        <Popover onChange={setSliderOpen} opened={sliderOpen && isFolded} position="top">
            <Popover.Target>
                <div>{icon}</div>
            </Popover.Target>
            <Popover.Dropdown onClick={(e) => e.stopPropagation()} p="sm">
                {slider}
            </Popover.Dropdown>
        </Popover>
    );
};
