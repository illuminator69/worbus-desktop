import { execFileSync } from 'node:child_process';
import {
    closeSync,
    copyFileSync,
    existsSync,
    linkSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    renameSync,
    rmSync,
    symlinkSync,
    utimesSync,
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

/** `busy`: another Worbus is still copying (its lock kept fresh) after this one's wait. */
export type MigrationResult = 'already' | 'busy' | 'copied' | 'no-old' | 'old-live';

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

/** A lock this young may belong to an app still between taking it and opening its socket. */
const STARTING_MS = 10_000;

/** The pid a `<host>-<pid>` lock names on this host, or null (another host, or not a lock). */
const holderPid = (content: string): null | number => {
    const cut = content.lastIndexOf('-');
    const pid = Number(content.slice(cut + 1));
    if (cut < 1 || content.slice(0, cut) !== hostname() || !Number.isInteger(pid) || pid <= 0)
        return null;
    return pid;
};

const pidAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM: alive, owned by someone else.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
};

/** When this machine booted (ms since the epoch), or null where that cannot be read. */
const bootTimeMs = (): null | number => {
    try {
        if (process.platform === 'linux') {
            const btime = readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)$/m);
            return btime ? Number(btime[1]) * 1000 : null;
        }
        if (process.platform === 'darwin') {
            const sec = execFileSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' });
            const match = sec.match(/sec = (\d+)/);
            return match ? Number(match[1]) * 1000 : null;
        }
    } catch {
        // Unknown: the caller does not use the boot time.
    }
    return null;
};

/** Written before this boot: no process alive now can hold it, whatever pid it names. */
const fromBeforeBoot = (mtimeMs: number): boolean => {
    const boot = bootTimeMs();
    return boot !== null && mtimeMs < boot;
};

/**
 * Whether a Unix socket is bound to `socketPath` and listening, read from `/proc/net/unix`
 * (synchronously: the copy runs before the app is ready). Null where that table cannot be read.
 */
const listeningAt = (socketPath: string): boolean | null => {
    let table: string;
    try {
        table = readFileSync('/proc/net/unix', 'utf8');
    } catch {
        return null;
    }
    // Num RefCount Protocol Flags Type St Inode Path; flag 0x10000 is __SO_ACCEPTCON (listening).
    for (const line of table.split('\n')) {
        const row = line.match(/^\S+: \S+ \S+ ([0-9A-Fa-f]+) \S+ \S+ \S+ (.+)$/);
        if (row && row[2] === socketPath && (parseInt(row[1], 16) & 0x10000) !== 0) return true;
    }
    return false;
};

