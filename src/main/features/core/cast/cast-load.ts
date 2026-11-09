/**
 * The cast bridge's load procedure, out of index.ts so a harness can replay it against a fake
 * speaker (B-106). Pure: the speaker, the session builder and the hub socket come in as `deps`.
 *
 * A load: get a receiver (`ensureCast`), send LOAD, wait for its answer; if that fails, drop the
 * session, breathe, build a fresh one and LOAD once more.
 *
 * PROTOCOL §7.2 asks three things of a receiver, and each is a piece of state here, not a timer
 * tuned to the hub's:
 *   - **An answer inside the budget.** A transfer's `do:load` carries `timeoutMs`, the hub's own
 *     deadline (LOAD_TIMEOUT), measured from dispatch. The answer it is owed (`PendingAnswer`) is
 *     given `ok:false` at that budget less ACK_RESERVE_MS if the speaker has not started by then.
 *   - **An abandoned attempt cannot start playback.** Each load is an `Attempt` that can end: at
 *     that deadline, on `do:release`, or replaced by a newer load. Every wait inside it (the session
 *     build, the LOAD's answer, the breath before the retry) stops at its end, so nothing more is
 *     sent; and a LOAD already out that the speaker takes afterwards is paused at once, unless a
 *     newer load has gone out since (that one is what the speaker plays next).
 *   - **The id.** `loaded` echoes the directive's `transferId`, and the hello advertises
 *     `transferAckV2` (cast-hello.ts), so the hub matches the answer to the transfer it belongs to
 *     and not to whichever is pending on this speaker.
 * The answer belongs to the transfer, not to the LOAD that serves it: a jump the user presses while
 * a transfer's LOAD is out replaces that LOAD, and its outcome answers the transfer.
 */

/** The speaker's answer to one LOAD: no error means it took the media. */
export type LoadAnswer = (err?: Error | null) => void;

export interface CastLoadDeps<P> {
    /** A live receiver session, building one if needed (index.ts `ensureCast`). */
    ensureCast: () => Promise<P>;
    log: (level: 'error' | 'warn', message: string) => void;
    /** Pause what a LOAD the bridge no longer wanted started on `player`. */
    pauseLanded: (player: P) => void;
    /** The `loaded` frame to the hub (PROTOCOL §7.1-7.2). */
    sendLoaded: (frame: { error?: string; ok: boolean; t: 'loaded'; transferId?: string }) => void;
    /** Drop the receiver session (index.ts `teardownCast`). */
    teardown: () => void;
}

/** Sends LOAD for the current track to `player`; `answer` is called once the speaker replies. */
export type SendLoad<P> = (player: P, answer: LoadAnswer) => void;

/** How a load ended: the speaker took it, it could not, or nobody wants its answer any more. */
export type LoadResult = 'abandoned' | 'failed' | 'ok';

export const LOAD_ANSWER_MS = 10_000;
export const RETRY_BREATHE_MS = 1200;
/** Time kept back from the hub's budget for the answer's own trip (as the renderer's). */
export const ACK_RESERVE_MS = 1500;

export interface CastLoader<P> {
    /** A load of the hub's `do:load`; answers it with `loaded`. `null`: nothing to load. */
    hubLoad: (
        directive: { timeoutMs?: unknown; transferId?: unknown },
        sendLoad: null | SendLoad<P>,
    ) => Promise<LoadResult>;
    /** A load this bridge starts itself (a jump, a reload after a failed seek or play). */
    reload: (sendLoad: SendLoad<P>) => Promise<LoadResult>;
    /** `do:release`: the session is leaving this speaker. */
    release: () => void;
}

type EndReason = 'deadline' | 'released' | 'replaced';

interface Attempt {
    ended: EndReason | null;
    /** Called once when it ends; each wait inside the attempt registers one. */
    onEnd: Set<() => void>;
}

interface PendingAnswer {
    timer: null | ReturnType<typeof setTimeout>;
    transferId: string | undefined;
}

class LoadAbandoned extends Error {}

const budgetOf = (timeoutMs: unknown): null | number => {
    const n = Number(timeoutMs);
    return Number.isFinite(n) && n > 0 ? n : null;
};

