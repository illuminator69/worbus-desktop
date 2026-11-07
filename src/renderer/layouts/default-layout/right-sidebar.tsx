import clsx from 'clsx';
import { forwardRef, Ref, useEffect } from 'react';

import styles from './right-sidebar.module.css';

import { SidebarPlayQueue } from '/@/renderer/features/now-playing/components/sidebar-play-queue';
import {
    useQueueOverlayVisible,
    useRightSidebarVisible,
} from '/@/renderer/features/now-playing/hooks/use-right-sidebar-visible';
import { ResizeHandle } from '/@/renderer/features/shared/components/resize-handle';
import { useSetQueueOverlay } from '/@/renderer/layouts/default-layout/use-shell-fit';
import { useSideQueueLayout } from '/@/renderer/store';

// const queueDrawerVariants: Variants = {
//     closed: (windowBarStyle) => ({
//         height:
//             windowBarStyle === Platform.WINDOWS || Platform.MACOS
//                 ? 'calc(100vh - 205px)'
//                 : 'calc(100vh - 175px)',
//         position: 'absolute',
//         right: 0,
//         top: '75px',
//         transition: {
//             duration: 0.4,
//             ease: 'anticipate',
//         },
//         width: '450px',
//         x: '50vw',
//     }),
//     open: (windowBarStyle) => ({
//         boxShadow: '0px 0px 10px 0px rgba(0, 0, 0, 0.8)',
//         height:
//             windowBarStyle === Platform.WINDOWS || Platform.MACOS
//                 ? 'calc(100vh - 205px)'
//                 : 'calc(100vh - 175px)',
//         position: 'absolute',
//         right: '20px',
//         top: '75px',
//         transition: {
//             damping: 10,
//             delay: 0,
//             duration: 0.4,
//             ease: 'anticipate',
//             mass: 0.5,
//         },
//         width: '450px',
//         x: 0,
//         zIndex: 120,
//     }),
// };

interface RightSidebarProps {
    isResizing: boolean;
    startResizing: (direction: 'left' | 'right' | 'top', mouseEvent?: MouseEvent) => void;
}

export const RightSidebar = forwardRef(
    (
        { isResizing: isResizingRight, startResizing }: RightSidebarProps,
        ref: Ref<HTMLDivElement>,
    ) => {
        const sideQueueLayout = useSideQueueLayout();
        const isVerticalLayout = sideQueueLayout === 'vertical';
        const showRightSidebar = useRightSidebarVisible();
        const showOverlay = useQueueOverlayVisible();
        useOverlayDismiss(showOverlay);

        return (
            <>
                {(showRightSidebar || showOverlay) && (
                    <aside
                        className={clsx(styles.rightSidebarContainer, {
                            [styles.overlay]: showOverlay,
                            [styles.verticalLayout]: isVerticalLayout,
                        })}
                        id="sidebar-queue"
                        key="queue-sidebar"
                    >
                        <ResizeHandle
                            isResizing={isResizingRight}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                startResizing(isVerticalLayout ? 'top' : 'right', e.nativeEvent);
                            }}
                            placement={isVerticalLayout ? 'top' : 'left'}
                            ref={ref}
                        />
                        <SidebarPlayQueue />
                    </aside>
                )}
            </>
        );
    },
);

/**
 * Elements whose clicks leave the overlay alone: itself, the rail and the bar's queue button toggle
 * it, and the player bar (it sits inside the layout, and skipping a track should not close the
 * queue that shows it).
 */
const OVERLAY_KEEPERS = '#sidebar-queue, #queue-rail, [data-queue-toggle], #player-bar';

/**
 * The folded queue opened over the page closes with Escape or a click elsewhere in the window.
 * Only clicks inside the app's own layout count: menus, modals and tooltips render in portals
 * outside it, so acting in a queue row's context menu does not close the queue under it. A click,
 * not a pointerdown: a drag from the page (a track dropped into the queue) starts with a
 * pointerdown and, being a native drag, ends with no click, so the overlay stays for the drop.
 */
const useOverlayDismiss = (open: boolean) => {
    const setQueueOverlay = useSetQueueOverlay();

    useEffect(() => {
        if (!open) return;

        const insideLayout = (target: EventTarget | null) =>
            target instanceof Element && target.closest('#default-layout') !== null;

        const onClick = (event: MouseEvent) => {
            const { target } = event;
            if (!insideLayout(target) || (target as Element).closest(OVERLAY_KEEPERS)) return;
            setQueueOverlay(false);
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            // Escape in a portal (a menu, a modal) belongs to it.
            if (event.target !== document.body && !insideLayout(event.target)) return;
            setQueueOverlay(false);
        };

        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, setQueueOverlay]);
};
