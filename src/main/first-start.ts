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
 * A second Worbus started during the copy waits for it (`migrate-from-feishin.ts`'s copy lock).
 */

export const OLD_APP_LIVE_TITLE = 'Close Feishin first';
export const OLD_APP_LIVE_BODY =
    'Worbus copies your Feishin settings the first time it starts. Close Feishin, then start Worbus again.';
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

export const blockedByOldApp = 'result' in firstStart && firstStart.result === 'old-live';

/**
 * Another Worbus started first and is still copying after the wait: this launch quits quietly,
 * as a second instance would. It must not take the app's instance lock on a folder being copied.
 */
const anotherCopyRunning = 'result' in firstStart && firstStart.result === 'busy';

/** This launch stops here: `index.ts` does nothing further. */
export const stopsAtFirstStart = blockedByOldApp || anotherCopyRunning;

if (stopsAtFirstStart) {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'worbus-blocked-'));
    app.setPath('userData', path.join(scratch, 'Worbus'));
    app.setAppLogsPath(path.join(scratch, 'logs'));
    void app.whenReady().then(() => {
        if (blockedByOldApp) {
            dialog.showMessageBoxSync({
                buttons: ['Quit'],
                detail: OLD_APP_LIVE_BODY,
                message: OLD_APP_LIVE_TITLE,
                title: OLD_APP_LIVE_TITLE,
                type: 'info',
            });
        }
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
