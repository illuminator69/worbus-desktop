import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { diagnosticsEntries, diagnosticsHeader, redact, REDACTED } from './redact.ts';
import { createZipBuffer } from './utils/zip.ts';

/**
 * Worbus P4 lane F, F2:  node --test src/main/diagnostics-redaction.harness.ts
 *
 * Export diagnostics (Settings › Advanced › Logger) is the file a tester attaches to an issue
 * (design §6.8). Every file in its zip goes through one redaction rule, the same as Navic's
 * Share logs (`redaction-vectors.json`, copied verbatim from the controller's ruling R2), plus
 * Feishin's own: every value under main-config.json's `server` record, the saved passwords.
 */

const ROOT = path.resolve(import.meta.dirname, '../..');

const VECTORS = JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'redaction-vectors.json'), 'utf8'),
) as { cases: { input: string; name: string; output: string }[]; mark: string };

test('redact_matches_navic_vectors', () => {
    assert.equal(VECTORS.mark, REDACTED);
    assert.equal(VECTORS.cases.length, 25);
    for (const c of VECTORS.cases) {
        assert.equal(redact(c.input), c.output, c.name);
    }
});

test('redaction is idempotent on its own output', () => {
    for (const c of VECTORS.cases) {
        assert.equal(redact(c.output), c.output, c.name);
    }
});

/** Read every entry of a zip `createZipBuffer` made (local headers, deflate). */
const unzip = (zip: Buffer): Map<string, string> => {
    const files = new Map<string, string>();
    let at = 0;
    while (zip.readUInt32LE(at) === 0x04034b50) {
        const size = zip.readUInt32LE(at + 18);
        const nameLength = zip.readUInt16LE(at + 26);
        const extraLength = zip.readUInt16LE(at + 28);
        const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
        const start = at + 30 + nameLength + extraLength;
        files.set(name, inflateRawSync(zip.subarray(start, start + size)).toString('utf8'));
        at = start + size;
    }
    return files;
};

// Made-up values, each distinctive enough that finding it anywhere is a leak.
const ND_PASSWORD = 'planted-nd-pass-7f3a';
const ND_PASSWORD_CIPHERTEXT = '763130b4c1d2e3f4planted';
const DEVICE_SECRET = 'planted-device-secret-91c4';
const AUDIOMUSE_TOKEN = 'planted-audiomuse-token-5e2b';
const HUB_TOKEN = 'planted-hub-token-0d8e';
const SUBSONIC_T = 'plantedtoken3c9d';
const SUBSONIC_S = 'plantedsalt88aa';
const BEARER = 'planted.bearer.jwt42';
const INSPECTED_SECRET = 'planted-inspected-6b1f';
const PLANTED = [
    ND_PASSWORD,
    ND_PASSWORD_CIPHERTEXT,
    DEVICE_SECRET,
    AUDIOMUSE_TOKEN,
    HUB_TOKEN,
    SUBSONIC_T,
    SUBSONIC_S,
    BEARER,
    INSPECTED_SECRET,
];

