/**
 * use-hub's hub-driven window: for a moment after the hub moves the player (a directive, an adopt,
 * a hard pause), the player's own events are the hub's doing, not the user's, so nothing is
 * published or claimed from them. Kept free of imports so `node --test` can run it.
 *
 * W1 review: a change made inside the window (a play order this device built because the hub's
 * did not fit its queue, a shuffle toggle a second after a `do:seek`) was swallowed with the
 * events and reached the hub only at the next track or status change, while the hub stepped the
 * old order. So the window says when it opens (`onOpen`) and, once, when it lapses (`onLapse`):
 * use-hub notes what it held at the opening and publishes at the lapse if that changed.
 */

export interface HubDrivenWindow {
    /** Shut it at once (the socket dropped): no lapse is announced. */
    close: () => void;
    /** Open it, or keep it open, for at least `ms` from now. Never shortens it. */
    hold: (ms: number) => void;
    isOpen: () => boolean;
    /** Wall-clock ms it stays open until (0: closed). */
    until: () => number;
}

export interface HubDrivenWindowDeps {
    clearTimer: (timer: unknown) => void;
    now: () => number;
    /** It closed by running out (after the last hold). */
    onLapse: () => void;
    /** A hold opened it from closed. */
    onOpen: () => void;
    setTimer: (fn: () => void, ms: number) => unknown;
}

export const createHubDrivenWindow = (deps: HubDrivenWindowDeps): HubDrivenWindow => {
    let until = 0;
    let timer: unknown = null;
    const isOpen = () => deps.now() < until;
    const stop = () => {
        if (timer !== null) deps.clearTimer(timer);
        timer = null;
    };
    const arm = () => {
        stop();
        timer = deps.setTimer(
            () => {
                timer = null;
                if (isOpen()) arm();
                else deps.onLapse();
            },
            Math.max(0, until - deps.now()),
        );
    };
    return {
        close: () => {
            until = 0;
            stop();
        },
        hold: (ms) => {
            const wasOpen = isOpen();
            until = Math.max(until, deps.now() + ms);
            if (!wasOpen) deps.onOpen();
            arm();
        },
        isOpen,
        until: () => until,
    };
};
