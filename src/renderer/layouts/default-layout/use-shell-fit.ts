import { useEffect } from 'react';
import { create } from 'zustand';

import { sameShellFit, ShellFit, shellFit } from '/@/renderer/layouts/default-layout/shell-fit';

/**
 * The shell's fit for the window's width (B-207, B-198), shared by the panels that fold.
 *
 * Not persisted and never written into the user's settings: a fold renders the queue panel or the
 * sidebar as its rail while the window is narrow, and the user's own flags (`sidebar.collapsed`,
 * `sidebar.rightExpanded`) stay as they were, so widening the window restores them exactly.
 *
 * `queueOverlay` is the queue opened over the page while it is folded: the bar's queue button and
 * the rail open it, Escape or a click outside closes it, and it never touches the saved flag.
 */
interface ShellFitSlice {
    fit: ShellFit;
    queueOverlay: boolean;
    setFit: (fit: ShellFit) => void;
    setQueueOverlay: (open: boolean) => void;
}

const initialWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;

const useShellFitStore = create<ShellFitSlice>()((set, get) => ({
    // Measured at load, so a narrow window opens folded instead of tweening into the fold.
    fit: shellFit({ previous: null, width: initialWidth }),
    queueOverlay: false,
    setFit: (fit) => {
        if (sameShellFit(get().fit, fit)) return;
        // Unfolded, the queue is the panel again: an overlay left open would have nothing to be.
        set(fit.queue === 'panel' ? { fit, queueOverlay: false } : { fit });
    },
    setQueueOverlay: (queueOverlay) => set({ queueOverlay }),
}));

/** The current fit. */
export const useShellFit = (): ShellFit => useShellFitStore((state) => state.fit);

/** Whether the sidebar shows as its rail because the window is narrow (not the user's flag). */
export const useSidebarFolded = (): boolean =>
    useShellFitStore((state) => state.fit.sidebar === 'rail');

export const useQueueOverlayOpen = (): boolean => useShellFitStore((state) => state.queueOverlay);

export const useSetQueueOverlay = () => useShellFitStore((state) => state.setQueueOverlay);

/**
 * Follows the window's width, once per frame at most. Mounted once, by the shell (MainContent).
 */
export const useShellFitTracker = () => {
    useEffect(() => {
        let frame = 0;
        const measure = () => {
            frame = 0;
            const { fit, setFit } = useShellFitStore.getState();
            setFit(shellFit({ previous: fit, width: window.innerWidth }));
        };
        const onResize = () => {
            if (frame) return;
            frame = requestAnimationFrame(measure);
        };
        measure();
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);
};
