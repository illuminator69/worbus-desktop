import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    lutimesSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    symlinkSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Worbus P5 lane F, F2:  node --test src/main/migrate-from-feishin.harness.ts
 *
 * The first start copies the old Feishin folder into Worbus's own, once (design §6.4, ruling R3):
 * by a done-marker, never while the old app is running, never deleting anything, leaving the
 * Worbus Server sign-in (`hub`, `hubAuth`) behind. Each test builds a stand-in config root in a
 * temporary directory. The module is imported inside each test so that, before it exists, each
 * test fails on its own.
 */

const load = () => import('./migrate-from-feishin.ts');

const SETTINGS = {
    __internal__: { migrations: { version: '0.4.0' } },
    hub: { deviceId: 'dev-old', deviceIds: { 'id:abc': 'dev-old' } },
    hubAuth: { secret: 'ciphertext', signedIn: true },
    hubServer: { addresses: ['ws://192.168.1.20:4790'], serverId: 'f'.repeat(32) },
    password_store: 'gnome-libsecret',
    server: { 'server-1': 'a1b2c3' },
    theme: 'dark',
};

const notLive = () => false;

/** A config root holding an old folder `name` as a person's Feishin left it. */
const rootWithOld = (name = 'feishin'): { old: string; root: string } => {
    const root = mkdtempSync(path.join(tmpdir(), 'worbus-migrate-'));
    const old = path.join(root, name);
    mkdirSync(path.join(old, 'Local Storage', 'leveldb'), { recursive: true });
    mkdirSync(path.join(old, 'IndexedDB', 'app_0.indexeddb.leveldb'), { recursive: true });
    mkdirSync(path.join(old, 'Themes'), { recursive: true });
    writeFileSync(path.join(old, 'config.json'), JSON.stringify(SETTINGS, null, '\t'));
    writeFileSync(path.join(old, 'Local Storage', 'leveldb', '000003.log'), 'store\0eq presets');
    writeFileSync(path.join(old, 'IndexedDB', 'app_0.indexeddb.leveldb', 'CURRENT'), 'x');
    writeFileSync(path.join(old, 'custom.css'), '.feishin { color: red; }');
    writeFileSync(path.join(old, 'Themes', 'mine.json'), '{"id":"mine"}');
    return { old, root };
};

/** Every path, type, link target and content under `dir`, hashed: the source must not move. */
const treeHash = (dir: string): string => {
    const hash = createHash('sha256');
    const walk = (at: string) => {
        for (const name of readdirSync(at).sort()) {
            const full = path.join(at, name);
            const st = lstatSync(full);
            hash.update(`${path.relative(dir, full)}|${st.mode}|${st.mtimeMs}\n`);
            if (st.isSymbolicLink()) hash.update(readlinkSync(full));
            else if (st.isDirectory()) walk(full);
            else hash.update(readFileSync(full));
        }
    };
    walk(dir);
    return hash.digest('hex');
};

const MARKER = '.migrated-from-feishin';

