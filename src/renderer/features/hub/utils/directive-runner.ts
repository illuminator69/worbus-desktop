/**
 * navi-connect: use-hub's runDirective chain, out of the hook so a harness can time it (B-111).
 * Pure: the handler and what follows a directive's end come in per call.
 *
 * Directives are APPLIED one at a time, in arrival order. A second load resolving songs could
 * otherwise still be running when the next seek, pause or release arrived, and then finish last,
 * replacing the queue on top of newer intent.
 *
 * A directive's END is a separate moment: `ended` runs once it has ended (carried out, refused,
 * failed, a throw included), and use-hub moves `applied` there and sends the report that follows
 * (do-echo.ts). For most directives the two coincide. A load's does not: once its commands are
 * issued it waits up to the hub's budget for proof that playback started (awaitLoadOutcome), and
 * that wait used to hold the chain, so a pause pressed during a slow transfer was applied up to
 * 8.5 s late (B-111). A handler now returns `{ later }` for that: the chain moves on as soon as
 * the commands are issued, and `ended` waits for `later`. The next directive's own `ended` may
 * come first; do-echo's `applied` only moves forward, so the load's then moves nothing.
 */
export type Handled<E> = E | { later: Promise<E> };

const isLater = <E>(handled: Handled<E>): handled is { later: Promise<E> } =>
    typeof handled === 'object' && handled !== null && 'later' in handled;

export const createDirectiveRunner = <M, E>(options: {
    /** How a directive that threw ended. */
    fallback: E;
    onError: (msg: M, error: unknown) => void;
}) => {
    let chain: Promise<void> = Promise.resolve();
    return (
        msg: M,
        handle: (msg: M) => Promise<Handled<E>>,
        ended: (exit: E) => void,
    ): Promise<void> => {
        const next = chain
            .then(async () => {
                let handled: Handled<E>;
                try {
                    handled = await handle(msg);
                } catch (e) {
                    ended(options.fallback);
                    throw e;
                }
                if (!isLater(handled)) {
                    ended(handled);
                    return;
                }
                // Off the chain: the next directive is applied while this one finishes.
                handled.later.then(ended, (e) => {
                    ended(options.fallback);
                    options.onError(msg, e);
                });
            })
            .catch((e) => {
                // One bad directive must not break the chain for every later one.
                options.onError(msg, e);
            });
        chain = next;
        return next;
    };
};
