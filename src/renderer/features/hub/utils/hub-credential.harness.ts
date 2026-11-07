import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import { moodsShown } from '../../moods/mood-mix.ts';
import { hubLink, isHubConfigured } from '../../settings/components/server/server-status.ts';
import { hasHubCredential, hasTypedToken, hubSecretHeld, hubSetUp } from './hub-credential.ts';

/**
 * Worbus P2 lane F, review C1:  node --test src/renderer/features/hub/utils/hub-credential.harness.ts
 *
 * Main moved every hub client to `hubAuth.bearer()` (the device secret, else a typed token), but
 * the renderer kept deciding "is the hub set up" from the typed `hub.token`. A device signed in
 * with one tap has no token, so moods, the lb-bot index mirror (and the Library Artists lookup it
 * gates) and AudioMuse through the hub were all off on it, silently. One predicate now answers
 * "has a hub credential", and a source guard fails on a new token test anywhere in the renderer.
 */

const HUB = { enabled: true, token: '', url: 'ws://hub.lan:4790' };
const SIGNED_IN = { authOwed: false, authSignedIn: true };
const OWED = { authOwed: true, authSignedIn: false };
const NONE = { authOwed: false, authSignedIn: false };

test('signed in without a token the hub is set up', () => {
    assert.equal(hubSetUp(HUB, hubSecretHeld(SIGNED_IN)), true, 'a secret, no token');
    assert.equal(hubSetUp(HUB, hubSecretHeld(OWED)), true, 'a silent sign-in under way');
    assert.equal(hubSetUp(HUB, hubSecretHeld(NONE)), false, 'nothing to connect with');
    assert.equal(hubSetUp({ ...HUB, token: 'typed' }, false), true, 'a typed token, as before');
    assert.equal(hubSetUp({ ...HUB, token: '   ' }, false), false, 'blank is no token');
    assert.equal(hubSetUp({ ...HUB, enabled: false }, true), false, 'Connect off');
    assert.equal(hubSetUp({ ...HUB, url: '' }, true), false, 'no address');
    assert.equal(hubSetUp(undefined, true), false);
    assert.equal(hasHubCredential(HUB, true), true);
    assert.equal(hasTypedToken(HUB), false);

    // Moods (Home's catalogue and the mood client) follow the same predicate.
    assert.equal(
        moodsShown({ electron: true, hub: HUB, secretHeld: true, serverType: 'navidrome' }),
        true,
    );
    assert.equal(
        moodsShown({ electron: true, hub: HUB, secretHeld: false, serverType: 'navidrome' }),
        false,
    );

    // The Server tab: a signed-in device on the default address is set up, not "Not set up".
    const link = {
        attemptAt: 0,
        authRefused: false,
        connected: true,
        enabled: true,
        now: 1,
        token: '',
        url: 'ws://localhost:4790',
    };
    assert.equal(hubLink({ ...link, signedIn: true }), 'connected');
    assert.equal(
        hubLink({ ...link, connected: false, now: 60_000, signedIn: true }),
        'unreachable',
    );
    assert.equal(hubLink({ ...link, connected: false }), 'notConfigured');
    assert.equal(isHubConfigured({ enabled: false, signedIn: true, token: '', url: '' }), true);
});

// --- the sites -----------------------------------------------------------------------------------

const here = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(here(path), 'utf8');

