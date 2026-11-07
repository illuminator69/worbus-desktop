import { ReactNode, useEffect, useRef } from 'react';

import styles from './fold.module.css';

interface FoldProps {
    children: ReactNode;
    /** The test hook, `data-fold`. */
    name?: string;
    open: boolean;
    /** A tall section folds over 450 ms instead of 300. */
    tall?: boolean;
}

/**
 * A section that folds open and closed (design brief 8): its row track eases 0fr to 1fr, the opacity
 * eases in 220 ms, and its content is clipped while closed or moving and unclipped once open and still.
 * The content stays mounted while closed, so nothing inside refetches.
 */
export const Fold = ({ children, name, open, tall }: FoldProps) => {
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        // Transition events bubble from descendants and fire per property: only the fold's own height counts.
        const ours = (e: TransitionEvent) =>
            e.target === e.currentTarget && e.propertyName === 'grid-template-rows';
        const onRun = (e: TransitionEvent) => {
            if (ours(e)) el.setAttribute('data-moving', '');
        };
        const onEnd = (e: TransitionEvent) => {
            if (ours(e)) el.removeAttribute('data-moving');
        };
        el.addEventListener('transitionrun', onRun);
        el.addEventListener('transitionend', onEnd);
        el.addEventListener('transitioncancel', onEnd);
        return () => {
            el.removeEventListener('transitionrun', onRun);
            el.removeEventListener('transitionend', onEnd);
            el.removeEventListener('transitioncancel', onEnd);
        };
    }, []);

    return (
        <div
            className={styles.fold}
            data-fold={name}
            data-open={open ? 'true' : 'false'}
            data-tall={tall ? 'true' : undefined}
            ref={ref}
        >
            <div aria-hidden={!open} className={styles.inner} inert={!open}>
                {children}
            </div>
        </div>
    );
};
