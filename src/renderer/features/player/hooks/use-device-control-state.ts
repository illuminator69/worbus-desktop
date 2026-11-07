import isElectron from 'is-electron';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    ArrivalDevice,
    createArrivalTracker,
} from '/@/renderer/features/hub/utils/device-arrivals';
import {
    DeviceControlState,
    deviceControlState,
} from '/@/renderer/features/player/utils/device-control-state';
import {
    useHubActiveDeviceId,
    useHubActiveDeviceName,
    useHubConnected,
    useHubDevices,
    useHubIsRemoteActive,
    useHubMyDeviceId,
    useHubSettings,
    usePlayerSong,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';

const hasHub = Boolean(isElectron() && window.api.hub);

/**
 * What the player bar's device control shows (device-control-state.ts), with the "just
 * connected" device from the hub's `devices` snapshots (device-arrivals.ts). One tracker per
 * control. A disconnect resets it, so the welcome that follows is a baseline and proposes nothing.
 */
export function useDeviceControlState(pickerOpen: boolean): {
    dismiss(id: string): void;
    state: DeviceControlState;
} {
    const settings = useHubSettings();
    const connected = useHubConnected();
    const devices = useHubDevices();
    const activeId = useHubActiveDeviceId();
    const myId = useHubMyDeviceId();
    const remoteActive = useHubIsRemoteActive();
    const remoteName = useHubActiveDeviceName();
    const localHasSong = Boolean(usePlayerSong());

    const [tracker] = useState(createArrivalTracker);
    const [arrival, setArrival] = useState<ArrivalDevice | null>(null);
    // Bumped when the proposal must be read again without a store change (expiry, dismiss).
    const [tick, setTick] = useState(0);

    const hiddenIds = useMemo(
        () => new Set(settings.hiddenDeviceIds ?? []),
        [settings.hiddenDeviceIds],
    );

    // Declared before the effect that reads the proposal, so it runs first on the same commit.
    // The other reasons a connected device is not offered, logged with it so a missing pill can
    // be read from the app log. Kept in a ref: they must not re-run the observe below.
    const why = useRef({ activeId, hiddenIds, localHasSong, myId });
    why.current = { activeId, hiddenIds, localHasSong, myId };

    useEffect(() => {
        if (!connected) {
            tracker.reset();
            return;
        }
        for (const device of tracker.observe(devices, Date.now())) {
            const w = why.current;
            logger.info('[hub] device connected', {
                hidden: w.hiddenIds.has(device.id),
                id: device.id,
                isActive: device.id === w.activeId,
                localHasSong: w.localHasSong,
                name: device.name,
                reachable: device.reachable ?? null,
            });
        }
    }, [connected, devices, tracker]);

    useEffect(() => {
        const now = Date.now();
        const next = tracker.proposal(now, { activeId, hiddenIds, myId });
        setArrival((prev) => (prev?.id === next?.id && prev?.name === next?.name ? prev : next));
        const expiresAt = next ? tracker.expiresAt(next.id) : null;
        if (expiresAt === null) return undefined;
        const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, expiresAt - now) + 1);
        return () => clearTimeout(timer);
    }, [activeId, connected, devices, hiddenIds, myId, tick, tracker]);

    const dismiss = useCallback(
        (id: string) => {
            tracker.dismiss(id);
            setTick((n) => n + 1);
        },
        [tracker],
    );

    const state = deviceControlState({
        arrival,
        connected,
        hubEnabled: hasHub && settings.enabled,
        localHasSong,
        pickerOpen,
        remoteActive,
        remoteName,
    });

    return { dismiss, state };
}
