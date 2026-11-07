import clsx from 'clsx';
import { useInView } from 'motion/react';
import { AnimatePresence, motion, Variants } from 'motion/react';
import { CSSProperties, memo, ReactNode, RefObject, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import styles from './page-header.module.css';

import { useLibraryFrame } from '/@/renderer/features/library/hooks/use-library-frame';
import {
    BAR_FADE_SPAN,
    headerBarLine,
    headerBarProgress,
} from '/@/renderer/features/shared/components/header-bar-progress';
import { LibraryBackgroundOverlay } from '/@/renderer/features/shared/components/library-background-overlay';
import { setWashOrigin, WashUnderlay } from '/@/renderer/features/shared/components/wash-underlay';
import { useShouldPadTitlebar } from '/@/renderer/hooks';
import { useWindowSettings } from '/@/renderer/store/settings.store';
import { Flex, FlexProps } from '/@/shared/components/flex/flex';
import { Platform } from '/@/shared/types/types';

export interface PageHeaderProps extends Omit<
    FlexProps,
    'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'
> {
    animated?: boolean;
    backgroundColor?: string;
    /**
     * With `fadeWithTitle`: the hero's own band (the element the page draws behind the hero, laid out
     * against the hero), drawn again in the bar over the page's wash, so at full opacity the bar has the
     * colour the hero had at that spot. Without it the bar draws `backgroundColor` as other pages do.
     */
    band?: ReactNode;
    children?: ReactNode;
    /**
     * The album and artist pages: the bar fades in with the scroll as the hero's title (`target`'s
     * `[data-hero-title]`) passes under it, instead of appearing past a pixel offset.
     */
    fadeWithTitle?: boolean;
    height?: string;
    isHidden?: boolean;
    position?: string;
    scrollContainerRef?: RefObject<HTMLDivElement | null>;
    target?: RefObject<HTMLElement | null>;
}

const variants: Variants = {
    animate: {
        opacity: 1,
        transition: {
            duration: 0.3,
            ease: 'easeIn',
        },
    },
    exit: { opacity: 0 },
    initial: { opacity: 0 },
};

const BasePageHeader = ({
    animated,
    backgroundColor,
    band,
    children,
    fadeWithTitle,
    height,
    isHidden,
    position,
    scrollContainerRef,
    target,
    ...props
}: PageHeaderProps) => {
    const ref = useRef(null);
    const padRight = useShouldPadTitlebar();
    const { windowBarStyle } = useWindowSettings();

    const isInView = useInView({
        current: target?.current || null,
    });

    useEffect(() => {
        if (fadeWithTitle) return undefined;
        const headerElement = ref.current as HTMLElement | null;
        const scrollContainer = scrollContainerRef?.current;

        if (!scrollContainerRef) {
            if (headerElement) {
                headerElement.setAttribute('data-visible', isHidden ? 'false' : 'true');
            }
            return undefined;
        }

        if (!scrollContainer || !headerElement) {
            if (headerElement) {
                headerElement.setAttribute('data-visible', 'false');
            }
            return undefined;
        }

        const updateVisibility = () => {
            const dataScrolled = scrollContainer.getAttribute('data-scrolled');
            const isScrolled = dataScrolled === 'true';
            const shouldShow = isScrolled && !isInView;

            if (shouldShow) {
                headerElement.setAttribute('data-visible', 'true');
            } else {
                headerElement.setAttribute('data-visible', 'false');
            }
        };

        updateVisibility();

        const observer = new MutationObserver(updateVisibility);
        observer.observe(scrollContainer, {
            attributeFilter: ['data-scrolled'],
            attributes: true,
        });

        return () => observer.disconnect();
    }, [fadeWithTitle, isInView, scrollContainerRef, isHidden]);

    // The scroll-linked fade: one read of two rects per frame at most, written to a CSS variable on
    // the bar, never to React state (the R7 frame budget). Reduced motion makes the span 0, a step.
    useEffect(() => {
        if (!fadeWithTitle) return undefined;
        const bar = ref.current as HTMLElement | null;
        const host = scrollContainerRef?.current;
        if (!bar || !host) return undefined;

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
        let frame = 0;

        const update = () => {
            frame = 0;
            const hero = target?.current;
            const title = hero?.querySelector<HTMLElement>('[data-hero-title]') ?? hero;
            // The host's own viewport (OverlayScrollbars puts it first among the host's children),
            // never one nested inside the page.
            const scroller =
                host.querySelector<HTMLElement>(':scope > [data-overlayscrollbars-viewport]') ??
                host;
            const barRect = bar.getBoundingClientRect();
            setWashOrigin(bar, barRect.left, barRect.top);
            let progress = 0;
            // At the top of the page the bar never shows, whatever the title's geometry.
            if (title && scroller.scrollTop > 0) {
                const span = reduce.matches ? 0 : BAR_FADE_SPAN;
                const titleBottom = title.getBoundingClientRect().bottom;
                const barBottom = headerBarLine({
                    barBottom: barRect.bottom,
                    restTitleBottom: titleBottom + scroller.scrollTop,
                    span,
                });
                progress = headerBarProgress({ barBottom, span, titleBottom });
            }
            bar.style.setProperty('--bar-progress', String(progress));
            bar.setAttribute('data-visible', progress >= 1 ? 'true' : 'false');
            bar.toggleAttribute('data-fading', progress > 0 && progress < 1);
        };

        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };

        // Capture: the scroll happens on OverlayScrollbars' viewport inside the host, and scroll does
        // not bubble. A restored scroll position (Back) arrives as a scroll too, so it lands in the
        // state that position implies, with no fade on arrival.
        host.addEventListener('scroll', schedule, { capture: true, passive: true });
        window.addEventListener('resize', schedule);
        // The page's arrival moves the bar while it runs: its wash copy lines up again at the end.
        window.addEventListener('animationend', schedule, true);
        reduce.addEventListener('change', schedule);
        // The queue opening or the sidebar folding resizes the page, and can rewrap the hero's title,
        // with no window resize.
        const resize = new ResizeObserver(schedule);
        resize.observe(host);
        if (target?.current) resize.observe(target.current);
        schedule();

        return () => {
            host.removeEventListener('scroll', schedule, { capture: true });
            window.removeEventListener('resize', schedule);
            window.removeEventListener('animationend', schedule, true);
            reduce.removeEventListener('change', schedule);
            resize.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [fadeWithTitle, scrollContainerRef, target]);

    return (
        <>
            <Flex
                className={clsx(styles.container, { [styles.fade]: fadeWithTitle })}
                data-visible="false"
                ref={ref}
                style={{ height, position: position as CSSProperties['position'] }}
                {...props}
            >
                <div
                    className={clsx(styles.header, {
                        [styles.hidden]: isHidden,
                        [styles.isDraggable]: windowBarStyle === Platform.WEB,
                        [styles.padRight]: padRight,
                    })}
                >
                    <AnimatePresence initial={animated ?? false}>
                        <motion.div
                            animate="animate"
                            className={styles.titleWrapper}
                            exit="exit"
                            initial="initial"
                            variants={variants}
                        >
                            {children}
                        </motion.div>
                    </AnimatePresence>
                </div>
                {/* The title-linked bar is the hero's top continued: the page under it (the card over
                    the wash), then the hero's own band, so at full opacity it has the colour the hero
                    had at that spot (B-216). */}
                {fadeWithTitle && <WashUnderlay />}
                {fadeWithTitle && band
                    ? band
                    : backgroundColor && (
                          <LibraryBackgroundOverlay
                              background={backgroundColor}
                              headerRef={ref}
                              tail={64}
                          />
                      )}
            </Flex>
        </>
    );
};

/**
 * Inside the Library frame a page's header row is the frame's title row: its children (play button,
 * count, list search, the page's own buttons) are drawn in the frame's slot and nothing else is.
 */
const FramedPageHeader = (props: PageHeaderProps) => {
    const { inFrame, slot } = useLibraryFrame();
    if (inFrame) return slot ? createPortal(props.children, slot) : null;
    return <BasePageHeader {...props} />;
};

export const PageHeader = memo(FramedPageHeader);

PageHeader.displayName = 'PageHeader';