test('copy_runs_when_old_exists', async () => {
    const { migrateFromFeishin } = await load();
    const { old, root } = rootWithOld();
    try {
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(out.result, 'copied');
        assert.equal(out.newDir, path.join(root, 'Worbus'));
        for (const rel of [
            'config.json',
            'Local Storage/leveldb/000003.log',
            'IndexedDB/app_0.indexeddb.leveldb/CURRENT',
            'custom.css',
            'Themes/mine.json',
        ]) {
            assert.ok(existsSync(path.join(out.newDir, rel)), `${rel} arrived`);
        }
        assert.equal(
            readFileSync(path.join(out.newDir, 'Local Storage/leveldb/000003.log'), 'utf8'),
            'store\0eq presets',
        );
        const marker = readFileSync(path.join(out.newDir, MARKER), 'utf8');
        assert.match(marker, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /);
        assert.equal(marker.trim().split(' ').slice(1).join(' '), old);
        assert.equal(marker.split('\n').filter(Boolean).length, 1, 'one line');
        assert.ok(out.files! >= 5 && out.bytes! > 0, 'the copy counts what it moved');
        assert.deepEqual(
            readdirSync(root).sort(),
            ['Worbus', 'feishin'],
            'no temporary or moved-aside folder is left beside',
        );
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('copy_runs_once_by_marker', async () => {
    const { migrateFromFeishin } = await load();
    const { old, root } = rootWithOld();
    try {
        const first = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(first.result, 'copied');
        // Worbus changes its own settings; the old app writes again; Worbus starts again.
        writeFileSync(path.join(first.newDir, 'custom.css'), 'worbus own');
        writeFileSync(path.join(old, 'custom.css'), 'feishin later');
        const again = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(again.result, 'already');
        assert.equal(readFileSync(path.join(first.newDir, 'custom.css'), 'utf8'), 'worbus own');
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('copy_after_crashed_first_start', async () => {
    const { migrateFromFeishin } = await load();
    const { root } = rootWithOld();
    try {
        // A first start that died before the marker: a Worbus folder without one.
        const crashed = path.join(root, 'Worbus');
        mkdirSync(crashed);
        writeFileSync(path.join(crashed, 'config.json'), '{"half":true}');
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(out.result, 'copied');
        assert.equal(
            JSON.parse(readFileSync(path.join(out.newDir, 'config.json'), 'utf8')).theme,
            'dark',
        );
        assert.ok(existsSync(path.join(out.newDir, MARKER)));
        // Moved aside, never deleted.
        const aside = readdirSync(root).filter((n) => n.startsWith('Worbus.pre-migration-'));
        assert.equal(aside.length, 1);
        assert.equal(
            readFileSync(path.join(root, aside[0], 'config.json'), 'utf8'),
            '{"half":true}',
        );
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('copy_after_a_killed_copy', async () => {
    const { migrateFromFeishin } = await load();
    const { root } = rootWithOld();
    try {
        // Killed mid-copy: half a temporary copy beside, no Worbus folder.
        mkdirSync(path.join(root, 'Worbus.migrating', 'Local Storage'), { recursive: true });
        writeFileSync(path.join(root, 'Worbus.migrating', 'config.json'), '{"tr');
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(out.result, 'copied');
        assert.equal(
            JSON.parse(readFileSync(path.join(out.newDir, 'config.json'), 'utf8')).theme,
            'dark',
        );
        assert.deepEqual(readdirSync(root).sort(), ['Worbus', 'feishin']);
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('copy_leaves_hub_keys_behind', async () => {
    const { migrateFromFeishin } = await load();
    const { root } = rootWithOld();
    try {
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        const copied = JSON.parse(readFileSync(path.join(out.newDir, 'config.json'), 'utf8'));
        assert.equal('hub' in copied, false);
        assert.equal('hubAuth' in copied, false);
        const rest: Record<string, unknown> = { ...SETTINGS };
        delete rest.hub;
        delete rest.hubAuth;
        assert.deepEqual(copied, rest, 'every other key equal');
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('copy_skips_caches_and_locks', async () => {
    const { migrateFromFeishin } = await load();
    const { old, root } = rootWithOld();
    try {
        symlinkSync(`${hostname()}-999999`, path.join(old, 'SingletonLock'));
        symlinkSync('/tmp/nowhere/SingletonSocket', path.join(old, 'SingletonSocket'));
        writeFileSync(path.join(old, 'SingletonCookie'), '');
        for (const cache of ['Cache', 'Code Cache', 'GPUCache', 'DawnCache']) {
            mkdirSync(path.join(old, cache, 'sub'), { recursive: true });
            writeFileSync(path.join(old, cache, 'sub', 'blob'), 'cached');
        }
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(out.result, 'copied');
        const arrived = readdirSync(out.newDir);
        for (const skipped of [
            'SingletonLock',
            'SingletonSocket',
            'SingletonCookie',
            'Cache',
            'Code Cache',
            'GPUCache',
            'DawnCache',
        ]) {
            assert.ok(!arrived.includes(skipped), `${skipped} is not copied`);
        }
        assert.ok(arrived.includes('Local Storage'));
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('copy_refused_while_old_app_live', async () => {
    const { migrateFromFeishin } = await load();
    const { old, root } = rootWithOld();
    try {
        const seen: string[] = [];
        const out = migrateFromFeishin({
            configRoot: root,
            dev: false,
            isOldAppLive: (dir) => {
                seen.push(dir);
                return true;
            },
        });
        assert.equal(out.result, 'old-live');
        assert.deepEqual(seen, [old]);
        assert.deepEqual(readdirSync(root), ['feishin'], 'nothing created');
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('copy_never_deletes_source', async () => {
    const { migrateFromFeishin } = await load();
    const { old, root } = rootWithOld();
    try {
        symlinkSync(`${hostname()}-999999`, path.join(old, 'SingletonLock'));
        mkdirSync(path.join(old, 'GPUCache'));
        writeFileSync(path.join(old, 'GPUCache', 'data_0'), 'gpu');
        const before = treeHash(old);
        migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(treeHash(old), before, 'the old folder after the copy');
        mkdirSync(path.join(root, 'Worbus-dev'));
        migrateFromFeishin({ configRoot: root, dev: true, isOldAppLive: notLive });
        migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: () => true });
        assert.equal(treeHash(old), before, 'and after every other case');
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('dev_folders_follow_same_rule', async () => {
    const { migrateFromFeishin } = await load();
    const { root } = rootWithOld('feishin-dev');
    try {
        const out = migrateFromFeishin({ configRoot: root, dev: true, isOldAppLive: notLive });
        assert.equal(out.result, 'copied');
        assert.equal(out.newDir, path.join(root, 'Worbus-dev'));
        assert.ok(existsSync(path.join(root, 'Worbus-dev', 'custom.css')));
        assert.ok(!existsSync(path.join(root, 'Worbus')), 'the release folder is not touched');
        assert.equal(
            migrateFromFeishin({ configRoot: root, dev: true, isOldAppLive: notLive }).result,
            'already',
        );
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('no_old_folder_is_fresh_start', async () => {
    const { migrateFromFeishin } = await load();
    const root = mkdtempSync(path.join(tmpdir(), 'worbus-migrate-'));
    try {
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(out.result, 'no-old');
        const marker = readFileSync(path.join(out.newDir, MARKER), 'utf8');
        assert.match(marker, /^\d{4}-\d\d-\d\dT[\d:.]+Z none\n$/);
        // A Feishin installed later is never copied over Worbus's own settings.
        mkdirSync(path.join(root, 'feishin'));
        writeFileSync(path.join(root, 'feishin', 'custom.css'), 'later');
        assert.equal(
            migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive }).result,
            'already',
        );
        assert.ok(!existsSync(path.join(out.newDir, 'custom.css')));
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('lock_names_a_live_process', async () => {
    const { isOldAppLive } = await load();
    const root = mkdtempSync(path.join(tmpdir(), 'worbus-lock-'));
    const lock = path.join(root, 'SingletonLock');
    const minuteAgo = new Date(Date.now() - 60_000);
    const relock = (target: string, at?: Date) => {
        rmSync(lock, { force: true });
        symlinkSync(target, lock);
        if (at) lutimesSync(lock, at, at);
    };
    try {
        assert.equal(isOldAppLive(root), false, 'no lock: not running');
        relock(`${hostname()}-2147483646`, minuteAgo);
        assert.equal(isOldAppLive(root), false, 'a pid that is gone: a crash left the lock');
        relock(`another-host.example-${process.pid}`, minuteAgo);
        assert.equal(isOldAppLive(root), false, 'another machine (a synced folder)');
        relock(`${hostname()}-${process.pid}`);
        assert.equal(isOldAppLive(root), true, 'just taken: the app is opening its socket');
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test(
    'stale_lock_with_a_reused_pid_is_not_live',
    { skip: process.platform !== 'linux' },
    async () => {
        const { isOldAppLive } = await load();
        const root = mkdtempSync(path.join(tmpdir(), 'worbus-lock-'));
        const lock = path.join(root, 'SingletonLock');
        const minuteAgo = new Date(Date.now() - 60_000);
        try {
            // A power cut left Chromium's lock and socket link; after the reboot the pid is some
            // other live process (here: this test runner), and nothing listens on the socket.
            symlinkSync(`${hostname()}-${process.pid}`, lock);
            lutimesSync(lock, minuteAgo, minuteAgo);
            symlinkSync(
                path.join(root, 'gone', 'SingletonSocket'),
                path.join(root, 'SingletonSocket'),
            );
            assert.equal(isOldAppLive(root), false, 'a live pid with no listening socket');
            rmSync(path.join(root, 'SingletonSocket'));
            assert.equal(isOldAppLive(root), false, 'a live pid and no socket link at all');
        } finally {
            rmSync(root, { force: true, recursive: true });
        }
    },
);

test('a_listening_socket_is_live', { skip: process.platform !== 'linux' }, async () => {
    const { isOldAppLive } = await load();
    const root = mkdtempSync(path.join(tmpdir(), 'worbus-lock-'));
    const socketDir = mkdtempSync(path.join(tmpdir(), 'worbus-sock-'));
    const socketPath = path.join(socketDir, 'SingletonSocket');
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
        const lock = path.join(root, 'SingletonLock');
        symlinkSync(`${hostname()}-${process.pid}`, lock);
        const minuteAgo = new Date(Date.now() - 60_000);
        lutimesSync(lock, minuteAgo, minuteAgo);
        symlinkSync(socketPath, path.join(root, 'SingletonSocket'));
        assert.equal(isOldAppLive(root), true, 'a live pid and its socket listening');
    } finally {
        await new Promise((resolve) => server.close(resolve));
        rmSync(root, { force: true, recursive: true });
        rmSync(socketDir, { force: true, recursive: true });
    }
});

/** A process that stays alive (for a lock to name) until it is killed. */
const liveProcess = (command = process.execPath, args = ['-e', 'setTimeout(() => {}, 60000)']) =>
    spawn(command, args, { stdio: 'ignore' });

test('copy_waits_for_a_live_copy', async () => {
    const { migrateFromFeishin } = await load();
    const { root } = rootWithOld();
    const holder = liveProcess();
    try {
        // Another Worbus is copying: its lock, its half-made copy, a Worbus folder without marker.
        writeFileSync(path.join(root, 'Worbus.migrating.lock'), `${hostname()}-${holder.pid}`);
        mkdirSync(path.join(root, 'Worbus.migrating'));
        writeFileSync(path.join(root, 'Worbus.migrating', 'config.json'), '{"half');
        mkdirSync(path.join(root, 'Worbus'));
        writeFileSync(path.join(root, 'Worbus', 'Preferences'), '{}');
        const before = treeHash(root);
        const out = migrateFromFeishin({
            configRoot: root,
            dev: false,
            isOldAppLive: notLive,
            waitMs: 300,
        });
        assert.equal(out.result, 'busy', 'it waited, then gave way');
        assert.equal(treeHash(root), before, 'nothing deleted, moved or created');
    } finally {
        holder.kill();
        rmSync(root, { force: true, recursive: true });
    }
});

test('copy_lock_left_by_a_crash_is_taken_over', async () => {
    const { migrateFromFeishin } = await load();
    const holders: [string, string][] = [
        ['a dead pid', `${hostname()}-2147483646`],
        ['another machine (a synced folder)', `another-host.example-${process.pid}`],
    ];
    {
        for (const [why, content] of holders) {
            const { root } = rootWithOld();
            try {
                const lock = path.join(root, 'Worbus.migrating.lock');
                writeFileSync(lock, content);
                mkdirSync(path.join(root, 'Worbus.migrating'));
                writeFileSync(path.join(root, 'Worbus.migrating', 'config.json'), '{"tr');
                const out = migrateFromFeishin({
                    configRoot: root,
                    dev: false,
                    isOldAppLive: notLive,
                    waitMs: 5000,
                });
                assert.equal(out.result, 'copied', why);
                assert.equal(
                    JSON.parse(readFileSync(path.join(out.newDir, 'config.json'), 'utf8')).theme,
                    'dark',
                    why,
                );
                assert.deepEqual(readdirSync(root).sort(), ['Worbus', 'feishin'], why);
            } finally {
                rmSync(root, { force: true, recursive: true });
            }
        }
    }
});

test('fresh_lock_of_another_program_is_waited_on', async () => {
    const { migrateFromFeishin } = await load();
    const { root } = rootWithOld();
    // An AppImage mounts at a new path every launch: the copying launch's program path is not
    // this one's. Its lock is fresh, so it is a live copy all the same.
    const holder = liveProcess('sleep', ['60']);
    try {
        writeFileSync(path.join(root, 'Worbus.migrating.lock'), `${hostname()}-${holder.pid}`);
        mkdirSync(path.join(root, 'Worbus.migrating'));
        writeFileSync(path.join(root, 'Worbus.migrating', 'config.json'), '{"half');
        const before = treeHash(root);
        const out = migrateFromFeishin({
            configRoot: root,
            dev: false,
            isOldAppLive: notLive,
            waitMs: 300,
        });
        assert.equal(out.result, 'busy', 'waited on, not taken over');
        assert.equal(treeHash(root), before, 'nothing deleted, moved or created');
    } finally {
        holder.kill();
        rmSync(root, { force: true, recursive: true });
    }
});

test('unrefreshed_lock_with_a_live_pid_is_taken_over', async () => {
    const { migrateFromFeishin } = await load();
    const { root } = rootWithOld();
    // A copy that died; its pid now belongs to a live process (here: this runtime, the same
    // program). Its lock has not been touched for longer than the bound.
    const reused = liveProcess();
    try {
        const lock = path.join(root, 'Worbus.migrating.lock');
        writeFileSync(lock, `${hostname()}-${reused.pid}`);
        const untouched = new Date(Date.now() - 120_000);
        utimesSync(lock, untouched, untouched);
        mkdirSync(path.join(root, 'Worbus.migrating'));
        writeFileSync(path.join(root, 'Worbus.migrating', 'config.json'), '{"tr');
        const out = migrateFromFeishin({
            configRoot: root,
            dev: false,
            isOldAppLive: notLive,
            waitMs: 300,
        });
        assert.equal(out.result, 'copied', 'a lock untouched past the bound is a dead copy');
        assert.deepEqual(readdirSync(root).sort(), ['Worbus', 'feishin']);
    } finally {
        reused.kill();
        rmSync(root, { force: true, recursive: true });
    }
});

test('stray_lock_drafts_are_cleaned', async () => {
    const { migrateFromFeishin } = await load();
    const { root } = rootWithOld();
    const waiting = liveProcess();
    try {
        // Launches killed while waiting or taking over left their per-launch files; one launch
        // is still waiting (alive): its draft stays.
        writeFileSync(path.join(root, 'Worbus.migrating.lock.2147483646'), 'x');
        writeFileSync(path.join(root, 'Worbus.migrating.lock.stale-2147483645'), 'x');
        const live = `Worbus.migrating.lock.${waiting.pid}`;
        writeFileSync(path.join(root, live), 'x');
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(out.result, 'copied');
        assert.deepEqual(readdirSync(root).sort(), [live, 'Worbus', 'feishin'].sort());
    } finally {
        waiting.kill();
        rmSync(root, { force: true, recursive: true });
    }
});

test('busy_says_so_in_a_dialog', () => {
    const firstStart = readFileSync(new URL('./first-start.ts', import.meta.url), 'utf8');
    assert.ok(firstStart.includes("'Worbus is already starting'"), 'the busy title');
    assert.ok(
        firstStart.includes(
            "'Another Worbus is still copying your Feishin settings. Its window opens when the copy is done. If none opens, start Worbus again.'",
        ),
        'the busy body',
    );
    // Every launch that stops at the first start shows its dialog: none quits silently.
    assert.match(firstStart, /busy: \{ body: BUSY_BODY, title: BUSY_TITLE \}/);
    const stopped = firstStart.slice(firstStart.indexOf('if (stop) {'));
    assert.ok(stopped.length > 0 && firstStart.includes('if (stop) {'), 'one stop branch');
    const ready = stopped.slice(stopped.indexOf('whenReady'), stopped.indexOf('app.exit(0)'));
    assert.match(ready, /^whenReady\(\)\.then\(\(\) => \{\s*dialog\.showMessageBoxSync\(/);
});

/** Two copies in two processes, started together on a big old folder; their results. */
const race = async (files: number, staleMs?: number, kb = 100) => {
    const { old, root } = rootWithOld();
    const scripts = mkdtempSync(path.join(tmpdir(), 'worbus-race-'));
    try {
        // Big enough that the two copies overlap.
        const blobs = path.join(old, 'IndexedDB', 'app_0.indexeddb.blob');
        mkdirSync(blobs);
        const chunk = Buffer.alloc(kb * 1024, 7);
        for (let i = 0; i < files; i += 1) writeFileSync(path.join(blobs, `${i}`), chunk);
        const script = path.join(scripts, 'copy.mjs');
        writeFileSync(
            script,
            `import { migrateFromFeishin } from ${JSON.stringify(new URL('./migrate-from-feishin.ts', import.meta.url).href)};
const go = Number(process.argv[2]);
while (Date.now() < go);
try {
    const staleMs = process.argv[4] ? Number(process.argv[4]) : undefined;
    const out = migrateFromFeishin({ configRoot: process.argv[3], dev: false, isOldAppLive: () => false, staleMs });
    process.stdout.write(out.result);
} catch (error) {
    process.stdout.write('ERROR ' + error);
}
`,
        );
        const go = Date.now() + 1500;
        const run = () =>
            new Promise<string>((resolve) => {
                const args = [script, String(go), root];
                if (staleMs) args.push(String(staleMs));
                const child = spawn(process.execPath, args);
                let out = '';
                child.stdout.on('data', (data) => (out += data));
                child.on('close', () => resolve(out));
            });
        const started = Date.now();
        const results = (await Promise.all([run(), run()])).sort();
        return {
            arrived: existsSync(path.join(root, 'Worbus', MARKER))
                ? readdirSync(path.join(root, 'Worbus', 'IndexedDB', 'app_0.indexeddb.blob')).length
                : 0,
            entries: readdirSync(root).sort(),
            ms: Date.now() - started - 1500,
            results,
        };
    } finally {
        rmSync(scripts, { force: true, recursive: true });
        rmSync(root, { force: true, recursive: true });
    }
};

test('two_concurrent_copies_copy_once', async () => {
    const out = await race(400);
    assert.deepEqual(out.results, ['already', 'copied'], 'one copies, the other waits for it');
    assert.deepEqual(out.entries, ['Worbus', 'feishin'], 'nothing moved aside');
    assert.equal(out.arrived, 400);
});

test('heartbeat_keeps_a_long_copy_held', async () => {
    // A copy far longer than the stale bound (here 250 ms): only the holder's heartbeat keeps the
    // waiting launch from taking its lock over.
    const out = await race(6000, 250, 4);
    assert.ok(out.ms > 500, `the copy outlasts the bound twice or more (${out.ms} ms)`);
    assert.deepEqual(out.results, ['already', 'copied'], 'one copies, the other waits for it');
    assert.deepEqual(out.entries, ['Worbus', 'feishin'], 'nothing moved aside');
    assert.equal(out.arrived, 6000);
});

test('copy_counts_only_what_it_wrote', async () => {
    const { migrateFromFeishin } = await load();
    const { old, root } = rootWithOld();
    try {
        writeFileSync(path.join(old, 'config.json'), '{"truncated');
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(out.result, 'copied');
        assert.ok(!existsSync(path.join(out.newDir, 'config.json')), 'not written (F-R11)');
        let files = 0;
        let bytes = 0;
        const walk = (at: string) => {
            for (const name of readdirSync(at)) {
                const full = path.join(at, name);
                const st = lstatSync(full);
                if (st.isDirectory()) walk(full);
                else if (name !== MARKER) {
                    files += 1;
                    bytes += st.size;
                }
            }
        };
        walk(out.newDir);
        assert.equal(out.files, files, 'the log counts the files that arrived');
        assert.equal(out.bytes, bytes, 'and their bytes');
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('migrated_from_reads_the_marker', async () => {
    const { migratedFrom, migrateFromFeishin } = await load();
    const { old, root } = rootWithOld();
    try {
        assert.equal(migratedFrom(path.join(root, 'Worbus')), null, 'no marker');
        const out = migrateFromFeishin({ configRoot: root, dev: false, isOldAppLive: notLive });
        assert.equal(migratedFrom(out.newDir), old);
        const fresh = mkdtempSync(path.join(tmpdir(), 'worbus-migrate-'));
        const none = migrateFromFeishin({ configRoot: fresh, dev: false, isOldAppLive: notLive });
        assert.equal(migratedFrom(none.newDir), null, 'a fresh start migrated nothing');
        rmSync(fresh, { force: true, recursive: true });
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('the copy is the main process first import', () => {
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const firstImport = index.match(/^import (?!type\b).*$/m)?.[0];
    assert.equal(firstImport, "import './first-start';");
    const firstStart = readFileSync(new URL('./first-start.ts', import.meta.url), 'utf8');
    // Nothing that reads the settings path may load before the copy has run.
    for (const line of firstStart.match(/^import .*$/gm) ?? []) {
        assert.match(line, /from '(electron|node:[a-z]+|\.\/migrate-from-feishin)'/, line);
    }
});

test('the fixed sentences are said where the plan puts them', () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    const firstStart = read('./first-start.ts');
    assert.ok(firstStart.includes("'Close Feishin first'"), 'the dialog title');
    assert.ok(
        firstStart.includes(
            "'Worbus copies your Feishin settings the first time it starts. Close Feishin, then start Worbus again.'",
        ),
        'the dialog body',
    );
    assert.match(firstStart, /buttons: \['Quit'\]/);
    const settings = read('./features/core/settings/index.ts');
    assert.ok(
        settings.includes(
            `"Your saved password couldn't be read after the move from Feishin. Sign in again."`,
        ),
        'the password sentence',
    );
    // An unreadable password after the move is said and answered with no password (the server's
    // sign-in), never removed: the old app still reads it.
    const handler = settings.slice(settings.indexOf("ipcMain.handle('password-get'"));
    const getter = handler.slice(0, handler.indexOf('\n});'));
    assert.match(getter, /if \(!migratedFrom\(storePath\)\) throw error;/);
    // Said once per server and session, the log line too (the 401 paths ask again and again).
    const once = getter.indexOf('if (!unreadableAfterMove.has(server))');
    assert.ok(once > 0, 'a once-per-server guard');
    assert.ok(
        getter.indexOf("log.warn('Saved password unreadable") > once,
        'the warning is logged inside the once-per-server guard',
    );
    assert.match(getter, /return null;\s*\}\s*\}/);
    assert.doesNotMatch(getter, /delete |store\.set|store\.delete/);
});
