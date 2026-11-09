/**
 * navi-connect: what a load's acknowledgement waits for (PROTOCOL §7.1, use-hub's
 * awaitLoadOutcome), out of the hook so a harness can check it (B-111). Pure.
 *
 * `loaded {ok:true}` must mean playback was established, not that the player's API was called:
 *   playing -> the target track is current AND the engine clock is advancing
 *   paused  -> the target track is current, the player is not playing, and the position sits at
 *              the requested offset (the seek landed)
 *
 * The expectation is not fixed at the load. Directives that come after it are applied while it
 * waits (directive-runner.ts), and each one moves what "established" means: a pause pressed
 * during a transfer that asked to play leaves a player that is rightly not playing, and a check
 * still waiting for the clock to run would answer `ok:false` and have the hub roll the transfer
 * back. So a later directive re-aims it (`reaimLoad`); `clear` closes it with what it had reached
 * (`closeLoad`).
 */
export interface LoadExpectation {
    /** The row the load must reach. */
    index: number;
    /** A later play or pause set the play state: the load's own failure must not touch it. */
    overridden: boolean;
    /** The offset, in seconds, a paused load must sit at. */
    sec: number;
    /** Set when the load was closed early (closeLoad): its answer. */
    verdict: LoadVerdict | null;
    wantPause: boolean;
}

export type LoadVerdict = { error?: string; ok: boolean };

/** What the player shows now. `rowIndex` is the store's index mapped to a queue row (shuffle). */
export interface PlayerLook {
    playing: boolean;
    positionSec: number;
    /** The engine clock is advancing (playhead-run.ts). */
    rolling: boolean;
    rowIndex: number;
    storeIndex: number;
}

export const PAUSED_POSITION_SLACK_SEC = 3;

export const expectLoad = (index: number, sec: number, wantPause: boolean): LoadExpectation => ({
    index,
    overridden: false,
    sec,
    verdict: null,
    wantPause,
});

/** Has the load been established? `onTarget` says which way it is still short, for the error. */
export const loadProven = (
    exp: LoadExpectation,
    look: PlayerLook,
): { ok: false; onTarget: boolean } | { ok: true } => {
    // The hub's index is a row of the queue, and with shuffle on the store's index is a position
    // in the shuffled order: either counts (I-031).
    const onTarget = look.storeIndex === exp.index || look.rowIndex === exp.index;
    if (onTarget) {
        // B-053: a lone seek step is not proof that the engine started.
        if (!exp.wantPause && look.rolling) return { ok: true };
        if (
            exp.wantPause &&
            !look.playing &&
            Math.abs(look.positionSec - exp.sec) <= PAUSED_POSITION_SLACK_SEC
        ) {
            return { ok: true };
        }
    }
    return { ok: false, onTarget };
};

/** A directive applied while the load waits. `queueChanged`'s new row comes from its handler. */
export const reaimLoad = (
    exp: LoadExpectation,
    directive: { cmd?: unknown; index?: unknown; positionMs?: unknown },
): void => {
    switch (directive.cmd) {
        case 'jump':
            exp.index = Number(directive.index) || 0;
            exp.sec = 0;
            break;
        case 'pause':
            exp.wantPause = true;
            exp.overridden = true;
            break;
        case 'play':
            exp.wantPause = false;
            exp.overridden = true;
            break;
        case 'seek':
            exp.sec = (Number(directive.positionMs) || 0) / 1000;
            break;
        default:
            break;
    }
};

/** `clear`: the queue goes, so the load is answered with what it had reached just before. */
export const closeLoad = (exp: LoadExpectation, look: PlayerLook): void => {
    const proven = loadProven(exp, look);
    exp.overridden = true;
    exp.verdict = proven.ok
        ? { ok: true }
        : { error: 'the queue was cleared before playback started', ok: false };
};

/**
 * The position a report carries (B-111). While a load waits for its outcome the player is still
 * being positioned: setQueue's restore seek and the armed seek land 100-150 ms after the new
 * track, and until then the timestamp store holds the outgoing track's offset, or 0. Since a pause
 * applied mid-load ends before the load and lets the hub accept the report after it, that offset
 * would be stored for the new track. So while a load waits, a report says where the load is
 * putting the player (its `sec`, re-aimed by any later seek or jump); once it has ended, the
 * player's own position (`playerMs`).
 */
export const reportedPositionMs = (exp: LoadExpectation | null, playerMs: number): number =>
    exp ? Math.round(exp.sec * 1000) : playerMs;

/**
 * How a load's wait ended, for use-hub's `later`: what the hub is told (`loaded`), and whether the
 * report that follows the directive's end is sent (`exit`, do-echo.ts). `refuse`: the load could
 * not start and nothing later set the play state, so use-hub refuses it (failedLoadExit).
 */
export type LoadEnding =
    | { exit: 'echo' | 'silent'; kind: 'answered'; ok: boolean }
    | { exit: 'echo' | 'silent'; kind: 'superseded' }
    | { kind: 'refuse' };

export const loadEnding = (
    outcome: LoadVerdict,
    exp: Pick<LoadExpectation, 'overridden'>,
): LoadEnding => {
    // A superseded load has no standing to answer: a newer directive owns the player, and the
    // hub has already cancelled this attempt's waiter. Nor to report: a release that superseded it
    // has said its last word (`released`), and a newer load reports when it ends.
    if (outcome.error === 'superseded') return { exit: 'silent', kind: 'superseded' };
    if (outcome.ok) return { exit: 'echo', kind: 'answered', ok: true };
    // A later play or pause set the play state: say so, touch nothing.
    if (exp.overridden) return { exit: 'silent', kind: 'answered', ok: false };
    return { kind: 'refuse' };
};
