/**
 * R12 (B-236): the lb-bot boxes keep their top in view after a change that shrinks them. Pressing
 * Request swaps the tall sources view for the short active one while the page keeps its scroll, so
 * the box's top could land under the sticky bar with the title, the source and the progress hidden.
 * Pure, for the harness; `useKeepTopInView` measures and moves.
 */

/** Below this many pixels above the line the top counts as on it (subpixel layout). */
const ON_THE_LINE_PX = 1;

/**
 * The scroll delta (added to the scroller's `scrollTop`, so negative: up) that puts `boxTop` at
 * `barBottom + gap`, all viewport pixels; null when the top is already at or below that line, so a box
 * in view never moves.
 *
 * Also null when no part of the box showed below the bar just before the change (`seenBelowBar`):
 * lb-bot ends a fill minutes after the press, often while the user is down the tracklist, and a box
 * they scrolled away from is never pulled back (review F1; "the user's own scroll is never fought").
 */
export const scrollToKeepTop = ({
    barBottom,
    boxTop,
    gap,
    seenBelowBar,
}: {
    barBottom: number;
    boxTop: number;
    gap: number;
    seenBelowBar: boolean;
}): null | number => {
    if (!seenBelowBar) return null;
    const delta = boxTop - (barBottom + gap);
    return delta < -ON_THE_LINE_PX ? Math.round(delta) : null;
};

/**
 * The gaps box's view changes (`gapStageFamily`) that shrink the box: Request or the auto pick turns
 * the sources into the transfer, the transfer ends (done, cancelled back to the line, failed, waiting
 * on lb-bot), and the result row goes. The ends are lb-bot's, not the user's, so they act only while
 * the user is looking at the box (`seenBelowBar`). The first read landing or the user opening
 * something never moves the page.
 */
export const gapBoxShrinks = (prev: string, next: string): boolean =>
    (prev === 'sources' && next === 'active') ||
    (prev === 'active' &&
        (next === 'done' || next === 'fold' || next === 'failed' || next === 'attention')) ||
    (prev === 'done' && (next === 'fold' || next === 'absent'));

/** The missing album's box as `albumBoxKey` names it: `none`, `sources`, or `fill-<stage>`. */
export const albumBoxKey = (view: 'fill' | 'none' | 'sources', stage: string): string =>
    view === 'fill' ? `fill-${stage === 'syncing' ? 'active' : stage}` : view;

/**
 * The missing album's box: Download turns the cards into the steps, the fill ends (in the library,
 * failed, cancelled), and its card goes.
 */
export const albumBoxShrinks = (prev: string, next: string): boolean =>
    (prev === 'sources' && next === 'fill-active') ||
    (prev === 'fill-active' && next.startsWith('fill-') && next !== 'fill-active') ||
    (prev.startsWith('fill-') && prev !== 'fill-active' && next === 'none');
