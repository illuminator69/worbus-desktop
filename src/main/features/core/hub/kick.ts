// navi-connect: what a kick does. Pure, so the decision can be tested without Electron or a
// socket (kick.harness.ts); the hub client (index.ts) carries it out.
//
// The client reconnects on a backoff that reaches 30 s and finds a dead socket by a 10 s
// heartbeat. Both suit a hub that is down, and neither suits the two moments when the link is
// known to have just changed - the machine woke, the network came back - where the client could
// sit disconnected for most of a minute. A kick is "look now".

/** Kicks arrive in bursts (a wake fires `resume` and `online` together): one attempt per this. */
export const KICK_FLOOR_MS = 2000;

/**
 * - `connect`: nothing is connected or connecting (the backoff is being waited out) - connect now.
 * - `replace`: a handshake is in flight - abandon it for a fresh one.
 * - `probe`: the socket is open - ask it, and drop it only if it does not answer.
 * - `none`: not meant to run, kicked a moment ago, or a socket already on its way out (its
 *   close reconnects).
 */
export type KickAction = 'connect' | 'none' | 'probe' | 'replace';

export interface KickState {
    /** The current socket's `readyState` (0 CONNECTING, 1 OPEN, 2 CLOSING); undefined without one. */
    readyState: number | undefined;
    /** Meant to be connected: switched on, and not refused by the hub. */
    shouldRun: boolean;
    /** Wall-clock ms since the last kick that did something. */
    sinceLastKick: number;
}

/**
 * B-421: a page that subscribes to the hub stream asks for a fresh welcome (`hub-resync`, once
 * per page load). The renderer learns that it is connected - and the session, the devices and
 * lb-bot - only from a `welcome`, and the main process's socket outlives a renderer reload
 * (Ctrl+R, Vite's full reload): the settings the new page pushes are the old ones, nothing
 * restarts, and the hub state stayed gone until the socket happened to drop (9+ minutes).
 *
 * Replaying the welcome main saw is not an answer: the session has moved since, and the command
 * echo (I-031) is reset on both sides only by a new connection - a page reset to `applied` 0 on a
 * socket whose hub expects a higher seq has every report it sends disbelieved. So the socket is
 * replaced, which is also the truth for the hub: a reloaded page's player starts paused.
 *
 * - `reconnect`: the open socket's welcome went to a page before this one;
 * - `none`: not meant to run, or the welcome is still to come (connecting, waiting out the
 *   backoff, closing, or open and not yet welcomed) and reaches this page as it is.
 */
export type ResyncAction = 'none' | 'reconnect';

export interface ResyncState {
    /** The current socket's `readyState` (0 CONNECTING, 1 OPEN, 2 CLOSING); undefined without one. */
    readyState: number | undefined;
    /** Meant to be connected: switched on, and not refused by the hub. */
    shouldRun: boolean;
    /** A `welcome` has been forwarded to a page on the current socket. */
    welcomed: boolean;
}

export function kickAction({ readyState, shouldRun, sinceLastKick }: KickState): KickAction {
    if (!shouldRun) return 'none';
    // Wall clock on purpose: a monotonic one may not count the time asleep, and the kick after a
    // long sleep must not look like the second of a burst. A clock set back (negative) is no burst.
    if (sinceLastKick >= 0 && sinceLastKick < KICK_FLOOR_MS) return 'none';
    switch (readyState) {
        case 0:
            return 'replace';
        case 1:
            return 'probe';
        case undefined:
            return 'connect';
        default:
            return 'none';
    }
}

export function resyncAction({ readyState, shouldRun, welcomed }: ResyncState): ResyncAction {
    if (!shouldRun) return 'none';
    return readyState === 1 && welcomed ? 'reconnect' : 'none';
}

/** How long a resync waits for the old socket's close before terminating it (review L5). */
export const RESYNC_CLOSE_WAIT_MS = 2000;

/** The bit of a WebSocket `afterClose` uses. */
export interface ClosingSocket {
    close(): void;
    once(event: 'close', listener: () => void): unknown;
    terminate(): void;
}

/**
 * Review L5: close `socket` and run `then` once it has closed - or, if no close comes within
 * `waitMs`, terminate it and run `then` anyway. A resync's new socket must not say hello before
 * the old one's close reaches the hub: the hub's disconnect skips a socket that is no longer the
 * device's (`dev.ws is not ws`), so the device would stay active and "playing" under a reloaded,
 * paused page.
 */
export function afterClose(socket: ClosingSocket, waitMs: number, then: () => void): void {
    let done = false;
    const go = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        then();
    };
    const timer = setTimeout(() => {
        try {
            socket.terminate();
        } catch {
            /* ignore */
        }
        go();
    }, waitMs);
    socket.once('close', go);
    try {
        socket.close();
    } catch {
        go();
    }
}
