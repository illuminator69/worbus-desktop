/**
 * navi-connect F7: a box that follows its content's height (the request box). The durations are
 * `--fold-ms` and `--fold-ms-tall` in global.css; "tall" is this plan's rule, a change of more than
 * GROW_TALL_PX (`Fold` takes `tall` by hand and has no threshold to reuse).
 */

export const GROW_MS = 300;
export const GROW_MS_TALL = 450;
export const GROW_TALL_PX = 240;
/** `--fold-ease`, as the Web Animations API takes it. */
export const FOLD_EASING = 'cubic-bezier(0.3, 0.7, 0.2, 1)';

export const growMs = (heightPx: number): number =>
    heightPx > GROW_TALL_PX ? GROW_MS_TALL : GROW_MS;

/** No animation when nothing changed, on the first measure (`prev` 0), or under reduced motion. */
export const growTarget = (
    prev: number,
    next: number,
    reducedMotion: boolean,
): { animate: boolean; ms: number } => {
    if (prev === next || prev === 0 || reducedMotion) return { animate: false, ms: 0 };
    return { animate: true, ms: growMs(Math.max(prev, next)) };
};