/**
 * Whether the old app is running on `oldDir`. Chromium's instance lock: `SingletonLock` names
 * `<host>-<pid>` (a symlink on Linux and macOS) and `SingletonSocket` links to the socket the
 * running app listens on. A crash (a power cut, most often) leaves both behind, and after a
 * reboot the pid may belong to some other live process, so a live pid alone is not the old app:
 * on Linux its socket must be listening too, as Chromium itself checks. A lock from before the
 * last boot is stale everywhere. Where it cannot be told, the answer is "live": a copy of open
 * databases could be half-written. Windows keeps an open `lockfile` instead, which cannot be
 * opened for writing while the app runs.
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
    const lockPath = path.join(oldDir, 'SingletonLock');
    let target: string;
    let written: number;
    try {
        target = readlinkSync(lockPath);
        written = lstatSync(lockPath).mtimeMs;
    } catch {
        return false;
    }
    const pid = holderPid(target);
    if (pid === null || !pidAlive(pid)) return false;
    // Just taken: the socket follows within milliseconds. (Abs: a file time can be a hair ahead.)
    const age = Date.now() - written;
    if (Math.abs(age) < STARTING_MS) return true;
    if (process.platform === 'linux') {
        let socket: string;
        try {
            socket = readlinkSync(path.join(oldDir, 'SingletonSocket'));
        } catch {
            // Chromium links the socket right after taking the lock: an old lock without it is
            // no running app.
            return false;
        }
        const listening = listeningAt(socket);
        if (listening !== null) return listening;
    }
    // No socket to ask (macOS, or no /proc/net/unix): only a lock from before the boot is stale.
    return !fromBeforeBoot(written);
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
    beat: () => void,
) => {
    mkdirSync(to);
    for (const name of readdirSync(from)) {
        beat();
        if (top && skipped(name)) continue;
        const src = path.join(from, name);
        const dest = path.join(to, name);
        const st = lstatSync(src);
        if (st.isSymbolicLink()) {
            symlinkSync(readlinkSync(src), dest);
        } else if (st.isDirectory()) {
            copyTree(src, dest, false, count, beat);
        } else if (st.isFile()) {
            let size = st.size;
            if (top && name === SETTINGS_FILE) {
                const written = writeSettingsWithoutHub(src, dest);
                if (written === null) continue; // not written, so not counted
                size = written;
            } else {
                copyFileSync(src, dest);
            }
            count.files += 1;
            count.bytes += size;
        }
    }
};

/**
 * The settings file without the Worbus Server sign-in; its size, or null when it was not written.
 * One that cannot be parsed is not copied: its hub keys could not be taken out, and
 * electron-store would refuse it anyway.
 */
const writeSettingsWithoutHub = (src: string, dest: string): null | number => {
    let settings: Record<string, unknown>;
    try {
        settings = JSON.parse(readFileSync(src, 'utf8'));
    } catch {
        return null;
    }
    for (const key of LEFT_BEHIND_KEYS) delete settings[key];
    // electron-store's own layout (conf writes tab-indented JSON).
    const text = JSON.stringify(settings, undefined, '\t');
    writeFileSync(dest, text);
    return Buffer.byteLength(text);
};

/**
 * How long a second Worbus waits for another one's copy before it says so and quits. A normal copy
 * (the walk's 301 MB folder: 6 s) ends well inside it, and then the first launch's window opens.
 */
const COPY_WAIT_MS = 60_000;

/**
 * The copy's holder touches its lock about once a second while it copies (between files). A lock
 * untouched for this long is a dead copy's, whatever process now has its pid. The longest gap
 * between two touches is one file: the old folder's files are LevelDB tables (2 MB at most) and
 * stored blobs, and 30 s is a 1 GB file on a 35 MB/s disk.
 */
const STALE_MS = 30_000;

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Whether the copy lock (`<host>-<pid>`) is held by a Worbus that is copying now: its pid is alive
 * on this host and it was touched within `staleMs`. Anything else is a crashed copy's lock (also
 * when its pid now belongs to another program) and is taken over. No program path is compared:
 * an AppImage runs from a new mount path at every launch.
 */
const copyHolderAlive = (content: string, touched: number, staleMs: number): boolean => {
    const pid = holderPid(content);
    if (pid === null || pid === process.pid || !pidAlive(pid)) return false;
    return Math.abs(Date.now() - touched) <= staleMs;
};

/** Touch `lock` at most every `everyMs`: the holder's heartbeat, called between files. */
const heartbeat = (lock: string, everyMs: number) => {
    let last = Date.now();
    return () => {
        const at = Date.now();
        if (at - last < everyMs) return;
        last = at;
        try {
            utimesSync(lock, new Date(at), new Date(at));
        } catch {
            // Gone or taken over: the copy goes on; the marker still decides.
        }
    };
};

/** Remove the per-launch drafts (`<lock>.<pid>`, `<lock>.stale-<pid>`) of launches that died. */
const sweepDrafts = (lock: string) => {
    const dir = path.dirname(lock);
    const base = path.basename(lock);
    for (const name of readdirSync(dir)) {
        if (!name.startsWith(`${base}.`)) continue;
        const pid = Number(name.slice(base.length + 1).replace(/^stale-/, ''));
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || pidAlive(pid)) continue;
        rmSync(path.join(dir, name), { force: true });
    }
};

