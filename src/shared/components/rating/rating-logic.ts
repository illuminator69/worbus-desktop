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

interface RatingNow {
    busy: boolean;
    onChange?: (value: number) => void;
    value: null | number | undefined;
}

/**
 * The stage 2 review's m1: a change made while a rating save is in flight is held, not dropped, and
 * sent once the save settles (only the latest; a star chosen again clears against the value then).
 */
export const createRatingGate = () => {
    let held: null | { rating: number; toggles: boolean } = null;
    const send = (rating: number, toggles: boolean, now: RatingNow) => {
        now.onChange?.(toggles ? nextRating(rating, now.value) : rating);
    };
    return {
        /** A change: sent now, or held while a save is in flight. */
        offer(rating: number, toggles: boolean, now: RatingNow) {
            if (!now.onChange) return;
            if (now.busy) {
                held = { rating, toggles };
                return;
            }
            held = null;
            send(rating, toggles, now);
        },
        /** The save state moved: send the held change once nothing is in flight. */
        settle(now: RatingNow) {
            if (now.busy || !held) return;
            const { rating, toggles } = held;
            held = null;
            send(rating, toggles, now);
        },
    };
};