test('every renderer hub-is-set-up check reads the credential predicate', () => {
    const muse = read('../../player/auto-dj/audio-muse-source.ts');
    assert.match(muse, /const hubRouteConfigured = \(\): boolean => hubSetUpNow\(\);/);
    const mirror = read('../../lbbot/index-mirror/index-mirror.ts');
    assert.match(mirror, /export const mirrorShown = \(\): boolean => hubSetUpNow\(\);/);
    assert.match(mirror, /export const useMirrorShown = \(\): boolean => useHubSetUp\(\);/);
    // The mirror's readers re-render when a sign-in arrives, not only when a setting moves.
    assert.match(
        mirror,
        /useHubStore\.subscribe\(\(state, prev\) => \{\s*if \(hubSecretHeld\(state\) !== hubSecretHeld\(prev\)\) notify\(\);/,
    );
    const moods = read('../../moods/mood-client.ts');
    assert.match(moods, /moodsShown\(\{[^}]*secretHeld: useHubSecretHeld\(\)/);
    // An owed sign-in counts while it runs: main's needsSignIn at start, the server's 4005.
    const actions = read('./hub-signin-actions.ts');
    assert.match(
        actions,
        /setStore\(\{ authOwed: state\.needsSignIn, authSignedIn: state\.signedIn \}\)/,
    );
    assert.match(actions, /setStore\(\{ authOwed: false \}\);/, 'any answer settles it');
    const useHub = read('../hooks/use-hub.tsx');
    assert.match(
        useHub,
        /setStore\(\{ authOwed: true, authSignedIn: false, user: null \}\);\s*void silentSignIn\.signedOut\(\);/,
    );
    const store = read('../../../store/hub-set-up.ts');
    assert.match(
        store,
        /hubSetUp\(useSettingsStore\.getState\(\)\.hub, hubSecretHeld\(useHubStore\.getState\(\)\)\)/,
    );
});

const walk = (dir: URL): string[] =>
    readdirSync(dir).flatMap((name) => {
        const child = new URL(`${name}`, dir);
        if (statSync(child).isDirectory()) return walk(new URL(`${name}/`, dir));
        return /\.(ts|tsx)$/.test(name) && !name.endsWith('.harness.ts') ? [child.pathname] : [];
    });

/**
 * Where the typed token may be named: this predicate; the Server tab (its field, its status) and
 * the pure status module it reads; use-hub's push of the settings to main; the export's redaction
 * list. Anywhere else, a read of the hub token is a "configured" test in disguise.
 */
const ALLOWED: Record<string, (code: string) => string> = {
    'features/hub/hooks/use-hub.tsx': (code) =>
        code
            .replace(
                'hub?.setSettings(settings.enabled, settings.url, settings.token, settings.name)',
                '',
            )
            .replace('[settings.enabled, settings.name, settings.token, settings.url]', ''),
    'features/hub/utils/hub-credential.ts': () => '',
    'features/settings/components/server/server-status.ts': () => '',
    'features/settings/components/server/worbus-server-settings.tsx': () => '',
    'store/export-secrets.ts': (code) => code.replace("'hub.token'", ''),
};

const TOKEN_READS = [
    /\b(?:hub|h|config|hubConfig|hubSettings)\??\.token\b/,
    /\{[^}]*\btoken\b[^}]*\}\s*=\s*(?:useHubSettings\(\)|useSettingsStore\.getState\(\)\.hub)/,
];

test('no renderer file tests the typed hub token outside the credential predicate', () => {
    const root = here('../../../');
    const files = walk(root);
    assert.ok(files.length > 500, `walked ${files.length} renderer files`);
    const hits: string[] = [];
    for (const file of files) {
        const rel = file.slice(root.pathname.length);
        let code = readFileSync(file, 'utf8');
        if (ALLOWED[rel]) code = ALLOWED[rel](code);
        const patterns = [...TOKEN_READS];
        // A component holding the hub settings as `settings` reads its token as `settings.token`.
        if (/\bsettings = useHubSettings\(\)/.test(code)) patterns.push(/\bsettings\??\.token\b/);
        for (const pattern of patterns) {
            code.split('\n').forEach((text, i) => {
                if (pattern.test(text)) hits.push(`${rel}:${i + 1}: ${text.trim()}`);
            });
        }
    }
    assert.deepEqual(hits, [], 'use hubSetUp / hasHubCredential (hub-credential.ts) instead');
    // The guard sees what it is meant to: each of the three sites the review found would fail it.
    for (const old of [
        'return Boolean(h?.enabled && h.url && h.token);',
        '!!input.hub.token &&',
        'Boolean(hub?.enabled && hub.url && hub.token);',
    ]) {
        assert.ok(
            TOKEN_READS.some((p) => p.test(old)),
            old,
        );
    }
});
