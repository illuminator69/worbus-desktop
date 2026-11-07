import clsx from 'clsx';
import { useEffect, useState } from 'react';

import styles from './device-rows-list.module.css';

import {
    deviceIcon,
    deviceStatus,
    deviceStatusLabel,
    rowTakesVolume,
    sortDeviceRows,
} from '/@/renderer/features/hub/utils/device-rows';
import { deviceVolumePinned, sendAct } from '/@/renderer/features/hub/utils/remote-queue';
import {
    SliderHold,
    sliderHoldRemaining,
    VOLUME_HOLD_MS,
} from '/@/renderer/features/hub/utils/volume-hold';
import { CustomPlayerbarSlider } from '/@/renderer/features/player/components/playerbar-slider';
import { usePreviewCastBlocked } from '/@/renderer/features/preview/hooks/use-preview-cast-guard';
import {
    HubDevice,
    isHubDeviceTransferable,
    useHubActiveDeviceId,
    useHubDevices,
    useHubMyDeviceId,
    useHubRemoteIsPlaying,
    useHubSettings,
    useHubStore,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Icon } from '/@/shared/components/icon/icon';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { useThrottledCallback } from '/@/shared/hooks/use-throttled-callback';

const platformLabel = (platform: string): string => {
    switch (platform) {
        case 'android':
            return 'Android';
        case 'chromecast':
            return 'Cast';
        case 'desktop':
            return 'Desktop';
        default:
            return platform ? platform[0].toUpperCase() + platform.slice(1) : 'Device';
    }
};

/**
 * The volume of a device that is not playing, under its row (I-033): the level can be set
 * before music is sent there. Drawn as the app draws a volume everywhere else, an icon and the
 * playerbar's slider.
 *
 * It commits on release: one `act:volume` naming the device as `target`, which the hub passes
 * on as `do:setVolume` and records on the row. Between the release and that answer the thumb
 * must not go back to the level the row still shows. Against a hub that acknowledges acts the
 * release pins the level for this device until its ack (act-pins.ts), and what is shown is
 * the pin, then the row - which by then says what the device took, or the old level when the
 * hub refused (use-hub raises the toast). The slider's own hold covers the drag, and a hub
 * that acknowledges nothing: there it stands until the row says the level asked for, 2.5 s at
 * most (volume-hold.ts).
 */
const DeviceVolume = ({ device }: { device: HubDevice }) => {
    const pinned = useHubStore((s) => deviceVolumePinned(device.id, s));
    const observed = pinned ?? device.volume ?? 100;
    const [dragged, setDragged] = useState<null | number>(null);
    const [hold, setHold] = useState<null | SliderHold>(null);
    // A release is one act. An arrow key held down on the thumb is a release per repeat, so
    // those are thinned to one per 100 ms, the last always sent - as the bar's slider sends.
    const commit = useThrottledCallback(
        (asked: number) => sendAct('volume', { level: asked, target: device.id }),
        100,
    );

    useEffect(() => {
        if (!hold) return undefined;
        const left = sliderHoldRemaining(hold, device.id, observed, Date.now());
        if (left === 0) {
            setHold(null);
            return undefined;
        }
        const timer = setTimeout(() => setHold(null), left);
        return () => clearTimeout(timer);
    }, [device.id, hold, observed]);

    const level = dragged ?? hold?.value ?? observed;

    return (
        // Arrow keys on the thumb belong to the slider, not to the list's own keys.
        <div className={styles.volume} onKeyDown={(e) => e.stopPropagation()}>
            <Icon
                color="muted"
                icon={level === 0 ? 'volumeMute' : level > 50 ? 'volumeMax' : 'volumeNormal'}
            />
            <CustomPlayerbarSlider
                max={100}
                min={0}
                onChange={setDragged}
                onChangeEnd={(value) => {
                    const asked = Math.round(value);
                    commit(asked);
                    setDragged(null);
                    setHold({
                        dragging: false,
                        scope: device.id,
                        until: Date.now() + VOLUME_HOLD_MS,
                        value: asked,
                    });
                }}
                onClick={(e) => e.stopPropagation()}
                size={6}
                value={level}
            />
        </div>
    );
};

/**
 * The hub's devices, for the bar's device box (device-control.tsx). A row transfers playback to
 * its device (the hub resumes it from the same spot). Each row shows an icon for what the device
 * is, its name, platform and status, so two clients are distinguishable; the icon, the order of
 * the rows, the status and whether a row carries a volume slider are decided in device-rows.ts.
 * Offline devices auto-hide and manually-hidden ones are tucked behind a toggle.
 *
 * Rows have THREE states, not two. `online` means a socket claiming that id is attached - for a
 * Chromecast that is the bridging client's socket, which says nothing about the speaker. A
 * speaker that is off, asleep, or on a network nobody here is on stays `online` and used to be
 * offered as a perfectly good target; the transfer then committed and every device showed a
 * playing bar over silence. So an unreachable device is shown (it is real, and it will come
 * back) but greyed and not selectable - see PROTOCOL §3.2.
 */
