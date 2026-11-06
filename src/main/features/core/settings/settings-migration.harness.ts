import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { versionLine } from '../../../../shared/utils/version-line.ts';
import { SETTINGS_MIGRATIONS } from './migrations.ts';

/**
 * Worbus P4 lane F, F1:  node --test src/main/features/core/settings/settings-migration.harness.ts
 *
 * The version goes down to 0.4.0 (design §6.7). The main store's migrations are keyed on the app
 * version, so the store then records 0.4.0, and the first build at 1.0.0 or later would have run
 * upstream's `'>=1.0.0': store.clear()`, wiping the device secret (`hubAuth`) and the saved
 * passwords (`server`). These run the real migrations through the real `conf` (electron-store's
 * base class; electron-store itself needs Electron's `app`).
 */

const require = createRequire(import.meta.url);
// `conf` is electron-store's own dependency (pnpm does not hoist it): resolve it from there.
const Conf = createRequire(require.resolve('electron-store'))('conf') as new (options: {
    configName: string;
    cwd: string;
    migrations: typeof SETTINGS_MIGRATIONS;
    projectVersion: string;
}) => { get: (key: string) => unknown; path: string };

const ROOT = path.resolve(import.meta.dirname, '../../../../..');

const HUB_AUTH = { deviceId: 'dev-planted', marker: 'enc', secret: 'ciphertext-planted' };
const SERVERS = { 'server-1': 'a1b2c3-encrypted-password-hex' };

/** A store file as an app at `recorded` left it. */
const storeAt = (recorded: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'feishin-store-'));
    writeFileSync(
        path.join(dir, 'config.json'),
        JSON.stringify({
            __internal__: { migrations: { version: recorded } },
            hubAuth: HUB_AUTH,
            hubServer: { addresses: [], serverId: 'f'.repeat(32) },
            server: SERVERS,
        }),
    );
    return dir;
};

const open = (cwd: string, appVersion: string) =>
    new Conf({
        configName: 'config',
        cwd,
        migrations: SETTINGS_MIGRATIONS,
        projectVersion: appVersion,
    });

test('store_at_0_4_survives_1_0_start', () => {
    const cwd = storeAt('0.4.0');
    try {
        const store = open(cwd, '1.0.0');
        assert.deepEqual(store.get('hubAuth'), HUB_AUTH, 'the device secret is kept');
        assert.deepEqual(store.get('server'), SERVERS, 'the saved passwords are kept');
        assert.equal((store.get('hubServer') as { serverId: string }).serverId, 'f'.repeat(32));
    } finally {
        rmSync(cwd, { force: true, recursive: true });
    }
});

test('a store an upstream-numbered build left (1.17.0) survives the 0.4.0 start, then 1.0.0', () => {
    const cwd = storeAt('1.17.0');
    try {
        open(cwd, '0.4.0');
        const recorded = JSON.parse(readFileSync(path.join(cwd, 'config.json'), 'utf8'));
        assert.equal(recorded.__internal__.migrations.version, '0.4.0', 'the store records 0.4.0');
        const later = open(cwd, '1.0.0');
        assert.deepEqual(later.get('hubAuth'), HUB_AUTH);
        assert.deepEqual(later.get('server'), SERVERS);
    } finally {
        rmSync(cwd, { force: true, recursive: true });
    }
});

test('no migration clears the store', () => {
    const source = readFileSync(
        path.join(ROOT, 'src/main/features/core/settings/migrations.ts'),
        'utf8',
    );
    assert.doesNotMatch(source, /\.clear\(\)/);
    const index = readFileSync(path.join(ROOT, 'src/main/features/core/settings/index.ts'), 'utf8');
    assert.match(index, /migrations: SETTINGS_MIGRATIONS/, 'the store runs these migrations');
    assert.doesNotMatch(index, /store\.clear\(\)/);
});

test('version_line_formats', () => {
    assert.equal(versionLine('0.4.0', '4bc5137', true), '0.4.0 (4bc5137)');
    assert.equal(versionLine('0.4.0', '4bc5137', false), '0.4.0-dev (4bc5137)');
    // A build without git says so rather than an empty pair of brackets.
    assert.equal(versionLine('0.4.0', '', true), '0.4.0 (unknown)');
});

test('package.json is 0.4.0', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.version, '0.4.0');
});

test('both menus and the startup log use the version line; the build injects the commit', () => {
    const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
    assert.match(read('src/main/menu.ts'), /appVersionLine\(packageJson\.version\)/);
    assert.match(
        read('src/renderer/features/titlebar/components/app-menu.tsx'),
        /appVersionLine\(currentVersion\)/,
    );
    const config = read('electron.vite.config.ts');
    assert.match(config, /__WORBUS_COMMIT__/);
    assert.match(config, /__WORBUS_RELEASE__/);
    assert.match(config, /git rev-parse --short=7 HEAD/);
});
