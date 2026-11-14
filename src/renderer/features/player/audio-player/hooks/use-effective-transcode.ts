import isElectron from 'is-electron';
import { useEffect, useState } from 'react';

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

/**
 * The transcode profile the player engines should actually use: same as the
 * stored config, except that with `meteredOnly` set, transcoding only kicks in
 * while the connection is metered (full quality otherwise).
 */
export const useEffectiveTranscode = (): TranscodingConfig => {
    const { transcode } = usePlaybackSettings();
    const isMetered = useIsMeteredConnection();

    // B-321: not offered on the desktop (its network API reports no metered connection), so a
    // switch left on from before is ignored rather than holding transcoding off.
    if (!transcode.meteredOnly || isElectron()) return transcode;
    return { ...transcode, enabled: transcode.enabled && isMetered };
};
