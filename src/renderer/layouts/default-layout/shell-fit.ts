/**
 * Which of the shell's side panels show as their rails for a window this wide (B-207, B-198).
 *
 * The board's Narrow frame (1100 x 700) keeps the sidebar and folds the queue to its 44 px rail;
 * below 900 the sidebar folds to its collapsed rail as well. A fold is for display only: the
 * user's own choices (the sidebar's collapsed flag, the queue's open flag) are never written, so
 * widening the window brings back exactly what they had.
 *
 * Hysteresis: a panel folds below its threshold and unfolds only at threshold + HYSTERESIS, so a
 * window edge dragged across the line, or a resize that the fold itself nudges, cannot flip it back
 * and forth.
 *
 * Pure, with no imports, so `node --test` can run its harness.
 */

export interface ShellFit {
    queue: 'panel' | 'rail';
    sidebar: 'full' | 'rail';
}

export const QUEUE_RAIL_BELOW = 1180;
export const SIDEBAR_RAIL_BELOW = 900;
export const HYSTERESIS = 24;

const folds = (width: number, below: number, wasFolded: boolean): boolean =>
    wasFolded ? width < below + HYSTERESIS : width < below;

export const shellFit = ({
    previous,
    width,
}: {
    previous: null | ShellFit;
    width: number;
}): ShellFit => ({
    queue: folds(width, QUEUE_RAIL_BELOW, previous?.queue === 'rail') ? 'rail' : 'panel',
    sidebar: folds(width, SIDEBAR_RAIL_BELOW, previous?.sidebar === 'rail') ? 'rail' : 'full',
});

/** Whether two fits show the same thing (so a resize that changes nothing re-renders nothing). */
export const sameShellFit = (a: ShellFit, b: ShellFit): boolean =>
    a.queue === b.queue && a.sidebar === b.sidebar;