/** Take over a stale lock, unless another Worbus replaced it after it was read. */
const takeOver = (lock: string, stale: string) => {
    const aside = `${lock}.stale-${process.pid}`;
    try {
        renameSync(lock, aside);
    } catch {
        return; // someone else took it over first
    }
    try {
        if (readFileSync(aside, 'utf8') !== stale) linkSync(aside, lock); // put a live one back
    } catch {
        // EEXIST: a third launch holds it now; the loop asks again.
    }
    rmSync(aside, { force: true });
};

/**
 * Hold the copy lock beside the new folder (written whole, then linked into place: creating a
 * link that exists fails, so one process wins). While another Worbus holds it, wait for its
 * marker; `done` when it appears, `busy` when the wait runs out.
 */
const acquireCopyLock = (
    lock: string,
    waitMs: number,
    staleMs: number,
    finished: () => boolean,
): 'busy' | 'done' | 'held' => {
    const mine = `${hostname()}-${process.pid}`;
    const draft = `${lock}.${process.pid}`;
    const until = Date.now() + waitMs;
    writeFileSync(draft, mine);
    try {
        for (;;) {
            try {
                linkSync(draft, lock);
                // The draft may be as old as the wait: start the heartbeat from now.
                const at = new Date();
                utimesSync(lock, at, at);
                return 'held';
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            }
            if (finished()) return 'done';
            let holder: string;
            let touched: number;
            try {
                holder = readFileSync(lock, 'utf8');
                touched = lstatSync(lock).mtimeMs;
            } catch {
                continue; // released between the two calls
            }
            if (!copyHolderAlive(holder, touched, staleMs)) {
                takeOver(lock, holder);
                continue;
            }
            if (Date.now() >= until) return 'busy';
            sleep(100);
        }
    } finally {
        rmSync(draft, { force: true });
    }
};

export const migrateFromFeishin = (opts: {
    configRoot: string;
    dev: boolean;
    isOldAppLive: (oldDir: string) => boolean;
    now?: () => Date;
    /** How long a copy lock may go untouched before it is a dead copy's (default 30 s). */
    staleMs?: number;
    /** How long to wait for another Worbus's copy (default a minute). */
    waitMs?: number;
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

    // Two launches at once (a second click while the first copies, before either has the app's
    // instance lock): one copies, the other waits for it and then finds the marker.
    const temp = `${newDir}.migrating`;
    const lock = `${temp}.lock`;
    const staleMs = opts.staleMs ?? STALE_MS;
    const got = acquireCopyLock(lock, opts.waitMs ?? COPY_WAIT_MS, staleMs, () =>
        existsSync(marker),
    );
    if (got === 'done') return { ...done, result: 'already' };
    if (got === 'busy') return { ...done, result: 'busy' };
    try {
        sweepDrafts(lock);
        if (existsSync(marker)) return { ...done, result: 'already' };

        // Only the lock's holder gets here, so this is a killed copy's leftover: an incomplete
        // duplicate of the untouched old folder.
        rmSync(temp, { force: true, recursive: true });

        const count = { bytes: 0, files: 0 };
        copyTree(oldDir, temp, true, count, heartbeat(lock, Math.min(1000, staleMs / 5)));

        // R3 (a): a Worbus folder without the marker (a crashed first start, or one Electron made)
        // is moved aside, never deleted.
        if (existsSync(newDir)) renameSync(newDir, `${newDir}.pre-migration-${stamp(now())}`);
        renameSync(temp, newDir);
        // Last: until it exists the next start copies again.
        writeFileSync(marker, `${now().toISOString()} ${oldDir}\n`);
        return { ...done, ...count, result: 'copied' };
    } finally {
        rmSync(lock, { force: true });
    }
};