export const createCastLoader = <P>(deps: CastLoadDeps<P>): CastLoader<P> => {
    let current: Attempt | null = null;
    let pending: null | PendingAnswer = null;

    const end = (attempt: Attempt | null, reason: EndReason) => {
        if (!attempt || attempt.ended) return;
        attempt.ended = reason;
        for (const wake of attempt.onEnd) wake();
        attempt.onEnd.clear();
    };

    /** `p`, unless the attempt ends first: then LoadAbandoned. */
    const within = <T>(attempt: Attempt, p: Promise<T>): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            if (attempt.ended) {
                reject(new LoadAbandoned());
                return;
            }
            const wake = () => reject(new LoadAbandoned());
            attempt.onEnd.add(wake);
            p.then(
                (value) => {
                    attempt.onEnd.delete(wake);
                    resolve(value);
                },
                (error) => {
                    attempt.onEnd.delete(wake);
                    reject(error);
                },
            );
        });

    /** The hub's answer is no longer owed (release, a newer transfer): say nothing. */
    const dropPending = () => {
        if (pending?.timer) clearTimeout(pending.timer);
        pending = null;
    };

    const answer = (ok: boolean, error?: string) => {
        if (!pending) return;
        const { transferId } = pending;
        dropPending();
        deps.sendLoaded({ error: ok ? undefined : error, ok, t: 'loaded', transferId });
    };

    const loadOnce = (attempt: Attempt, player: P, sendLoad: SendLoad<P>): Promise<void> =>
        new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error('load timed out after 10s')),
                LOAD_ANSWER_MS,
            );
            sendLoad(player, (err) => {
                clearTimeout(timeout);
                if (attempt.ended) {
                    // Nobody wants this LOAD any more. If the speaker took it, it is playing for
                    // a transfer the hub rolled back or a session that left; pause it, unless a
                    // newer LOAD has gone out since (`replaced`), which the speaker plays next.
                    if (!err && attempt === current) deps.pauseLanded(player);
                    return;
                }
                if (err) reject(err);
                else resolve();
            });
        });

    const run = async (sendLoad: SendLoad<P>): Promise<LoadResult> => {
        end(current, 'replaced');
        const attempt: Attempt = { ended: null, onEnd: new Set() };
        current = attempt;
        try {
            let player: P;
            try {
                player = await within(attempt, deps.ensureCast());
            } catch (error) {
                if (error instanceof LoadAbandoned) throw error;
                deps.log('error', `cannot reach the device (${(error as Error).message})`);
                return 'failed';
            }
            try {
                await within(attempt, loadOnce(attempt, player, sendLoad));
            } catch (error) {
                if (error instanceof LoadAbandoned) throw error;
                // The previous media session may be dead (e.g. after release/stop)
                // — retry once with a completely fresh cast session.
                deps.log(
                    'warn',
                    `load failed (${(error as Error).message}), retrying with a fresh session`,
                );
                deps.teardown();
                try {
                    // Breathe before retrying: a failed connect kicks off an mDNS re-query, and
                    // if the device has moved this is the window in which its new address lands
                    // (updateHost). Retrying instantly would just dial the stale one again.
                    await within(
                        attempt,
                        new Promise((r) => setTimeout(r, RETRY_BREATHE_MS)),
                    );
                    const freshPlayer = await within(attempt, deps.ensureCast());
                    await within(attempt, loadOnce(attempt, freshPlayer, sendLoad));
                } catch (retryError) {
                    if (retryError instanceof LoadAbandoned) throw retryError;
                    deps.log(
                        'error',
                        `giving up on this load (${(retryError as Error).message})`,
                    );
                    deps.teardown();
                    return 'failed';
                }
            }
            return 'ok';
        } catch (error) {
            if (error instanceof LoadAbandoned) return 'abandoned';
            throw error;
        }
    };

    /** Whatever load ended, a transfer still waiting for its answer gets it from this one. */
    const settle = (result: LoadResult): LoadResult => {
        if (result !== 'abandoned') {
            answer(result === 'ok', 'the speaker did not start playback');
        }
        return result;
    };

    return {
        hubLoad: async (directive, sendLoad) => {
            // A newer transfer to this speaker: the hub cancelled its wait for the older one.
            dropPending();
            const transferId =
                typeof directive.transferId === 'string' ? directive.transferId : undefined;
            const budget = budgetOf(directive.timeoutMs);
            const answerFor: PendingAnswer = { timer: null, transferId };
            if (budget !== null) {
                answerFor.timer = setTimeout(
                    () => {
                        if (pending !== answerFor) return;
                        deps.log('warn', `load not started inside the hub's ${budget} ms`);
                        answer(false, 'the speaker did not start playback in time');
                        end(current, 'deadline');
                    },
                    Math.max(1000, budget - ACK_RESERVE_MS),
                );
            }
            // A load with no budget (an older hub, no transfer) is answered when it ends, as
            // before: nobody rolls it back on a clock.
            pending = answerFor;
            if (!sendLoad) {
                end(current, 'replaced');
                return settle('failed');
            }
            return settle(await run(sendLoad));
        },
        release: () => {
            dropPending();
            end(current, 'released');
        },
        reload: async (sendLoad) => settle(await run(sendLoad)),
    };
};
