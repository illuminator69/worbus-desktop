/**
 * What a termination signal (SIGTERM, SIGINT) does (B-422). A logout, a shutdown, `systemctl --user
 * stop` or `kill` must quit the app the way the Quit menu does: Chromium writes DOM storage to disk
 * lazily, and `process.exit` skips the quit that writes it out. So: write DOM storage out, quit the
 * ordinary way (`before-quit` cleans mpv up), and hard-exit only if that quit hangs, or at once on a
 * second signal.
 */

export const HARD_EXIT_MS = 5000;

export interface TerminationDeps {
    exit: (code: number) => void;
    flushStorage: () => void;
    log: (message: string, meta: Record<string, unknown>) => void;
    quit: () => void;
    setTimer: (fn: () => void, ms: number) => void;
}

export const createTerminationHandler = (deps: TerminationDeps) => {
    let quitting = false;
    return (signal: string) => {
        if (quitting) {
            deps.log('Second termination signal, exiting now', { signal });
            deps.exit(0);
            return;
        }
        quitting = true;
        deps.log('Termination signal, quitting', { signal });
        try {
            deps.flushStorage();
        } catch (err) {
            deps.log('Could not flush DOM storage', { error: String(err) });
        }
        deps.setTimer(() => {
            deps.log('Quit did not finish, exiting', { signal });
            deps.exit(0);
        }, HARD_EXIT_MS);
        deps.quit();
    };
};
