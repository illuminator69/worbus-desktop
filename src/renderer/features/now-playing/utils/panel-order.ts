export type SidebarPanel = 'lyrics' | 'queue' | 'visualizer';

/**
 * The saved panel order after moving lyrics or the visualiser up or down (R6, B-207), or null when
 * there is no move. The queue's place is not the order's any more (with the queue in the panel, the
 * other two sit in the strip at its bottom), so a move only swaps lyrics and the visualiser, and only
 * when both are in the order.
 */
export const movePanel = (
    order: readonly SidebarPanel[],
    panel: 'lyrics' | 'visualizer',
    direction: 'down' | 'up',
): null | SidebarPanel[] => {
    const other = panel === 'lyrics' ? 'visualizer' : 'lyrics';
    const at = order.indexOf(panel);
    const otherAt = order.indexOf(other);
    if (at < 0 || otherAt < 0) return null;
    if (direction === 'up' ? at < otherAt : at > otherAt) return null;
    const next = [...order];
    next[at] = other;
    next[otherAt] = panel;
    return next;
};
