import { ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './clamp-fold.module.css';

import { shellPinnedTop } from '/@/renderer/components/item-list/item-table-list/utils/shell-pinned-top';
import {
    ABOUT_LINES,
    closeScroll,
    foldAt,
    foldProgress,
    halfLeading,
    LineBox,
    lineBoxes,
} from '/@/renderer/features/motion/clamp';
import { FOLD_EASING, growTarget } from '/@/renderer/features/motion/grow';
import { scrollParentOf, USER_INPUT } from '/@/renderer/features/motion/scroll-parent';
import { Icon } from '/@/shared/components/icon/icon';

/**
 * The text's glyph runs, one rect per line fragment of each text node, from the top of `el`, each
 * with its half-leading added so it spans its line box (Review M1: the cut lands between lines,
 * whatever the paragraph gaps or line heights inside the text).
 */
const glyphRuns = (el: HTMLElement): LineBox[] => {
    const origin = el.getBoundingClientRect().top;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const lineHeights = new Map<Element, string>();
    const runs: LineBox[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !node.textContent?.trim()) continue;
        let lineHeight = lineHeights.get(parent);
        if (lineHeight === undefined) {
            lineHeight = getComputedStyle(parent).lineHeight;
            lineHeights.set(parent, lineHeight);
        }
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
            if (rect.width === 0 || rect.height === 0) continue;
            const lead = halfLeading(lineHeight, rect.height);
            runs.push({ bottom: rect.bottom - origin + lead, top: rect.top - origin - lead });
        }
    }
    return runs;
};

interface ClampFoldProps {
    children: ReactNode;
    /** The text's own type, on the element whose lines are counted. */
    className?: string;
    initialOpen?: boolean;
    lines?: number;
    /** The test hook, `data-clamp`. */
    name?: string;
    onOpenChange?: (open: boolean) => void;
}

/**
 * R13 (B-243): an About text folded to whole lines, with the arrow under the cut (the artist page's,
 * now on the album page too). A text that fits shows whole, with no arrow and no reserved space. The
 * arrow, not the text, opens it; the height moves on the fold's clock (`--fold-ms`, 450 ms past
 * 240 px, `--fold-ease`, as `GrowBox`), the text stays drawn while it closes, and under reduced
 * motion the height just changes. Closing holds the page still while the arrow stays in view; when
 * it would rise past the bar, the About's top settles just under the bar with the fold (until the
 * user scrolls), so the reader sees the folded lines, not a long text's height of page below them.
 */
export const ClampFold = ({
    children,
    className,
    initialOpen = false,
    lines = ABOUT_LINES,
    name,
    onOpenChange,
}: ClampFoldProps) => {
    const { t } = useTranslation();
    const id = useId();
    const outer = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const from = useRef<null | number>(null);
    /** The arrow's screen top when a close was pressed with it in view. */
    const arrowTop = useRef<null | number>(null);
    const moving = useRef<Animation | null>(null);
    const [open, setOpen] = useState(initialOpen);
    const [cut, setCut] = useState<null | number>(null);

    // Where the fold cuts (null: the text fits), kept current as the width or the text changes.
    useLayoutEffect(() => {
        const el = inner.current;
        if (!el) return undefined;
        const measure = () => {
            const next = foldAt(lineBoxes(glyphRuns(el)), lines);
            setCut((prev) => (prev === next ? prev : next));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [lines]);

    // After a toggle: from the height drawn at the press (mid-move included) to the new one.
    useLayoutEffect(() => {
        const box = outer.current;
        const start = from.current;
        const anchor = arrowTop.current;
        from.current = null;
        arrowTop.current = null;
        if (!box || start === null) return undefined;
        const end = box.getBoundingClientRect().height;
        // Asked at the moment of the change, so a preference changed while the page is open counts.
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const { animate, ms } = growTarget(start, end, reduced);
        moving.current?.cancel();
        moving.current = null;
        let animation: Animation | null = null;
        if (animate) {
            box.setAttribute('data-moving', '');
            animation = box.animate([{ height: `${start}px` }, { height: `${end}px` }], {
                duration: ms,
                easing: FOLD_EASING,
            });
            moving.current = animation;
            const running = animation;
            running.onfinish = () => {
                if (moving.current !== running) return;
                moving.current = null;
                box.removeAttribute('data-moving');
            };
        } else {
            box.removeAttribute('data-moving');
        }
        if (anchor === null) return undefined;
        // Closing (Review M3 and its follow-up): when the arrow, rising by the shrink, would end above
        // the bar, the page scrolls so the About's top (its section, with the label) settles a panel
        // gap under the bar, spread over the fold frame by frame, until it settles or the user
        // scrolls. With the arrow staying in view, nothing moves.
        const scroller = scrollParentOf(box);
        const root = box.parentElement;
        const total = closeScroll({
            aboutTop: (root?.closest('section') ?? root ?? box).getBoundingClientRect().top,
            arrowTop: anchor,
            barBottom: shellPinnedTop(getComputedStyle(box)),
            shrink: start - end,
        });
        if (!scroller || total === 0) return undefined;
        const scrollFrom = scroller.scrollTop;
        let frame = 0;
        const hold = () => {
            const height = box.getBoundingClientRect().height;
            scroller.scrollTop = scrollFrom + total * foldProgress({ end, height, start });
            if (animation && moving.current === animation) frame = requestAnimationFrame(hold);
            else stop();
        };
        const stop = () => {
            cancelAnimationFrame(frame);
            USER_INPUT.forEach((name) => window.removeEventListener(name, stop, true));
        };
        USER_INPUT.forEach((name) =>
            window.addEventListener(name, stop, { capture: true, passive: true }),
        );
        hold();
        return stop;
    }, [open]);

    useEffect(() => () => moving.current?.cancel(), []);

    const folds = cut !== null;
    const clamped = folds && !open;

    const toggle = () => {
        if (outer.current) from.current = outer.current.getBoundingClientRect().height;
        const top = button.current?.getBoundingClientRect().top;
        arrowTop.current =
            open && top !== undefined && top >= 0 && top <= window.innerHeight ? top : null;
        const next = !open;
        setOpen(next);
        onOpenChange?.(next);
    };

    return (
        <div className={styles.clamp} data-clamp={name}>
            <div
                className={styles.box}
                data-clamp-box=""
                data-clamped={clamped ? 'true' : undefined}
                id={id}
                ref={outer}
                style={clamped ? { height: cut } : undefined}
            >
                <div className={className} ref={inner}>
                    {children}
                </div>
            </div>
            {folds && (
                <button
                    aria-controls={id}
                    aria-expanded={open}
                    aria-label={t(open ? 'common.collapse' : 'common.expand')}
                    className={styles.toggle}
                    data-clamp-toggle=""
                    data-open={open ? 'true' : 'false'}
                    onClick={toggle}
                    ref={button}
                    title={t(open ? 'common.collapse' : 'common.expand')}
                    type="button"
                >
                    <Icon icon="arrowDownS" size="lg" />
                </button>
            )}
        </div>
    );
};
