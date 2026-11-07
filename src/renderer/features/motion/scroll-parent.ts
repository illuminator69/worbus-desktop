/** The nearest ancestor that scrolls vertically and has something to scroll. */
export const scrollParentOf = (el: HTMLElement | null): HTMLElement | null => {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight
        ) {
            return node;
        }
    }
    return null;
};

/** A press, a wheel, a touch or a key: the user's scroll wins over a scroll the app is making. */
export const USER_INPUT = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const;
