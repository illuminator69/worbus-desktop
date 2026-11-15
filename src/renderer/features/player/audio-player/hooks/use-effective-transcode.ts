import isElectron from 'is-electron';
import { useEffect, useState } from 'react';

import { effectiveTranscode } from '/@/renderer/features/player/audio-player/hooks/effective-transcode';
import { TranscodingConfig, usePlaybackSettings } from '/@/renderer/store';

interface NetworkInformationLike {
    addEventListener?: (type: 'change', listener: () => void) => void;
    effectiveType?: string;
    removeEventListener?: (type: 'change', listener: () => void) => void;
    saveData?: boolean;
    type?: string;
}

const getConnection = (): NetworkInformationLike | undefined =>
    (navigator as Navigator & { connection?: NetworkInformationLike }).connection;

const detectMetered = (): boolean => {
    const connection = getConnection();
    if (!connection) return false;
    return (
        connection.saveData === true ||
        connection.type === 'cellular' ||
        ['2g', '3g', 'slow-2g'].includes(connection.effectiveType ?? '')
    );
};

/**
 * Best-effort metered/constrained connection detection via the Network
 * Information API (cellular type, OS data-saver, slow effective type).
 * Falls back to "not metered" when the platform exposes nothing.
 */
export const useIsMeteredConnection = (): boolean => {
    const [metered, setMetered] = useState(detectMetered);

    useEffect(() => {
        const connection = getConnection();
        if (!connection?.addEventListener) return undefined;
        const handler = () => setMetered(detectMetered());
        connection.addEventListener('change', handler);
        return () => connection.removeEventListener?.('change', handler);
    }, []);

    return metered;
};

/** The effective transcode profile (see `effectiveTranscode`) for the player engines. */
export const useEffectiveTranscode = (): TranscodingConfig => {
    const { transcode } = usePlaybackSettings();
    const isMetered = useIsMeteredConnection();
    return effectiveTranscode(transcode, { isDesktop: isElectron(), isMetered });
};
