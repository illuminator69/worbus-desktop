/**
 * One read in flight at a time (PROTOCOL §15.6, review L4): a call while a read runs does not
 * start another; every such call shares ONE follow-up read, started when the running one ends.
 * The follow-up is what makes a burst truthful - a `fill` frame that arrives during a read may
 * describe a change the running read started too early to see - and it is one read however many
 * frames came. A failed read rejects its callers and does not wedge the next call.
 */
export const singleFlight = <T>(read: () => Promise<T>): (() => Promise<T>) => {
    let current: null | Promise<T> = null;
    let next: null | Promise<T> = null;
    const run = (): Promise<T> => {
        const started = read();
        current = started;
        const clear = () => {
            if (current === started) current = null;
        };
        started.then(clear, clear);
        return started;
    };
    return () => {
        if (!current) return run();
        if (!next) {
            const settle = () => {
                next = null;
                return run();
            };
            next = current.then(settle, settle);
        }
        return next;
    };
};
