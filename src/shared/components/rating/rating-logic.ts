/** The shared Rating's decisions, without React (`rating.harness.ts`). */

/** A star chosen again clears the rating; another sets it. */
export const nextRating = (chosen: number, current: null | number | undefined): number =>
    chosen === current ? 0 : chosen;

const ARROWS = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp']);

/**
 * B-259: the star an arrow key moved to, or null. Chromium moves through a radio group with an arrow
 * by checking the next input and firing a click on it; any other click (a pointer on a label or a
 * star, the click after Space) is not a move.
 */
export const arrowMoveValue = (
    target: null | { tagName?: string; type?: string; value?: string },
    lastKey: null | string,
): null | number => {
    if (!target || target.tagName !== 'INPUT' || target.type !== 'radio') return null;
    if (!lastKey || !ARROWS.has(lastKey)) return null;
    const value = Number.parseFloat(target.value ?? '');
    return Number.isFinite(value) ? value : null;
};
