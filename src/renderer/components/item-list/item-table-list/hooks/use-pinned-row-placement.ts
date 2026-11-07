import { RefObject, useLayoutEffect } from 'react';

import { placePinnedRow } from '/@/renderer/components/item-list/item-table-list/utils/place-pinned-row';

/**
 * Keeps a pinned row (`position: fixed`) at viewport `top` across `containerRef`'s table while `active`.
 * Placed once before the first paint (a layout effect, so a newly pinned row never shows a frame at its
 * static spot), then at most once per frame on scroll, window resize, the page's arrival ending, and a
 * change in the table's own size (the queue opening or the sidebar folding resize it without a window
 * resize).
 */
export const usePinnedRowPlacement = ({
    active,
    containerRef,
    rowRef,
    top,
}: {
    active: boolean;
    containerRef: RefObject<HTMLDivElement | null>;
    rowRef: RefObject<HTMLDivElement | null>;
    top: number;
}) => {
    useLayoutEffect(() => {
        const row = rowRef.current;
        const container = containerRef.current;
        if (!active || !row || !container) return undefined;

        let frame = 0;
        const place = () => {
            frame = 0;
            try {
                placePinnedRow(row, container, top);
            } catch {
                // The row or the table left the DOM between the schedule and the frame.
            }
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(place);
        };

        place();

        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        // An arrival moves the block the row is fixed to while it runs; place it again at its end.
        window.addEventListener('animationend', schedule, true);
        const resize = new ResizeObserver(schedule);
        resize.observe(container);

        return () => {
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('animationend', schedule, true);
            resize.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [active, containerRef, rowRef, top]);
};
