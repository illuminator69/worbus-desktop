/**
 * navi-connect: use-hub's runDirective chain, out of the hook so a harness can time it (B-111).
 * Pure: the handler and what follows a directive's end come in per call.
 *
 * Directives run one at a time, in arrival order. A second load resolving songs could otherwise
 * still be running when the next seek, pause or release arrived, and then finish last, replacing
 * the queue on top of newer intent. `ended` runs once the directive has ENDED (carried out,
 * refused, failed, a throw included): use-hub moves `applied` there and sends the report that
 * follows (do-echo.ts).
 */
export const createDirectiveRunner = <M, E>(options: {
    /** How a directive that threw ended. */
    fallback: E;
    onError: (msg: M, error: unknown) => void;
}) => {
    let chain: Promise<void> = Promise.resolve();
    return (msg: M, handle: (msg: M) => Promise<E>, ended: (exit: E) => void): Promise<void> => {
        const next = chain
            .then(async () => {
                let exit: E = options.fallback;
                try {
                    exit = await handle(msg);
                } finally {
                    ended(exit);
                }
            })
            .catch((e) => {
                // One bad directive must not break the chain for every later one.
                options.onError(msg, e);
            });
        chain = next;
        return next;
    };
};
