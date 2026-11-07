import { app, dialog } from 'electron';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isOldAppLive, migrateFromFeishin, type Migration } from './migrate-from-feishin';

/**
 * Worbus P5 (design §6.4): the main process's first import. The settings path is read when
 * `settings/index.ts`, `custom-themes/index.ts` and `index.ts` load, so the old Feishin folder is
 * copied here, before any of them, and this file imports nothing that reads it.
 *
 * While the old app runs, its databases are open: nothing is copied or created. Every later module
 * is pointed at a scratch folder, and the app shows one dialog and quits before any window opens.
 * A second Worbus started during the copy waits for it (`migrate-from-feishin.ts`'s copy lock); if
 * the copy is still running when the wait ends, it says so the same way and quits.
 */

export const OLD_APP_LIVE_TITLE = 'Close Feishin first';
export const OLD_APP_LIVE_BODY =
    'Worbus copies your Feishin settings the first time it starts. Close Feishin, then start Worbus again.';
export const BUSY_TITLE = 'Worbus is already starting';
export const BUSY_BODY =
    'Another Worbus is still copying your Feishin settings. Its window opens when the copy is done. If none opens, start Worbus again.';
export const COPY_FAILED_BODY =
    "Worbus couldn't copy your Feishin settings, so it started fresh. Your Feishin folder is untouched.";

const run = (): Migration | { error: string } => {
    try {
        return migrateFromFeishin({
            configRoot: app.getPath('appData'),
            dev: process.env.NODE_ENV === 'development',
            isOldAppLive,
        });
    } catch (error) {
        return { error: String(error) };
    }
};

export const firstStart = run();

/**
 * The launches that stop here, each with what it says: the old app is running (its databases are
 * open), or another Worbus is still copying after the wait (this one must not take the app's
 * instance lock on a folder being copied). Never a silent quit (design §4).
 */
const STOPS: Record<string, undefined | { body: string; title: string }> = {
    busy: { body: BUSY_BODY, title: BUSY_TITLE },
    'old-live': { body: OLD_APP_LIVE_BODY, title: OLD_APP_LIVE_TITLE },
};

const stop = 'result' in firstStart ? STOPS[firstStart.result] : undefined;

/** This launch stops here: `index.ts` does nothing further. */
export const stopsAtFirstStart = stop !== undefined;

if (stop) {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'worbus-blocked-'));
    app.setPath('userData', path.join(scratch, 'Worbus'));
    app.setAppLogsPath(path.join(scratch, 'logs'));
    void app.whenReady().then(() => {
        dialog.showMessageBoxSync({
            buttons: ['Quit'],
            detail: stop.body,
            message: stop.title,
            title: stop.title,
            type: 'info',
        });
        rmSync(scratch, { force: true, recursive: true });
        app.exit(0);
    });
}

/** The copy's one log line (written once the logger may create its folder). */
export const firstStartLine = (): string => {
    if ('error' in firstStart)
        return `settings copy from Feishin failed, starting fresh: ${firstStart.error}`;
    const { bytes, files, newDir, oldDir, result } = firstStart;
    return result === 'copied'
        ? `settings copy from Feishin: copied ${files} files, ${bytes} bytes, ${oldDir} -> ${newDir}`
        : `settings copy from Feishin: ${result} (${newDir})`;
};
