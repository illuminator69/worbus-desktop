import { animate } from 'motion/react';
import { RefObject, useEffect, useLayoutEffect, useRef } from 'react';

import { shellPinnedTop } from '/@/renderer/components/item-list/item-table-list/utils/shell-pinned-top';
import { scrollToKeepTop } from '/@/renderer/features/lbbot/keep-top';
import { afterMotion } from '/@/renderer/features/motion/after-motion';
import { PANEL_GAP_PX } from '/@/renderer/features/motion/clamp';
import { scrollParentOf, USER_INPUT } from '/@/renderer/features/motion/scroll-parent';
import { readMotionClock } from '/@/shared/components/animations/motion-tokens';

/**
 * R12 (B-236): when `view` changes in a way `shrinks` names, and the box's top is then above the line
 * under the sticky bar, the page scrolls once so the top sits just under the bar. The line is the
 * bar's real bottom from the shell's variables (`shellPinnedTop`, the one R9's pinned table rows sit
 * under). The move uses the shell's tween (`readMotionClock`), is instant under reduced motion, and
 * stops at the user's first wheel, touch, press or key; nothing happens on any later scroll.
 *
 * Only while the user is looking at the box: an observer keeps whether any part of it showed below
 * the bar, and a change that comes while it did not (a fill lb-bot ends minutes after the press,
 * with the user down the tracklist) moves nothing (review F1).
 *
 * A layout effect: whether the box was in view is read when the new view is in the DOM, before it
 * paints. The move itself waits for the box's motion to settle (R13, B-244: its `GrowBox` and folds),
 * so the page scrolls once the box has its final size; an input during the wait cancels it too.
 */
export const useKeepTopInView = (
    ref: RefObject<HTMLElement | null>,
    view: string,
    shrinks: (prev: string, next: string) => boolean,
) => {
    const last = useRef(view);
    const seenBelowBar = useRef(false);
    // Whether any part of the box shows below the bar's bottom, kept current by the browser. Set up
    // again after each view change (cheap), so a box that mounted late is watched too; the layout
    // effect below reads the value from before the change, since an observer reports after paint.
    useEffect(() => {
        const box = ref.current;
        if (!box || typeof IntersectionObserver === 'undefined') return undefined;
        const barBottom = Math.round(shellPinnedTop(getComputedStyle(box)));
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[entries.length - 1];
                if (entry) seenBelowBar.current = entry.isIntersecting;
            },
            { rootMargin: `${-barBottom}px 0px 0px 0px` },
        );
        observer.observe(box);
        return () => observer.disconnect();
    }, [ref, view]);
    useLayoutEffect(() => {
        const prev = last.current;
        last.current = view;
        const box = ref.current;
        if (prev === view || !box || !shrinks(prev, view)) return undefined;
        const scroller = scrollParentOf(box);
        if (!scroller) return undefined;
        // Read now, before the change paints: the box was in view (or not) before the change.
        const seen = seenBelowBar.current;
        let controls: null | ReturnType<typeof animate> = null;
        let cancelSettle = () => {};
        const stop = () => {
            cancelSettle();
            controls?.stop();
            USER_INPUT.forEach((name) => window.removeEventListener(name, stop, true));
        };
        USER_INPUT.forEach((name) =>
            window.addEventListener(name, stop, { capture: true, passive: true }),
        );
        // R13 (B-244): after the box's motion settles, so the scroll starts from its final size.
        cancelSettle = afterMotion(box, () => {
            const delta = scrollToKeepTop({
                barBottom: shellPinnedTop(getComputedStyle(box)),
                boxTop: box.getBoundingClientRect().top,
                gap: PANEL_GAP_PX,
                seenBelowBar: seen,
            });
            if (delta === null) {
                stop();
                return;
            }
            const from = scroller.scrollTop;
            const to = Math.max(0, from + delta);
            // Asked at the moment of the move, so a preference changed while the page is open counts.
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                scroller.scrollTop = to;
                stop();
                return;
            }
            const clock = readMotionClock();
            controls = animate(from, to, {
                duration: clock.ms / 1000,
                ease: clock.ease,
                onUpdate: (top) => {
                    scroller.scrollTop = top;
                },
            });
            void controls.then(stop);
        });
        return stop;
    }, [ref, shrinks, view]);
};
