// R14 (B-250): what showing or hiding the side queue does, for every control that does it (the
// rail, the open panel's own hide button, the player bar's queue icon and its shortcut). Pure
// (queue-panel-toggle.harness.ts), so the controls cannot come to disagree.
//
// A wide window keeps the panel in the grid, and the toggle flips the user's saved flag. A narrow
// window folds the queue (B-207): it opens over the page, and the toggle flips that overlay only,
// leaving the saved flag as the user set it.

export interface QueuePanelMove {
    open: boolean;
    target: 'grid' | 'overlay';
}

export const queuePanelToggle = (state: {
    folded: boolean;
    overlayOpen: boolean;
    rightExpanded: boolean;
}): QueuePanelMove =>
    state.folded
        ? { open: !state.overlayOpen, target: 'overlay' }
        : { open: !state.rightExpanded, target: 'grid' };
