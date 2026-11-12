/**
 * B-328: a "Reset to default" that put main's settings back to their defaults owes a restart, so
 * main acts on them (the tray, the window frame, media keys, the playback engine). The reset
 * reloads the renderer, which would drop a toast shown before it, so the debt is noted in this
 * tab's sessionStorage and the restart is asked once after the reload. Storage may be refused (a
 * private window, blocked site data): the reset itself never depends on it.
 */
const RESTART_OWED_KEY = 'worbus-reset-restart-owed';

export const noteRestartOwedAfterReset = (storage: Pick<Storage, 'setItem'>): void => {
    try {
        storage.setItem(RESTART_OWED_KEY, '1');
    } catch {
        // Nothing noted: the person is not asked, as before the fix; main's defaults still apply at
        // the next start.
    }
};

/** Whether a reset owed a restart; the note is used up. */
export const takeRestartOwedAfterReset = (
    storage: Pick<Storage, 'getItem' | 'removeItem'>,
): boolean => {
    try {
        const owed = storage.getItem(RESTART_OWED_KEY) === '1';
        if (owed) storage.removeItem(RESTART_OWED_KEY);
        return owed;
    } catch {
        return false;
    }
};
