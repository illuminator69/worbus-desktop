/**
 * Which way a page arrives (design brief 8): a push slides in from the right, a back from the left,
 * anything else only fades. React Router's history index says which way a POP went. Pure, for the harness.
 */

export type NavDirection = 'back' | 'forward' | 'none';
export type NavType = 'POP' | 'PUSH' | 'REPLACE';

export const PAGE_SLIDE_PX = 18;
export const PAGE_MS = 220;

export const navDirection = (
    type: NavType,
    prevIdx: null | number,
    nextIdx: null | number,
): NavDirection => {
    if (prevIdx === null || nextIdx === null) return 'none';
    if (type === 'PUSH') return 'forward';
    if (type === 'POP') {
        if (nextIdx < prevIdx) return 'back';
        if (nextIdx > prevIdx) return 'forward';
    }
    return 'none';
};

export const pageOffsetPx = (direction: NavDirection): number =>
    direction === 'forward' ? PAGE_SLIDE_PX : direction === 'back' ? -PAGE_SLIDE_PX : 0;
