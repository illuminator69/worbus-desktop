import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useRef } from 'react';

import styles from './left-sidebar.module.css';

import { ResizeHandle } from '/@/renderer/features/shared/components/resize-handle';
import { useSidebarFolded } from '/@/renderer/layouts/default-layout/use-shell-fit';
import { useAppStore } from '/@/renderer/store';
import { readMotionClock } from '/@/shared/components/animations/motion-tokens';

const CollapsedSidebar = lazy(() =>
    import('/@/renderer/features/sidebar/components/collapsed-sidebar').then((module) => ({
        default: module.CollapsedSidebar,
    })),
);

const Sidebar = lazy(() =>
    import('/@/renderer/features/sidebar/components/sidebar').then((module) => ({
        default: module.Sidebar,
    })),
);

interface LeftSidebarProps {
    isResizing: boolean;
    startResizing: (direction: 'left' | 'right', mouseEvent?: MouseEvent) => void;
}

export const LeftSidebar = ({ isResizing, startResizing }: LeftSidebarProps) => {
    const sidebarRef = useRef<HTMLDivElement | null>(null);
    // A narrow window shows the rail, for display only: the saved flag stays the user's (B-198).
    const folded = useSidebarFolded();
    const collapsed = useAppStore((state) => state.sidebar.collapsed) || folded;
    // The crossfade always runs, except under reduced motion (the plain instant swap).
    const crossfade = !useReducedMotion();
    // The crossfade runs on the grid tween's clock (--motion-duration, --motion-ease), not its own.
    const clock = readMotionClock();

    /*
     * A crossfade entry must never reuse a node that is still exiting. Keying the two states by
     * `collapsed` alone did exactly that: a resize drag flips collapsed on the way past the
     * threshold and back again on the way out, so the re-entering state was handed its OWN
     * exiting node — the exit animation kept running and settled it at opacity 0, and nothing
     * removed it afterwards because it is a present child again. That is the blank sidebar whose
     * invisible buttons still respond. Stamping each flip with a generation makes every entry a
     * fresh node that animates in from scratch, and leaves the stale one to finish and unmount.
     */
    const generationRef = useRef(0);
    const previousCollapsedRef = useRef(collapsed);

    if (previousCollapsedRef.current !== collapsed) {
        previousCollapsedRef.current = collapsed;
        generationRef.current += 1;
    }

    const content = (
        <Suspense fallback={<></>}>{collapsed ? <CollapsedSidebar /> : <Sidebar />}</Suspense>
    );

    return (
        <aside className={styles.container} id="sidebar">
            {/*
             * Crossfade the full sidebar and the collapsed icon rail when minimizing so the content
             * morph isn't a hard snap (the width itself already tweens via the grid). Both states
             * are stacked (absolute) and fade across each other. Reduced motion: the plain instant
             * swap. The resize handle renders last so it stays on top/draggable.
             */}
            {crossfade ? (
                <AnimatePresence initial={false}>
                    <motion.div
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, pointerEvents: 'none' }}
                        initial={{ opacity: 0 }}
                        key={`${collapsed ? 'collapsed' : 'expanded'}-${generationRef.current}`}
                        style={{ inset: 0, position: 'absolute' }}
                        transition={{ duration: clock.ms / 1000, ease: clock.ease }}
                    >
                        {content}
                    </motion.div>
                </AnimatePresence>
            ) : (
                content
            )}
            {!folded && (
                <ResizeHandle
                    isResizing={isResizing}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        startResizing('left');
                    }}
                    placement="right"
                    ref={sidebarRef}
                />
            )}
        </aside>
    );
};
