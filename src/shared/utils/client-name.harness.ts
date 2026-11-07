import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Worbus P5 lane F, F1:  node --test src/shared/utils/client-name.harness.ts
 *
 * The desktop app's own names (design §6.1, §6.2, §6.7): the Subsonic client name every request
 * builder sends (Navidrome's Players list shows it), the default device name, the app ID in
 * electron-builder.yml and package.json, and the metainfo named after the app ID. The module is
 * imported inside each test so that, before it exists, each test fails on its own.
 */

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (rel: string): string => {
    const full = join(ROOT, rel);
    assert.ok(existsSync(full), `${rel} must exist (a missing file would check nothing)`);
    return readFileSync(full, 'utf8');
};
const load = () => import('./client-name.ts');

const yamlValue = (yaml: string, key: string): string | undefined =>
    yaml.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'))?.[1]?.replace(/^['"]|['"]$/g, '');

const BUILDERS = [
    'src/renderer/api/subsonic/subsonic-api.ts',
    'src/renderer/api/subsonic/subsonic-controller.ts',
];

test('client_name_is_worbus', async () => {
    let sites = 0;
    for (const rel of BUILDERS) {
        const code = read(rel);
        // `c: …` in a params object, `c=…` in a hand-built URL: each must be the constant.
        for (const m of code.matchAll(/\bc:\s*([^,\n}]+)/g)) {
            assert.equal(m[1].trim(), 'CLIENT_NAME', `${rel}: c: ${m[1].trim()}`);
            sites += 1;
        }
        for (const m of code.matchAll(/[?&]c=([^&'"`\s]*)/g)) {
            assert.equal(m[1], '${CLIENT_NAME}', `${rel}: c=${m[1]}`);
            sites += 1;
        }
    }
    // Eight places on the base: subsonic-api's three params objects; the cover, download and
    // stream URLs, the transcode-offset params and the sign-in query in the controller.
    assert.ok(sites >= 8, `expected every request builder, found ${sites}`);

    // The transcode decision's client name is the same constant.
    const controller = read('src/renderer/api/subsonic/subsonic-controller.ts');
    assert.match(controller, /name:\s*CLIENT_NAME,\s*\n\s*platform:/);
    // Jellyfin's header names the product, not the Subsonic client id.
    assert.match(read('src/renderer/api/jellyfin/jellyfin-api.ts'), /MediaBrowser Client="Worbus"/);

    const { CLIENT_NAME, userAgent } = await load();
    assert.equal(CLIENT_NAME, 'Worbus-Desktop');
    assert.equal(userAgent('0.6.0'), 'Worbus-Desktop/0.6.0');
});

test('default_device_name', async () => {
    const { defaultDeviceName } = await load();
    assert.equal(defaultDeviceName(' desk-pc '), 'desk-pc');
    assert.equal(defaultDeviceName(''), 'Worbus');
    assert.equal(defaultDeviceName('   '), 'Worbus');
    assert.equal(defaultDeviceName(undefined), 'Worbus');
});

test('saved_device_name_kept', async () => {
    const { deviceName } = await load();
    // A name the person typed is never replaced by the hostname.
    assert.equal(deviceName('Living room', 'desk-pc'), 'Living room');
    assert.equal(deviceName('  Desk ', 'desk-pc'), 'Desk');
    // Nothing saved, or the old app's default that nobody chose: the computer's own name.
    assert.equal(deviceName('', 'desk-pc'), 'desk-pc');
    assert.equal(deviceName(undefined, 'desk-pc'), 'desk-pc');
    assert.equal(deviceName('Feishin', 'desk-pc'), 'desk-pc');
    assert.equal(deviceName('', ''), 'Worbus');
});

test('builder_config_ids', () => {
    const builder = read('electron-builder.yml');
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    assert.equal(yamlValue(builder, 'appId'), 'app.worbus.desktop');
    assert.equal(yamlValue(builder, 'productName'), 'Worbus');
    assert.equal(yamlValue(builder, 'executableName'), 'worbus');
    assert.equal(pkg.productName, 'Worbus', 'package.json productName names the settings folder');
    assert.equal(pkg.name, 'worbus');
    assert.equal(pkg.version, '0.6.0');
    assert.match(builder, /^\s+repo:\s*worbus-desktop\s*$/m, 'the publish block is the fork');
    // The packaged entry groups the window: its WM_CLASS is ("worbus", "worbus") (walk, X11).
    assert.match(builder, /^\s+StartupWMClass:\s*worbus\s*$/m);

    const desktop = read('worbus.desktop.tmpl');
    assert.match(desktop, /^Name=Worbus$/m);
    assert.match(desktop, /^Icon=app\.worbus\.desktop$/m);
    assert.match(desktop, /^StartupWMClass=worbus$/m);
});

test('metainfo_id_matches_app_id', () => {
    const appId = yamlValue(read('electron-builder.yml'), 'appId');
    const metainfos = readdirSync(ROOT).filter((f) => f.endsWith('.metainfo.xml'));
    assert.deepEqual(metainfos, [`${appId}.metainfo.xml`]);
    const xml = read(`${appId}.metainfo.xml`);
    assert.match(xml, new RegExp(`<id>${appId!.replace(/\./g, '\\.')}</id>`));
    assert.match(xml, /<name>Worbus<\/name>/);
    assert.match(xml, new RegExp(`<launchable type="desktop-id">${appId}\\.desktop</launchable>`));
    assert.match(xml, /<developer id="[^"]*">\s*<name>illuminator69<\/name>/);
    // P6: the two screenshots are Worbus's own, at the umbrella's raw URLs (upstream's are gone).
    const urls = [...xml.matchAll(/<image\b[^>]*>([^<]+)<\/image>/g)].map((m) => m[1].trim());
    assert.equal(urls.length, 2);
    for (const url of urls) {
        assert.match(
            url,
            /^https:\/\/raw\.githubusercontent\.com\/illuminator69\/worbus\/main\/docs\/screenshots\/0\.6\//,
        );
    }
    assert.match(xml, /<release [^>]*version="0\.6\.0"/);
    for (const script of [
        'scripts/after-all-artifact-build.mjs',
        'scripts/update-app-stream.mjs',
    ]) {
        assert.ok(read(script).includes(`${appId}.metainfo.xml`), `${script} names the new file`);
    }
});
