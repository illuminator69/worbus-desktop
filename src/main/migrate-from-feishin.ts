import {
    closeSync,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

/**
 * Worbus P5 (design §6.4, ruling R3): the first start copies the old Feishin settings folder
 * (`<config>/feishin`, dev `feishin-dev`) into Worbus's own (`<config>/Worbus`, dev `Worbus-dev`),
 * once. A done-marker in the new folder records it, so a crashed first start migrates on the next
 * one. Nothing is ever deleted: the old folder is only read, and a Worbus folder that has no marker
 * is moved aside. The settings file arrives without `hub` and `hubAuth`, so Worbus signs in to the
 * Worbus Server as a new device instead of signing the old app out.
 *
 * Pure apart from the file system; `first-start.ts` runs it before anything reads the settings
 * path, and `migrate-from-feishin.harness.ts` runs it on stand-in folders.
 */

export interface Migration {
    /** Bytes copied (`copied` only). */
    bytes?: number;
    /** Files copied (`copied` only). */
    files?: number;
    newDir: string;
    oldDir: string;
    result: MigrationResult;
}

export type MigrationResult = 'already' | 'copied' | 'no-old' | 'old-live';

export const MARKER = '.migrated-from-feishin';
const SETTINGS_FILE = 'config.json';
const LEFT_BEHIND_KEYS = ['hub', 'hubAuth'];
/** Chromium's caches and the old app's instance lock, at the top of the folder. */
const SKIPPED = new Set(['Cache', 'Code Cache', 'DawnCache', 'GPUCache']);
const skipped = (name: string) => SKIPPED.has(name) || name.startsWith('Singleton');

/** `20261107T120000Z`: a folder-name-safe UTC stamp. */
const stamp = (now: Date) =>
    now
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');

/**
 * Whether the old app is running on `oldDir`: its `SingletonLock` names `<host>-<pid>` (a symlink on
 * Linux and macOS) and that process is alive on this host. A lock a crash left behind names a
 * process that is gone. Windows keeps an open `lockfile` instead, which cannot be removed while
 * the app runs.
 */
export const isOldAppLive = (oldDir: string): boolean => {
    if (process.platform === 'win32') {
        const lockfile = path.join(oldDir, 'lockfile');
        if (!existsSync(lockfile)) return false;
        try {
            // Chromium holds it open for writing, shared for reading only.
            closeSync(openSync(lockfile, 'r+'));
            return false;
        } catch {
            return true;
        }
    }
    let target: string;
    try {
        target = readlinkSync(path.join(oldDir, 'SingletonLock'));
    } catch {
        return false;
    }
    const cut = target.lastIndexOf('-');
    const host = target.slice(0, cut);
    const pid = Number(target.slice(cut + 1));
    if (cut < 1 || host !== hostname() || !Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM: alive, owned by someone else.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
};

/** The folder the marker in `newDir` says was copied, or null (no marker, or a fresh start). */
export const migratedFrom = (newDir: string): null | string => {
    try {
        const line = readFileSync(path.join(newDir, MARKER), 'utf8').trim();
        const source = line.slice(line.indexOf(' ') + 1);
        return line.includes(' ') && source !== 'none' ? source : null;
    } catch {
        return null;
    }
};

/** Copy `from` into `to` (which does not exist), counting files and bytes; links stay links. */
const copyTree = (
    from: string,
    to: string,
    top: boolean,
    count: { bytes: number; files: number },
) => {
    mkdirSync(to);
    for (const name of readdirSync(from)) {
        if (top && skipped(name)) continue;
        const src = path.join(from, name);
        const dest = path.join(to, name);
        const st = lstatSync(src);
        if (st.isSymbolicLink()) {
            symlinkSync(readlinkSync(src), dest);
        } else if (st.isDirectory()) {
            copyTree(src, dest, false, count);
        } else if (st.isFile()) {
            if (top && name === SETTINGS_FILE) {
                writeSettingsWithoutHub(src, dest);
            } else {
                copyFileSync(src, dest);
            }
            count.files += 1;
            count.bytes += st.size;
        }
    }
};

/**
 * The settings file without the Worbus Server sign-in. One that cannot be parsed is not copied:
 * its hub keys could not be taken out, and electron-store would refuse it anyway.
 */
const writeSettingsWithoutHub = (src: string, dest: string) => {
    let settings: Record<string, unknown>;
    try {
        settings = JSON.parse(readFileSync(src, 'utf8'));
    } catch {
        return;
    }
    for (const key of LEFT_BEHIND_KEYS) delete settings[key];
    // electron-store's own layout (conf writes tab-indented JSON).
    writeFileSync(dest, JSON.stringify(settings, undefined, '\t'));
};

export const migrateFromFeishin = (opts: {
    configRoot: string;
    dev: boolean;
    isOldAppLive: (oldDir: string) => boolean;
    now?: () => Date;
}): Migration => {
    const now = opts.now ?? (() => new Date());
    const oldDir = path.join(opts.configRoot, opts.dev ? 'feishin-dev' : 'feishin');
    const newDir = path.join(opts.configRoot, opts.dev ? 'Worbus-dev' : 'Worbus');
    const marker = path.join(newDir, MARKER);
    const done = { newDir, oldDir };

    if (existsSync(marker)) return { ...done, result: 'already' };

    if (!existsSync(oldDir)) {
        // R3 (b): marked all the same, so a Feishin run later is never copied over Worbus's own.
        mkdirSync(newDir, { recursive: true });
        writeFileSync(marker, `${now().toISOString()} none\n`);
        return { ...done, result: 'no-old' };
    }

    // R3 (c): its databases are open; a copy now could be half-written. Create nothing.
    if (opts.isOldAppLive(oldDir)) return { ...done, result: 'old-live' };

    // A copy killed part-way leaves only this: an incomplete duplicate of the untouched old folder.
    const temp = `${newDir}.migrating`;
    rmSync(temp, { force: true, recursive: true });

    const count = { bytes: 0, files: 0 };
    copyTree(oldDir, temp, true, count);

    // R3 (a): a Worbus folder without the marker (a crashed first start, or one Electron made) is
    // moved aside, never deleted.
    if (existsSync(newDir)) renameSync(newDir, `${newDir}.pre-migration-${stamp(now())}`);
    renameSync(temp, newDir);
    // Last: until it exists the next start copies again.
    writeFileSync(marker, `${now().toISOString()} ${oldDir}\n`);
    return { ...done, ...count, result: 'copied' };
};
