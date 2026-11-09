/**
 * The cast bridge's load procedure, out of index.ts so a harness can replay it against a fake
 * speaker (B-106). Pure: the speaker, the session builder and the hub socket come in as `deps`.
 *
 * A load: get a receiver (`ensureCast`), send LOAD, wait for its answer; if that fails, drop the
 * session, breathe, build a fresh one and LOAD once more.
 */

/** The speaker's answer to one LOAD: no error means it took the media. */
export type LoadAnswer = (err?: Error | null) => void;

export interface CastLoadDeps<P> {
    /** A live receiver session, building one if needed (index.ts `ensureCast`). */
    ensureCast: () => Promise<P>;
    /** The `loaded` frame to the hub (PROTOCOL §7.1-7.2). */
    sendLoaded: (frame: { error?: string; ok: boolean; t: 'loaded'; transferId?: string }) => void;
    log: (level: 'error' | 'warn', message: string) => void;
    /** Drop the receiver session (index.ts `teardownCast`). */
    teardown: () => void;
}

/** Sends LOAD for the current track to `player`; `answer` is called once the speaker replies. */
export type SendLoad<P> = (player: P, answer: LoadAnswer) => void;

/** How a load ended: the speaker took it, it could not, or nobody wants its answer any more. */
export type LoadResult = 'abandoned' | 'failed' | 'ok';

export const LOAD_ANSWER_MS = 10_000;
export const RETRY_BREATHE_MS = 1200;

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

export const createCastLoader = <P>(deps: CastLoadDeps<P>): CastLoader<P> => {
    const loadOnce = (player: P, sendLoad: SendLoad<P>): Promise<void> =>
        new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error('load timed out after 10s')),
                LOAD_ANSWER_MS,
            );
            sendLoad(player, (err) => {
                clearTimeout(timeout);
                if (err) reject(err);
                else resolve();
            });
        });

    const run = async (sendLoad: SendLoad<P>): Promise<LoadResult> => {
        let player: P;
        try {
            player = await deps.ensureCast();
        } catch (error) {
            deps.log('error', `cannot reach the device (${(error as Error).message})`);
            return 'failed';
        }
        try {
            await loadOnce(player, sendLoad);
        } catch (error) {
            // The previous media session may be dead (e.g. after release/stop)
            // — retry once with a completely fresh cast session.
            deps.log('warn', `load failed (${(error as Error).message}), retrying with a fresh session`);
            deps.teardown();
            try {
                // Breathe before retrying: a failed connect kicks off an mDNS re-query, and
                // if the device has moved this is the window in which its new address lands
                // (updateHost). Retrying instantly would just dial the stale one again.
                await new Promise((r) => setTimeout(r, RETRY_BREATHE_MS));
                const freshPlayer = await deps.ensureCast();
                await loadOnce(freshPlayer, sendLoad);
            } catch (retryError) {
                deps.log('error', `giving up on this load (${(retryError as Error).message})`);
                deps.teardown();
                return 'failed';
            }
        }
        return 'ok';
    };

    return {
        hubLoad: async (_directive, sendLoad) => {
            const result = sendLoad ? await run(sendLoad) : 'failed';
            // PROTOCOL §7.1. Without this the hub commits the active slot and
            // never learns the speaker didn't start, so a transfer to a TV that
            // has been off for days reads as playing on every device until a
            // human intervenes.
            deps.sendLoaded({
                error: result === 'ok' ? undefined : 'the speaker did not start playback',
                ok: result === 'ok',
                t: 'loaded',
            });
            return result;
        },
        release: () => {},
        reload: run,
    };
};
