/**
 * use-hub's hub-driven window: for a moment after the hub moves the player (a directive, an adopt,
 * a hard pause), the player's own events are the hub's doing, not the user's, so nothing is
 * published or claimed from them. Kept free of imports so `node --test` can run it.
 */

export interface HubDrivenWindow {
    /** Shut it at once (the socket dropped). */
    close: () => void;
    /** Open it, or keep it open, for at least `ms` from now. Never shortens it. */
    hold: (ms: number) => void;
    isOpen: () => boolean;
    /** Wall-clock ms it stays open until (0: closed). */
    until: () => number;
}

export const createHubDrivenWindow = (deps: { now: () => number }): HubDrivenWindow => {
    let until = 0;
    return {
        close: () => {
            until = 0;
        },
        hold: (ms) => {
            until = Math.max(until, deps.now() + ms);
        },
        isOpen: () => deps.now() < until,
        until: () => until,
    };
};