const exportFiles = (serverVersion: null | string) => {
    const config = {
        __internal__: { migrations: { version: '0.4.0' } },
        hubAuth: { deviceIds: { 'id:abc': 'd-1' }, secret: DEVICE_SECRET, signedIn: true },
        ignore_cors: false,
        // Electron's safeStorage ciphertext of the Navidrome password, keyed by server id: the
        // field rule cannot see it (the key is an id), so Feishin's own rule names the record.
        server: { 'b1c2d3e4-server-id': ND_PASSWORD_CIPHERTEXT, plain: ND_PASSWORD },
        window_window_bar_style: 'linux',
    };
    const renderer = {
        audioMuse: { token: AUDIOMUSE_TOKEN, url: 'http://am.local:8000' },
        hub: { enabled: true, name: 'Feishin', token: HUB_TOKEN, url: 'ws://192.168.1.20:4790' },
        lastPlayed: `https://nd.example.org/rest/stream?u=bob&t=${SUBSONIC_T}&s=${SUBSONIC_S}&id=1`,
    };
    const log = [
        `2026-11-06T10:00:00.000Z INFO  [renderer] GET https://nd.example.org/rest/stream?u=bob&t=${SUBSONIC_T}&s=${SUBSONIC_S}&v=1.16.1&c=feishin&id=tr-1`,
        `2026-11-06T10:00:01.000Z DEBUG [main]     hub hello {"t":"hello","deviceSecret":"${DEVICE_SECRET}","name":"Feishin"}`,
        `2026-11-06T10:00:02.000Z DEBUG [main]     audiomuse request Authorization: Bearer ${BEARER}`,
        `2026-11-06T10:00:03.000Z DEBUG [renderer] audiomuse apiKey=${AUDIOMUSE_TOKEN} ok`,
        `2026-11-06T10:00:04.000Z DEBUG [renderer] sign in {"username":"bob","password":"${ND_PASSWORD}"}`,
        // An object logged by electron-log goes through util.inspect (logger.ts), one field a line.
        `2026-11-06T10:00:05.000Z DEBUG [main]     hub auth {`,
        `  deviceSecret: '${INSPECTED_SECRET}',`,
        `  'api-key': '${INSPECTED_SECRET}',`,
        `  name: 'Feishin'`,
        `}`,
        `2026-11-06T10:00:06.000Z INFO  [main]     Player: track changed to 3 of 12 (id=tr-1)`,
        '',
    ].join('\n');
    const entries = diagnosticsEntries({
        configRaw: JSON.stringify(config),
        diagnostics: {
            app: { name: 'Feishin', version: '0.4.0 (c812df4)' },
            server: { name: 'Home', type: 'navidrome', url: REDACTED },
            serverVersion,
        },
        header: diagnosticsHeader({
            appVersion: '0.4.0 (c812df4)',
            arch: 'x64',
            electron: '43.7.0',
            exportedAt: '2026-11-06T10:00:06.000Z',
            os: 'Linux 6.8.0',
            serverVersion,
        }),
        logs: [{ data: Buffer.from(log, 'utf8'), name: 'logs/main.log' }],
        rendererSettings: renderer,
    });
    return unzip(createZipBuffer(entries));
};

test('export_has_no_planted_secret', () => {
    const files = exportFiles(null);
    assert.deepEqual([...files.keys()].sort(), [
        'diagnostics.json',
        'header.txt',
        'logs/main.log',
        'main-config.json',
        'renderer-settings.json',
    ]);
    for (const [name, text] of files) {
        for (const secret of PLANTED) {
            assert.ok(!text.includes(secret), `${name} holds a planted secret`);
        }
    }
    const all = [...files.values()].join('\n');
    assert.ok(all.includes(REDACTED));
    // What the files are for is still there.
    const config = JSON.parse(files.get('main-config.json')!);
    assert.deepEqual(config.server, { 'b1c2d3e4-server-id': REDACTED, plain: REDACTED });
    assert.equal(config.hubAuth.signedIn, true);
    assert.equal(config.window_window_bar_style, 'linux');
    const renderer = JSON.parse(files.get('renderer-settings.json')!);
    assert.equal(renderer.audioMuse.url, 'http://am.local:8000');
    assert.equal(renderer.hub.url, 'ws://192.168.1.20:4790');
    assert.match(files.get('logs/main.log')!, /Player: track changed to 3 of 12 \(id=tr-1\)/);
    assert.match(
        files.get('logs/main.log')!,
        /\n {2}deviceSecret: '\[removed\]',\n {2}'api-key': '\[removed\]',\n {2}name: 'Feishin'\n/,
    );
    assert.match(
        files.get('logs/main.log')!,
        /stream\?u=\[removed\]&t=\[removed\]&s=\[removed\]&v=1\.16\.1/,
    );
});

test('the header names the app, the system and the server version, or says it is unknown', () => {
    const unknown = exportFiles(null).get('header.txt')!;
    assert.match(unknown, /^Feishin 0\.4\.0 \(c812df4\)\n/);
    assert.match(unknown, /\nLinux 6\.8\.0 \(x64\)\n/);
    assert.match(unknown, /\nElectron 43\.7\.0\n/);
    assert.match(unknown, /\nserver version unknown\n/);
    const known = exportFiles('0.4.0 (678af87)').get('header.txt')!;
    assert.match(known, /\nWorbus Server 0\.4\.0 \(678af87\)\n/);
});

test('the export in Settings › Advanced › Logger writes every file through the rule', () => {
    const logger = readFileSync(path.join(ROOT, 'src/main/logger.ts'), 'utf8');
    assert.match(logger, /createZipBuffer\(\s*diagnosticsEntries\(/);
    // No file reaches the zip around the rule.
    assert.doesNotMatch(logger, /entries\.push\(/);
    assert.match(logger, /serverVersionNow\(\)/);
    const settings = readFileSync(
        path.join(ROOT, 'src/renderer/features/settings/components/advanced/logger-settings.tsx'),
        'utf8',
    );
    assert.match(settings, /utils\.exportDiagnostics\(/, 'the button stays where it was');
});
