import { useMemo } from 'react';
import { useLocation } from 'react-router';

import { entryKeyFor, mintEntryKey } from '/@/renderer/store/scroll.store';

/**
 * B-315: the key this history entry keeps its scroll offset and chip under: the router's own, or,
 * for an entry the router did not key (a hash change, `location.replace`, a session's first entry),
 * one stamped into the entry's history state, which the router reads back on POP.
 */
export const useEntryKey = (): string => {
    const location = useLocation();
    return useMemo(
        () => entryKeyFor(location.key, window.history, mintEntryKey),
        // A new location object is a new entry (or the same entry re-read): ask again.

        [location],
    );
};
