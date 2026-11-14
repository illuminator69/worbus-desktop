import isElectron from 'is-electron';
import { useEffect, useRef } from 'react';

const GARBAGE_COLLECTION_INTERVAL = 1000 * 60 * 5;

/**
 * A collection and a decoded-image cache clear every 5 minutes. Q-164: no longer on every route
 * change too (upstream `22c0f8f8c`): that paused each navigation for a full collection and threw
 * away the decoded covers of the page left, decoded again on Back.
 */
export const useGarbageCollection = () => {
    const intervalIdRef = useRef<NodeJS.Timeout | null>(null);

    const startInterval = () => {
        if (intervalIdRef.current) {
            clearInterval(intervalIdRef.current);
        }

        intervalIdRef.current = setInterval(() => {
            window.api?.utils?.forceGarbageCollection?.();
        }, GARBAGE_COLLECTION_INTERVAL);
    };

    // Clear the cache on an interval
    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        startInterval();

        return () => {
            if (intervalIdRef.current) {
                clearInterval(intervalIdRef.current);
            }
        };
    }, []);
};
