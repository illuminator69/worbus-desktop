import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
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
    try {
        assert.equal(isOldAppLive(root), false, 'no lock: not running');
        const lock = path.join(root, 'SingletonLock');
        symlinkSync(`${hostname()}-${process.pid}`, lock);
        assert.equal(isOldAppLive(root), true, 'this host, a live pid');
        rmSync(lock);
        symlinkSync(`${hostname()}-2147483646`, lock);
        assert.equal(isOldAppLive(root), false, 'a pid that is gone: a crash left the lock');
        rmSync(lock);
        symlinkSync(`another-host.example-${process.pid}`, lock);
        assert.equal(isOldAppLive(root), false, 'another machine (a synced folder)');
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
    assert.match(getter, /return null;\s*\}\s*\}/);
    assert.doesNotMatch(getter, /delete |store\.set|store\.delete/);
});
