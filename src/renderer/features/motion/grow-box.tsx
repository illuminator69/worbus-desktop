import clsx from 'clsx';
import { ReactNode, useLayoutEffect, useRef } from 'react';

import styles from './grow-box.module.css';

import { FOLD_EASING, growTarget } from '/@/renderer/features/motion/grow';

/** A `Fold` inside the box is moving: its own transition carries the height (R13, B-244). */
const foldMoving = (content: HTMLElement): boolean =>
    content
        .getAnimations({ subtree: true })
        .some(
            (animation) =>
                animation instanceof CSSTransition &&
                animation.transitionProperty === 'grid-template-rows' &&
                animation.playState === 'running',
        );

/**
 * A box that follows its content's height (the request box, brief 8): a step with more lines grows in
 * 300 ms, 450 ms when the change is tall, easing (.3, .7, .2, 1); it clips only while moving, the rows
 * below move with it rather than jumping, and it never takes focus. Under reduced motion the height
 * just changes.
 *
 * R13 (B-244): `className` draws the box's surface on the element that moves, so the visible edge
 * moves with the rows below instead of jumping to the new size at the first frame. A `Fold` opening
 * or closing inside is followed frame by frame (no second tween chasing it, which lagged and then
 * caught up in one jump at the end).
 */
export const GrowBox = ({
    children,
    className,
    name,
}: {
    children: ReactNode;
    className?: string;
    name?: string;
}) => {
    const outer = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const last = useRef(0);

    useLayoutEffect(() => {
        const box = outer.current;
        const content = inner.current;
        if (!box || !content) return undefined;
        let moving: Animation | null = null;
        const observer = new ResizeObserver(() => {
            const next = content.offsetHeight;
            const prev = last.current;
            last.current = next;
            // Asked at the moment of the change, so a preference changed while the page is open counts.
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const { animate, ms } = foldMoving(content)
                ? { animate: false, ms: 0 }
                : growTarget(prev, next, reduced);
            // From wherever the box is drawn now (the last height, or mid-move), to the new content
            // height. The Web Animations API, not a CSS transition: a height set from inside a resize
            // observer did not register as a transition's start here.
            const from = moving ? box.getBoundingClientRect().height : prev;
            moving?.cancel();
            moving = null;
            if (!animate) {
                box.removeAttribute('data-moving');
                return;
            }
            box.setAttribute('data-moving', '');
            const animation = box.animate([{ height: `${from}px` }, { height: `${next}px` }], {
                duration: ms,
                easing: FOLD_EASING,
            });
            moving = animation;
            animation.onfinish = () => {
                if (moving !== animation) return;
                moving = null;
                box.removeAttribute('data-moving');
            };
        });
        observer.observe(content);
        return () => {
            observer.disconnect();
            moving?.cancel();
        };
    }, []);

    return (
        <div className={clsx(styles.box, className)} data-grow={name} ref={outer}>
            <div ref={inner}>{children}</div>
        </div>
    );
};
