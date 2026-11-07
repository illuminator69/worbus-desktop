import clsx from 'clsx';
import {
    type ComponentPropsWithoutRef,
    type MouseEvent,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import styles from './sideways-row.module.css';
import {
    hiddenSides,
    scrollStep,
    type SidewaysWheel,
    sidewaysWheelTarget,
} from './sideways-scroll';

import { ActionIcon } from '/@/shared/components/action-icon/action-icon';

type FrameProps = ComponentPropsWithoutRef<'div'> & {
    [attribute: `data-${string}`]: boolean | string | undefined;
};

type SidewaysRowProps = ComponentPropsWithoutRef<'div'> & {
    /** The scrolling element's tag: `nav` for the Library's sections. */
    as?: 'div' | 'nav';
    /**
     * For the frame, the row's outermost element: what a parent's layout addresses as its child
     * (the Library head's short-window rule), and spacing below the row.
     */
    frameProps?: FrameProps;
    /** Whether a plain vertical wheel scrolls the row (`sideways-scroll.ts`). */
    wheel: SidewaysWheel;
};

const keepFocus = (event: MouseEvent) => event.preventDefault();

const behavior = (): ScrollBehavior =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/**
 * B-285: one line of chips that scrolls sideways with no scrollbar, the one mechanism every such
 * row uses. A side with hidden content fades out at its edge and, under the pointer or with keyboard
 * focus in the row, shows a chevron button that moves the row most of a width that way; a side with
 * nothing hidden shows neither, so a row that fits looks like a plain row. On a row in fixed chrome
 * (`wheel="chrome"`) a vertical mouse wheel scrolls it sideways until it reaches that end, then
 * goes on to the page; a row in a scrolling page leaves the plain wheel to the page. A touchpad's
 * sideways swipe and Shift+wheel are the browser's own on both. Focus moving to a hidden chip
 * scrolls it into view natively, clear of the buttons (`scroll-padding-inline`).
 *
 * The props other than `as`, `frameProps` and `wheel` go to the scrolling element, which holds the
 * chips. Layout is read on a scroll, a resize and a chip coming or going, never on a render alone
 * (the queue's station row re-renders while a track plays).
 */
export const SidewaysRow = ({
    as: Tag = 'div',
    children,
    className,
    frameProps,
    wheel,
    ...props
}: SidewaysRowProps) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const [sides, setSides] = useState({ end: false, start: false });
    // Where a glide in progress is heading, so quick notches and presses add up; cleared at its end.
    const goingTo = useRef<null | number>(null);

    const measure = () => {
        const row = ref.current;
        if (!row) return;
        const next = hiddenSides(row);
        setSides((previous) =>
            previous.start === next.start && previous.end === next.end ? previous : next,
        );
    };

    const glideTo = (left: number) => {
        const row = ref.current;
        if (!row || left === row.scrollLeft) return;
        const how = behavior();
        goingTo.current = how === 'smooth' ? left : null;
        row.scrollTo({ behavior: how, left });
    };

    // Before the first paint, so a row that does not fit shows its fade from the start.
    useLayoutEffect(() => {
        const row = ref.current;
        if (!row) return undefined;
        const onScroll = () => measure();
        const onScrollEnd = () => {
            goingTo.current = null;
            measure();
        };
        row.addEventListener('scroll', onScroll, { passive: true });
        row.addEventListener('scrollend', onScrollEnd);
        // The row resizing (a window, the queue docking) and a chip resizing (a label arriving).
        const resize = new ResizeObserver(() => measure());
        resize.observe(row);
        for (const chip of Array.from(row.children)) resize.observe(chip);
        // Chips coming and going (a section switched on, Home's clear chip): a new one is
        // observed for its size, a removed one let go.
        const mutation = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of Array.from(record.removedNodes)) {
                    if (node instanceof Element) resize.unobserve(node);
                }
                for (const node of Array.from(record.addedNodes)) {
                    if (node instanceof Element) resize.observe(node);
                }
            }
            measure();
        });
        mutation.observe(row, { childList: true });
        measure();
        return () => {
            row.removeEventListener('scroll', onScroll);
            row.removeEventListener('scrollend', onScrollEnd);
            resize.disconnect();
            mutation.disconnect();
        };
    }, []);

    useEffect(() => {
        const row = ref.current;
        if (!row || wheel !== 'chrome') return undefined;
        const onWheel = (event: WheelEvent) => {
            const left = sidewaysWheelTarget(row, event, wheel, goingTo.current ?? row.scrollLeft);
            if (left === null) return;
            event.preventDefault();
            glideTo(left);
        };
        // Not passive: a wheel the row takes must not also scroll the page.
        row.addEventListener('wheel', onWheel, { passive: false });
        return () => row.removeEventListener('wheel', onWheel);
    }, [wheel]);

    const press = (direction: -1 | 1) => {
        const row = ref.current;
        if (row) glideTo(scrollStep(row, direction, goingTo.current ?? row.scrollLeft));
    };

    return (
        <div
            {...frameProps}
            className={clsx(styles.frame, frameProps?.className)}
            data-end={sides.end || undefined}
            data-start={sides.start || undefined}
        >
            <Tag {...props} className={clsx(styles.scroller, className)} ref={ref}>
                {children}
            </Tag>
            {/* Pointer buttons: Tab moves through the chips themselves, each scrolled into view. A
                press leaves focus where it was, and only keyboard focus holds them up, so they do
                not stay up after the pointer leaves, a chip click included. */}
            <ActionIcon
                aria-label={t('action.scrollLeft')}
                className={styles.button}
                data-side="start"
                icon="arrowLeftS"
                inert={!sides.start}
                onClick={() => press(-1)}
                onMouseDown={keepFocus}
                radius="xl"
                size="xs"
                tabIndex={-1}
                variant="default"
            />
            <ActionIcon
                aria-label={t('action.scrollRight')}
                className={styles.button}
                data-side="end"
                icon="arrowRightS"
                inert={!sides.end}
                onClick={() => press(1)}
                onMouseDown={keepFocus}
                radius="xl"
                size="xs"
                tabIndex={-1}
                variant="default"
            />
        </div>
    );
};