export const DeviceRowsList = () => {
    const settings = useHubSettings();
    const devices = useHubDevices();
    const activeId = useHubActiveDeviceId();
    const myId = useHubMyDeviceId();
    const remoteIsPlaying = useHubRemoteIsPlaying();
    const features = useHubStore((s) => s.features);
    const { setSettings } = useSettingsStoreActions();
    const [showExtra, setShowExtra] = useState(false);
    // navi-connect: non-null while the queue holds a preview the speaker could not fetch. Cast
    // rows are then shown, disabled, with the reason - the same grammar an unreachable device
    // already uses.
    const previewBlocked = usePreviewCastBlocked();

    const hidden = new Set(settings.hiddenDeviceIds ?? []);

    const isCastTarget = (device: HubDevice) => device.platform === 'chromecast';

    // No `play` flag: the hub preserves the current play/pause state. A hub that acknowledges
    // acts answers this one when the handoff is committed or refused, and use-hub toasts a
    // refusal from that ack - it reaches this client only, not every device.
    const transfer = (id: string) => {
        sendAct('transfer', { target: id });
    };

    const setDeviceHidden = (id: string, hide: boolean) => {
        const next = new Set(settings.hiddenDeviceIds ?? []);
        if (hide) next.add(id);
        else next.delete(id);
        setSettings({ hub: { hiddenDeviceIds: Array.from(next) } });
    };

    const session = { activeDeviceId: activeId, isPlaying: remoteIsPlaying, myDeviceId: myId };

    // Visible by default = online AND not manually hidden. Offline (auto-hidden) and
    // manually-hidden devices live behind the "Show offline & hidden" toggle. Each list in the
    // picker's order: the playing device, this one, the rest by name.
    const visible = sortDeviceRows(
        devices.filter((d) => d.online && !hidden.has(d.id)),
        session,
    );
    const extra = sortDeviceRows(
        devices.filter((d) => !d.online || hidden.has(d.id)),
        session,
    );

    const renderRow = (device: HubDevice) => {
        const castBlocked = Boolean(previewBlocked) && isCastTarget(device);
        const status = deviceStatus(device, session, castBlocked);
        const statusText = status === 'blocked' ? 'no preview support' : deviceStatusLabel(status);
        const isHidden = hidden.has(device.id);
        return (
            // The hide/unhide control is a SIBLING of the row's button, not its child: a disabled
            // button disables everything inside it, which left offline and already-hidden devices
            // permanently un-unhideable. The volume slider is a sibling for the other reason:
            // inside the button, a drag would end as the click that transfers playback.
            <div className={styles.row} key={device.id}>
                <div className={styles.rowMain}>
                    <button
                        className={styles.rowButton}
                        data-active={device.id === activeId || undefined}
                        data-device-row
                        disabled={
                            !isHubDeviceTransferable(device) ||
                            device.id === activeId ||
                            castBlocked
                        }
                        onClick={(e) => {
                            e.stopPropagation();
                            transfer(device.id);
                        }}
                        type="button"
                    >
                        <Icon icon={deviceIcon(device.kind)} />
                        <span className={styles.name} title={device.name}>
                            {device.name}
                        </span>
                        <Text className={styles.meta} isMuted size="xs">
                            {platformLabel(device.platform)} · {statusText}
                        </Text>
                    </button>
                    <ActionIcon
                        aria-label={`${isHidden ? 'Unhide' : 'Hide'} ${device.name}`}
                        icon={isHidden ? 'visibility' : 'visibilityOff'}
                        // A filled glyph: without a fill it draws nothing.
                        iconProps={{ fill: 'muted', size: 'sm' }}
                        onClick={(e) => {
                            e.stopPropagation();
                            setDeviceHidden(device.id, !isHidden);
                        }}
                        size="xs"
                        tooltip={{ label: isHidden ? 'Unhide' : 'Hide', openDelay: 0 }}
                        variant="subtle"
                    />
                </div>
                {rowTakesVolume(device, session, features) && <DeviceVolume device={device} />}
            </div>
        );
    };

    return (
        <div className={styles.list}>
            {visible.length === 0 && (
                <Text className={styles.note} isMuted size="sm">
                    No devices found
                </Text>
            )}
            {visible.map(renderRow)}
            {/* A disabled row explains nothing on its own and a tooltip on one never fires, so
                the reason goes in the list itself - once, not per row. */}
            {previewBlocked && visible.some(isCastTarget) && (
                <button
                    className={styles.rowButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        toast.show({ message: previewBlocked });
                    }}
                    type="button"
                >
                    <Text isMuted size="xs">
                        {previewBlocked}
                    </Text>
                </button>
            )}
            {extra.length > 0 && (
                <>
                    <div className={styles.divider} />
                    <button
                        aria-expanded={showExtra}
                        className={styles.rowButton}
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowExtra((v) => !v);
                        }}
                        type="button"
                    >
                        {showExtra ? 'Hide' : 'Show'} offline & hidden ({extra.length})
                    </button>
                    {/* Folds open as the device box does. */}
                    <div
                        className={clsx(styles.fold, showExtra && styles.foldOpen)}
                        inert={!showExtra}
                    >
                        <div className={styles.foldInner}>{extra.map(renderRow)}</div>
                    </div>
                </>
            )}
        </div>
    );
};
