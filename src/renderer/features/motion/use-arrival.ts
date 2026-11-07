import { useReducedMotion } from 'motion/react';
import { CSSProperties, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import styles from './arrival.module.css';

import {
    arrivalFor,
    type ArrivalWindow,
    openArrival,
} from '/@/shared/components/animations/arrival';
import {
    arrivedEntries,
    mayArrive,
    settleVisit,
} from '/@/shared/components/animations/arrived-entries';

export type ArrivalProps = { className: string; 'data-arrive': string; style: CSSProperties };

/**
 * One arrival window per mounted list: it opens on the first render where `ready` is true and closes
 * 900 ms later, so items that mount afterwards (a page flip, a scroll, a refetch) never animate.
 * `propsFor(index)` answers for the moment it is called (it is itself stable): a list of memoised
 * children computes it once per change of the list (useMemo), not on every render. Nothing under
 * reduced motion. A new `key` (F6: the Library's settled search term) starts a new window, so each
 * answer arrives once.
 *
 * A history entry arrives once (R4): React Router remounts a page on Back, so the pair (location.key,
 * key) is recorded, and a mount that finds its pair already recorded leaves its window closed for
 * good. Lists that share a key on one page (Home's shelves) still all arrive on the first visit: see
 * `hold` in arrived-entries. The record is written in an effect, never in render, and it follows
 * `location.key`: once a mount has decided (it opened a window, or it was skipped) every new entry
 * under the mounted page is marked too (a replace writes the URL without remounting), so Back to it
 * shows it at rest. Only a mount that opened a window holds its pair. `{ once: false }` opts a list
 * out of the record: a gesture in place (a mood chosen on Home) is not a remount from history, so it
 * arrives every time it opens, as before R4.
 */
export const useArrival = (ready: boolean, key?: string, options?: { once?: boolean }) => {
    const once = options?.once ?? true;
    const reduced = useReducedMotion();
    const entry = useLocation().key;
    const listKey = key ?? '';
    const windowRef = useRef<ArrivalWindow>({ openedAt: null });
    // Whether this mount opened a window, and whether it found its pair already arrived (decided = either).
    const openedRef = useRef(false);
    const skippedRef = useRef(false);
    const keyRef = useRef(key);
    if (keyRef.current !== key) {
        keyRef.current = key;
        windowRef.current = { openedAt: null };
        openedRef.current = false;
        skippedRef.current = false;
    }
    if (ready && windowRef.current.openedAt === null && !skippedRef.current) {
        if (mayArrive(arrivedEntries, entry, listKey, once)) {
            // The window is the time the list first rendered with content: reading the clock here is the
            // point, and openArrival never moves a window once it is open, so a re-render gives the same answer.
            // eslint-disable-next-line react-hooks/purity
            windowRef.current = openArrival(windowRef.current, performance.now(), ready);
            openedRef.current = true;
        } else {
            skippedRef.current = true;
        }
    }

    const opened = openedRef.current;
    const decided = opened || skippedRef.current;
    useEffect(() => {
        if (!decided) return;
        return settleVisit(arrivedEntries, entry, listKey, opened, once);
    }, [decided, opened, entry, listKey, once]);

    const propsFor = useCallback(
        (index: number): ArrivalProps | undefined => {
            if (reduced) return undefined;
            const arrival = arrivalFor(windowRef.current, performance.now(), index);
            if (!arrival) return undefined;
            return {
                className: styles.arrive,
                'data-arrive': '',
                style: { '--arrive-delay': `${arrival.delayMs}ms` } as CSSProperties,
            };
        },
        [reduced],
    );

    return { propsFor };
};
