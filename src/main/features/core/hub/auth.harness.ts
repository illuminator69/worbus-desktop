import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import type { HubSignInResult, SignInPair } from '../../../../shared/utils/hub-signin.ts';
import type { HubAuthDeps } from './auth.ts';

import {
    createSilentSignIn,
    parseSubsonicPair,
    tokenAfterSignIn,
} from '../../../../shared/utils/hub-signin.ts';
import { castHelloFrame } from '../cast/cast-hello.ts';
import {
    createHubAuth,
    DEVICE_IDS_KEY,
    SECRET_KEY,
    SIGNED_IN_KEY,
    TOKEN_RETIRED_KEY,
} from './auth.ts';

/**
 * Worbus P2 lane F, F1:  node --test src/main/features/core/hub/auth.harness.ts
 *
 * Worbus for desktop signs in to the Worbus Server with the current Navidrome server's `u`/`s`/`t` instead of
 * a typed hub token. The device secret the hub issues is kept in main only (safeStorage-encrypted
 * in electron-store, or in memory when the OS offers no encryption, R7); every main client and
 * the cast bridge read one accessor; an older hub (404, 405, not this route's JSON) is told apart
 * from an unreachable one (R6); a hub that signs this device out gets one silent sign-in.
 *
 * The fake hub answers exactly as `hub.py` @7732e88 does: 200 `{deviceId, deviceSecret, user}`;
 * 400/401/429/503 with `{code}`; the P1 hub's 405 `{"error":"method not allowed"}` to a POST
 * outside its proxies; `/hub/signout` 200 `{}` or 401 `{"code":"signed_out"}`.
 */

const SECRET = 'planted-device-secret-Zq81_xK3vT0aBcDeFgHiJkLmNoPqRsTuVwXyZ01234';
const PAIR: SignInPair = {
    salt: 'a1b2c3',
    token: '0123456789abcdef0123456789abcdef',
    username: 'alice',
};

type Answer = Error | { body: string; status: number };

interface Call {
    body: any;
    headers: Record<string, string>;
    method: string;
    url: string;
}

const json = (status: number, body: unknown): Answer => ({ body: JSON.stringify(body), status });
const signedIn = (
    deviceId = 'minted-id-0001',
    user = { admin: true, name: 'alice', primary: false },
) => json(200, { deviceId, deviceSecret: SECRET, user });

/** A main-process world: electron-store as a plain object, safeStorage as a reversible fake. */
const world = (opts: { answers?: Answer[]; encryption?: boolean; token?: string } = {}) => {
    const plain: Record<string, unknown> = { 'hub.deviceId': 'old-device-id' };
    const calls: Call[] = [];
    const logs: string[] = [];
    const answers = [...(opts.answers ?? [])];
    let token = opts.token ?? '';
    const deps: HubAuthDeps = {
        device: () => ({
            id: String(plain['hub.deviceId']),
            kind: 'computer',
            name: 'Desk',
            platform: 'desktop',
        }),
        fetch: async (url, init) => {
            calls.push({
                body: init.body ? JSON.parse(init.body) : undefined,
                headers: init.headers,
                method: init.method,
                url,
            });
            const next = answers.shift() ?? json(200, {});
            if (next instanceof Error) throw next;
            return { status: next.status, text: async () => next.body };
        },
        httpBase: () => 'http://hub.lan:4790',
        legacyToken: () => token,
        log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
        // P3: no server id known here, so the key is the address (as for an older server).
        serverKey: (base) => base,
        setDeviceId: (id) => {
            plain['hub.deviceId'] = id;
        },
        store: {
            delete: (key) => {
                delete plain[key];
            },
            get: (key) => plain[key],
            set: (key, value) => {
                plain[key] = value;
            },
        },
        vault: {
            available: () => opts.encryption ?? true,
            // Not a real cipher: reversible, and the plain text is nowhere in its output.
            decrypt: (hex) => Buffer.from(hex, 'hex').toString('utf8').split('').reverse().join(''),
            encrypt: (text) =>
                Buffer.from(text.split('').reverse().join(''), 'utf8').toString('hex'),
        },
    };
    return {
        answers,
        auth: createHubAuth(deps),
        calls,
        deps,
        logs,
        plain,
        setToken: (value: string) => {
            token = value;
        },
    };
};

// --- bearer ---------------------------------------------------------------------------------

test('bearer prefers secret then token', async () => {
    const w = world({ answers: [signedIn()], token: 'legacy-hub-token' });
    w.auth.load();
    // R31: the typed token goes only to an address that answered OldServer.
    assert.equal(w.auth.bearer(), null, 'never signed in, address not known as older: nothing');
    assert.deepEqual(w.auth.helloCredential(), { token: '' });

    const result = await w.auth.signIn(PAIR);
    assert.equal(result.kind, 'signedIn');
    assert.equal(w.auth.bearer(), SECRET, 'signed in: the device secret, not the token');
    assert.deepEqual(w.auth.helloCredential(), { auth: { deviceSecret: SECRET } });
    assert.ok(!('token' in w.auth.helloCredential()), 'a hello with a secret sends no token');

    w.answers.push(json(200, {}));
    await w.auth.signOut();
    // R23 (b, c): signed out by the user, the device is not connected - never the primary user
    // through the shared token.
    assert.equal(w.auth.bearer(), null, 'signed out by the user: nothing, not the token');

    const bare = world();
    bare.auth.load();
    assert.equal(bare.auth.bearer(), null, 'nothing at all: no bearer, so no client calls the hub');
});

test('a secret survives a restart, decrypted from the store', async () => {
    const w = world({ answers: [signedIn()] });
    w.auth.load();
    await w.auth.signIn(PAIR);
    const again = createHubAuth(w.deps);
    again.load();
    assert.equal(again.bearer(), SECRET);
    assert.deepEqual(again.state(), { memoryOnly: false, needsSignIn: false, signedIn: true });
});

test('a device the server signed out does not fall back to the shared token', async () => {
    const w = world({ answers: [signedIn()], token: 'legacy-hub-token' });
    w.auth.load();
    await w.auth.signIn(PAIR);
    w.auth.signedOutByServer();
    assert.equal(w.auth.bearer(), null, 'not quietly the primary user through the token');
    assert.equal(w.plain[SECRET_KEY], undefined, 'the dead secret is gone from the store');
    assert.deepEqual(w.auth.state(), { memoryOnly: false, needsSignIn: true, signedIn: false });
});

// --- the sign-in answer, R6 -------------------------------------------------------------------

test('old hub 405 shows token field', async () => {
    const cases: [string, Answer][] = [
        ['P1 hub 405', json(405, { error: 'method not allowed' })],
        ['404', json(404, { error: 'unknown route' })],
        ['404 with no body', { body: '', status: 404 }],
        ['an HTML page', { body: '<html><body>Upgrade Required</body></html>', status: 426 }],
        ['200 that is not JSON', { body: 'OK', status: 200 }],
        ['200 JSON that is not this route', json(200, { ok: true })],
        ['200 without a user', json(200, { deviceId: 'x', deviceSecret: SECRET })],
    ];
    for (const [label, answer] of cases) {
        const w = world({ answers: [answer], token: 'typed' });
        w.auth.load();
        const result = await w.auth.signIn(PAIR);
        assert.equal(result.kind, 'oldServer', label);
        assert.equal(w.auth.bearer(), 'typed', `${label}: the token field's value is what is used`);
        assert.equal(w.plain[SIGNED_IN_KEY], undefined, `${label}: not marked signed in`);
    }
    // Signed in, then the hub was rolled back to P1: the secret is no use there, the token is.
    const rolled = world({ answers: [signedIn(), json(405, { error: 'method not allowed' })] });
    rolled.auth.load();
    await rolled.auth.signIn(PAIR);
    rolled.setToken('typed-after-rollback');
    assert.equal((await rolled.auth.signIn(PAIR)).kind, 'oldServer');
    assert.equal(rolled.auth.bearer(), 'typed-after-rollback');
    assert.equal(rolled.plain[SECRET_KEY], undefined);
});

test('an unreachable hub is never an old one', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
    });
    const dropped = Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
    });
    for (const [label, error] of [
        ['refused', refused],
        ['timeout', timeout],
        ['dropped', dropped],
    ] as const) {
        const w = world({ answers: [error] });
        w.auth.load();
        assert.equal((await w.auth.signIn(PAIR)).kind, 'unreachable', label);
    }
});

test('each refusal has its own result', async () => {
    const cases: [Answer, HubSignInResult['kind']][] = [
        [json(401, { code: 'navidrome_refused' }), 'navidromeRefused'],
        [json(503, { code: 'navidrome_unreachable' }), 'navidromeUnreachable'],
        [json(429, { code: 'too_many_attempts' }), 'tooManyAttempts'],
        [json(400, { code: 'bad_request' }), 'badRequest'],
    ];
    for (const [answer, kind] of cases) {
        const w = world({ answers: [answer] });
        w.auth.load();
        assert.equal((await w.auth.signIn(PAIR)).kind, kind);
        assert.equal(w.auth.bearer(), null);
    }
    const none = world();
    none.auth.load();
    none.deps.httpBase = () => null;
    assert.equal((await createHubAuth(none.deps).signIn(PAIR)).kind, 'noServer');
    assert.equal(none.calls.length, 0);
});

test('signin sends the pair and the stored device id, and adopts the id it is given (R4)', async () => {
    const w = world({ answers: [signedIn('minted-id-0001')] });
    w.auth.load();
    const result = await w.auth.signIn(PAIR);
    assert.deepEqual(w.calls[0], {
        body: {
            deviceId: 'old-device-id',
            kind: 'computer',
            name: 'Desk',
            platform: 'desktop',
            salt: PAIR.salt,
            token: PAIR.token,
            username: 'alice',
        },
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        url: 'http://hub.lan:4790/hub/signin',
    });
    assert.deepEqual(result, {
        deviceId: 'minted-id-0001',
        kind: 'signedIn',
        user: { admin: true, name: 'alice', primary: false },
    });
    assert.equal(w.plain['hub.deviceId'], 'minted-id-0001', 'the hub id is the device id now');
});

test('signout posts the secret as a bearer and forgets it whatever the answer', async () => {
    for (const answer of [json(200, {}), json(401, { code: 'signed_out' }), new TypeError('x')]) {
        const w = world({ answers: [signedIn()] });
        w.auth.load();
        await w.auth.signIn(PAIR);
        w.answers.push(answer);
        await w.auth.signOut();
        assert.deepEqual(w.calls[1], {
            body: undefined,
            headers: { Authorization: `Bearer ${SECRET}` },
            method: 'POST',
            url: 'http://hub.lan:4790/hub/signout',
        });
        assert.equal(w.auth.bearer(), null);
        assert.equal(w.plain[SECRET_KEY], undefined);
        assert.equal(w.plain[SIGNED_IN_KEY], undefined, 'a sign-out the user asked for is final');
        assert.equal(w.plain['hub.deviceId'], 'minted-id-0001', 'the device keeps its id');
    }
});

// --- signed out by the server ------------------------------------------------------------------

test('signed_out triggers one silent signin', async () => {
    const tried: SignInPair[] = [];
    const outcomes: (HubSignInResult | null)[] = [];
    let answer: HubSignInResult = { kind: 'navidromeRefused' };
    const silent = createSilentSignIn({
        currentPair: () => PAIR,
        onOutcome: (r) => outcomes.push(r),
        signIn: async (pair) => {
            tried.push(pair);
            return answer;
        },
    });

    // The 4005 and the start-up check arrive together: one attempt between them.
    await Promise.all([silent.signedOut(), silent.signedOut()]);
    assert.equal(tried.length, 1);
    assert.deepEqual(tried[0], PAIR, 'the current server pair, as stored');
    assert.deepEqual(outcomes, [{ kind: 'navidromeRefused' }]);

    // Refused: the next signed-out is not answered with another try before a welcome.
    await silent.signedOut();
    assert.equal(tried.length, 1, 'one silent sign-in, not one per reconnect');
    assert.equal(outcomes.at(-1), null, 'given up: the status reads signed out');

    // A welcome (the user signed in by hand, say) earns the next signed-out one try again.
    silent.welcome();
    answer = {
        deviceId: 'd',
        kind: 'signedIn',
        user: { admin: false, name: 'alice', primary: false },
    };
    await silent.signedOut();
    assert.equal(tried.length, 2);
    assert.equal((outcomes.at(-1) as HubSignInResult).kind, 'signedIn');

    // No account to send: nothing is posted, and it says so.
    const none: (HubSignInResult | null)[] = [];
    const noPair = createSilentSignIn({
        currentPair: () => null,
        onOutcome: (r) => none.push(r),
        signIn: async () => {
            throw new Error('must not be called');
        },
    });
    await noPair.signedOut();
    assert.deepEqual(none, [{ kind: 'noAccount' }]);
});

test('the transport stands down on 4005 or signed_out and the renderer runs the silent sign-in', () => {
    const hub = read('./index.ts');
    assert.match(hub, /CLOSE_SIGNED_OUT = 4005/);
    assert.match(
        hub,
        /code === CLOSE_SIGNED_OUT \|\| signedOutSeen/,
        'the close handler reads 4005 and the error frame before it',
    );
    assert.match(hub, /msg\?\.t === 'error' && msg\?\.code === 'signed_out'/);
    assert.match(hub, /hubAuth\.signedOutByServer\(\)/);
    assert.match(hub, /emitStatus\('signedOut'\)/);
    const useHub = read('../../../../renderer/features/hub/hooks/use-hub.tsx');
    assert.match(useHub, /msg\.t === 'signedOut'[\s\S]{0,400}silentSignIn\.signedOut\(\)/);
    assert.match(useHub, /silentSignIn\.welcome\(\)/, 'a welcome re-arms the one try');
    const actions = read('../../../../renderer/features/hub/utils/hub-signin-actions.ts');
    assert.match(
        actions,
        /const state = await hub\.authState\(\);[\s\S]{0,160}return state\.needsSignIn;/,
    );
    // A memory-only secret lost to a restart is signed in again at start (R7) - with Connect on
    // and an address only (review M4): with the hub off, nothing is posted anywhere.
    assert.match(
        actions,
        /const needsSignIn = await refreshAuthState\(\)\.catch\(\(\) => false\);\s*const \{ hub: config \} = useSettingsStore\.getState\(\);\s*if \(!config\.enabled \|\| !config\.url\.trim\(\)\) return;\s*if \(needsSignIn\) return silentSignIn\.signedOut\(\);/,
    );
    assert.match(
        useHub,
        /hub\?\.setSettings\([^)]*\)\s*\/\/[\s\S]{0,600}void reconcileSignIn\(\);/,
    );
});

test('the credential parsed from the Navidrome login is its u, s and t', () => {
    assert.deepEqual(
        parseSubsonicPair('u=alice&s=a1b2c3&t=0123456789abcdef0123456789abcdef'),
        PAIR,
    );
    assert.deepEqual(
        parseSubsonicPair('u=a&b&s=zz&s=a1b2c3&t=0123456789abcdef0123456789abcdef')?.username,
        'a&b&s=zz',
        'the username is stored unescaped: everything up to the last &s=',
    );
    for (const credential of [
        '',
        undefined,
        null,
        'u=alice&p=enc:7365637265',
        'u=&s=a1b2c3&t=0123456789abcdef0123456789abcdef',
        'u=alice&s=ab&t=0123456789abcdef0123456789abcdef',
        'u=alice&s=a1b2c3&t=NOTHEX',
        'MediaBrowser Token="x"',
    ]) {
        assert.equal(parseSubsonicPair(credential), null, String(credential));
    }
});

// --- the secret stays in main ------------------------------------------------------------------

const here = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(here(path), 'utf8');
const walk = (dir: URL): string[] =>
    readdirSync(dir).flatMap((name) => {
        const child = new URL(`${name}`, dir);
        if (statSync(child).isDirectory()) return walk(new URL(`${name}/`, dir));
        return /\.(ts|tsx)$/.test(name) && !name.endsWith('.harness.ts') ? [child.pathname] : [];
    });

test('secret not in plain prefs', async () => {
    // Encryption available: the store holds ciphertext only.
    const w = world({ answers: [signedIn()] });
    w.auth.load();
    const result = await w.auth.signIn(PAIR);
    const stored = JSON.stringify(w.plain);
    assert.ok(!stored.includes(SECRET), 'the secret is not in electron-store in plain');
    assert.equal(typeof w.plain[SECRET_KEY], 'string');
    assert.ok(!JSON.stringify(result).includes(SECRET), 'the IPC answer does not carry it');
    assert.ok(!JSON.stringify(w.auth.state()).includes(SECRET));
    for (const line of w.logs) {
        assert.ok(!line.includes(SECRET), `logged: ${line}`);
        assert.ok(!line.includes(PAIR.token) && !line.includes(PAIR.salt), `logged: ${line}`);
    }

    // No OS encryption (R7): memory only. Nothing is written, not even the ciphertext slot.
    const bare = world({ answers: [signedIn()], encryption: false });
    bare.auth.load();
    await bare.auth.signIn(PAIR);
    assert.equal(bare.auth.bearer(), SECRET);
    assert.equal(bare.plain[SECRET_KEY], undefined);
    assert.ok(!JSON.stringify(bare.plain).includes(SECRET));
    assert.deepEqual(bare.auth.state(), { memoryOnly: true, needsSignIn: false, signedIn: true });
    const restarted = createHubAuth(bare.deps);
    restarted.load();
    assert.deepEqual(
        restarted.state(),
        { memoryOnly: true, needsSignIn: true, signedIn: false },
        'after a restart it is owed one silent sign-in',
    );

    // A ciphertext the keyring can no longer open is dropped, and a sign-in is owed.
    const broken = world({ answers: [signedIn()] });
    broken.auth.load();
    await broken.auth.signIn(PAIR);
    broken.deps.vault.decrypt = () => {
        throw new Error(
            'Error while decrypting the ciphertext provided to safeStorage.decryptString.',
        );
    };
    const reopened = createHubAuth(broken.deps);
    reopened.load();
    assert.equal(reopened.bearer(), null);
    assert.equal(broken.plain[SECRET_KEY], undefined);
    assert.equal(reopened.state().needsSignIn, true);

    // The renderer and the preload never name it, so no persisted setting or IPC payload can.
    const outside = [
        ...walk(here('../../../../renderer/')),
        ...walk(here('../../../../preload/')),
        ...walk(here('../../../../remote/')),
    ];
    assert.ok(outside.length > 500, `walked ${outside.length} files`);
    for (const file of outside) {
        const code = readFileSync(file, 'utf8');
        assert.doesNotMatch(code, /deviceSecret|hubAuth\.secret/, file);
    }
    // The renderer's persisted hub settings have no slot for it.
    const settings = read('../../../../renderer/store/settings.store.ts');
    const schema = settings.slice(settings.indexOf('const HubSettingsSchema'));
    assert.doesNotMatch(schema.slice(0, schema.indexOf('});')), /secret/i);
    // And the generic settings IPC cannot read the slot out of electron-store.
    const ipc = read('../settings/index.ts');
    assert.equal(
        (ipc.match(/if \(!rendererMayUse\(data\.property\)\) return/g) ?? []).length,
        3,
        'settings-get, settings-set and settings-set-sync each refuse the hubAuth slots',
    );
});

test('the IPC handlers hand the renderer results, never the secret', () => {
    const hub = read('./index.ts');
    assert.match(hub, /ipcMain\.handle\('hub-signin'/);
    assert.match(hub, /ipcMain\.handle\('hub-signout'/);
    assert.match(hub, /ipcMain\.handle\('hub-auth-state'/);
    // R23: a refused sign-in no longer reconnects with the typed token (it reconnected a switched
    // or logged-out device as the primary user). The refusal retires the token and the transport
    // is restarted with what is left - nothing.
    assert.doesNotMatch(hub, /!shouldRun && hubAuth\.bearer\(\)\) start\(\)/);
    assert.match(
        hub,
        /const before = hubAuth\.bearer\(\);\s*const connected = isHubConnected\(\);\s*const result = await hubAuth\.signIn\(/,
    );
    assert.match(
        hub,
        /if \(\s*result\.kind === 'signedIn' \|\|\s*hubAuth\.bearer\(\) !== before \|\|\s*\(result\.kind === 'oldServer' && !connected\)\s*\) \{\s*restartWithCredential\(true\);/,
    );
    const preload = read('../../../../preload/hub.ts');
    for (const channel of ['hub-signin', 'hub-signout', 'hub-auth-state']) {
        assert.ok(preload.includes(`'${channel}'`), channel);
    }
});

// --- one accessor ------------------------------------------------------------------------------

test('every main client and the cast bridge read hubAuth.bearer', () => {
    const main = walk(here('../../'));
    assert.ok(main.length > 30, `walked ${main.length} main files`);
    for (const file of main) {
        const code = readFileSync(file, 'utf8');
        assert.doesNotMatch(code, /getHubConfig\(\)\.token/, file);
        assert.doesNotMatch(code, /\{[^}\n]*\btoken\b[^}\n]*\}\s*=\s*getHubConfig\(\)/, file);
        assert.doesNotMatch(code, /\bconfig\.token\b(?![^\n]*legacy)/, file);
    }
    for (const client of ['lbbot', 'preview', 'audiomuse', 'mood', 'station']) {
        const code = read(`../${client}/index.ts`);
        assert.match(code, /hubAuth\.bearer\(\)/, client);
    }
    const cast = read('../cast/index.ts');
    assert.match(
        cast,
        /hubAuth\.helloCredential\(\)/,
        'the cast hello carries the same credential',
    );
});

// --- the cast bridge ---------------------------------------------------------------------------

test('cast bridge hello carries bridgedBy', async () => {
    const w = world({ answers: [signedIn('minted-id-0001')], token: 'legacy' });
    w.auth.load();
    await w.auth.signIn(PAIR);
    const frame = castHelloFrame({
        bridgedBy: String(w.plain['hub.deviceId']),
        castId: 'abcd',
        credential: w.auth.helloCredential(),
        kind: 'speaker',
        name: 'Kitchen',
    });
    assert.equal(frame.t, 'hello');
    assert.equal(frame.device.id, 'cast-abcd');
    assert.equal(frame.device.bridgedBy, 'minted-id-0001', 'the id the hub gave this device (R4)');
    assert.notEqual(
        frame.device.bridgedBy,
        'old-device-id',
        'never the locally generated id: the hub would take that hello as the main socket',
    );
    assert.deepEqual(frame.auth, { deviceSecret: SECRET }, "the bridging device's own secret");
    assert.ok(!('token' in frame), 'no shared token beside a secret');
    assert.deepEqual(frame.device.caps, ['receiver', 'loadAck', 'transferAckV2', 'idleVolume']);
    assert.deepEqual(
        castHelloFrame({
            bridgedBy: 'x',
            castId: 'g',
            credential: { token: 'legacy' },
            kind: 'group',
            name: 'All',
        }),
        {
            device: {
                bridgedBy: 'x',
                caps: ['receiver', 'loadAck', 'transferAckV2'],
                id: 'cast-g',
                kind: 'group',
                name: 'All',
                platform: 'chromecast',
            },
            t: 'hello',
            token: 'legacy',
        },
    );
    // The chain from the sign-in answer to the bridge: the answer's id is written to the one key
    // the device id is read from, and the bridge reads exactly that.
    const hub = read('./index.ts');
    assert.match(hub, /setDeviceId: \(id\) => store\.set\('hub\.deviceId', id\)/);
    assert.match(hub, /function deviceId\(\): string \{\s*let id = store\.get\('hub\.deviceId'\)/);
    assert.match(hub, /export const getHubDeviceId = \(\): string => deviceId\(\);/);
    assert.match(hub, /id: deviceId\(\),/, 'the main hello claims the same id');
    const cast = read('../cast/index.ts');
    assert.match(
        cast,
        /castHelloFrame\(\{\s*bridgedBy: getHubDeviceId\(\),[\s\S]{0,80}credential: hubAuth\.helloCredential\(\)/,
    );
});

// --- review I5 (R23): the shared token is an upgrade bridge, not a fallback ----------------------

test('the legacy token is an upgrade bridge not a fallback', async () => {
    const outcome = async (answer: Answer) => {
        const w = world({ answers: [answer], token: 'legacy-hub-token' });
        w.auth.load();
        assert.equal(w.auth.bearer(), null, 'before any sign-in: not the token (R31)');
        const result = await w.auth.signIn(PAIR);
        const restarted = createHubAuth(w.deps);
        restarted.load();
        return { kind: result.kind, now: w.auth.bearer(), restarted: restarted.bearer(), w };
    };

    // (a) the upgrade works: the secret, and the token is never used again, not after a restart.
    const up = await outcome(signedIn());
    assert.equal(up.now, SECRET);
    assert.equal(up.w.plain[TOKEN_RETIRED_KEY], true);
    up.w.auth.signedOutByServer();
    assert.equal(up.w.auth.bearer(), null, 'a 4005 after the upgrade: no token fallback');

    // (a) Navidrome refused the account: the token is not used, then or after a restart.
    const refused = await outcome(json(401, { code: 'navidrome_refused' }));
    assert.equal(refused.kind, 'navidromeRefused');
    assert.equal(refused.now, null, 'refused: not the primary user through the token');
    assert.equal(refused.restarted, null);

    // R31 (replaces R23(a)'s keep-the-token clause): a sign-in that did not answer, or answered
    // 429 or Navidrome-down, leaves the device unconnected - the token is never sent, in the
    // hello or as any main client's bearer, then or after a restart. The renderer shows the
    // status and retries at the next connect.
    for (const answer of [
        new TypeError('fetch failed'),
        json(429, { code: 'too_many_attempts' }),
        json(503, { code: 'navidrome_unreachable' }),
        { body: '<html>502 Bad Gateway</html>', status: 502 },
        json(400, { code: 'bad_request' }),
    ] as Answer[]) {
        const unconnected = await outcome(answer);
        assert.equal(unconnected.now, null, unconnected.kind);
        assert.equal(unconnected.restarted, null, unconnected.kind);
        assert.deepEqual(unconnected.w.auth.helloCredential(), { token: '' }, unconnected.kind);
        assert.ok(
            !JSON.stringify(unconnected.w.calls).includes('legacy-hub-token'),
            `${unconnected.kind}: the token went nowhere`,
        );
    }
    // An older server: the token is its credential, there. After a restart it is asked again
    // first (R35) - see 'an older-hub verdict lasts one launch and ends at a P2 welcome'.
    const old = await outcome(json(405, { error: 'method not allowed' }));
    assert.equal(old.now, 'legacy-hub-token');
    assert.equal(old.restarted, null, 'a new launch asks /hub/signin again before the token');
    assert.deepEqual(old.w.auth.helloCredential(), { token: 'legacy-hub-token' });
    // ...and only there: another address has not answered OldServer.
    old.w.deps.httpBase = () => 'http://new-hub.lan:4790';
    assert.equal(createHubAuth(old.w.deps).bearer(), null, 'not to another address');

    // (b) a Navidrome logout or a switch with only a token: the token goes too.
    const logout = world({ token: 'legacy-hub-token' });
    logout.auth.load();
    await logout.auth.signOut();
    assert.equal(logout.auth.bearer(), null);
    assert.equal(logout.calls.length, 0, 'no secret: nothing to post');
    const again = createHubAuth(logout.deps);
    again.load();
    assert.equal(again.bearer(), null, 'and not at the next start either');
    assert.deepEqual(again.helloCredential(), { token: '' });

    // An older server's answer brings the token back (the user types it under Advanced).
    logout.answers.push(json(405, { error: 'method not allowed' }));
    assert.equal((await logout.auth.signIn(PAIR)).kind, 'oldServer');
    assert.equal(logout.auth.bearer(), 'legacy-hub-token');
    assert.equal(logout.plain[TOKEN_RETIRED_KEY], undefined);

    // The renderer's side of the same rule: which answers clear the typed token, and which
    // answers of the upgrade say nothing (the token keeps the connection).
    assert.equal(tokenAfterSignIn('signedIn'), 'clear');
    assert.equal(tokenAfterSignIn('navidromeRefused'), 'clear');
    for (const kind of [
        'oldServer',
        'unreachable',
        'tooManyAttempts',
        'navidromeUnreachable',
        'badRequest',
        'noAccount',
        'noServer',
    ] as const) {
        assert.equal(tokenAfterSignIn(kind), 'keep', kind);
    }
    // R31: no answer of the upgrade is quiet any more - unreachable, busy and Navidrome-down are
    // shown, since the device is not connected.
    const actions = read('../../../../renderer/features/hub/utils/hub-signin-actions.ts');
    assert.doesNotMatch(actions, /upgradeIsQuiet/);
});

test('logout switch and sign out clear the typed token and the upgrade runs on connect', () => {
    const actions = read('../../../../renderer/features/hub/utils/hub-signin-actions.ts');
    // Every sign-in answer goes through one rule for the typed token (the Server tab's tap, the
    // silent one, the upgrade).
    assert.match(
        actions,
        /if \(result !== null && tokenAfterSignIn\(result\.kind\) === 'clear'\) clearTypedToken\(\);/,
    );
    // "Sign out of this server", a logout and a switch all sign out through here.
    const signOut = actions.slice(actions.indexOf('export const signOutOfServer'));
    assert.match(signOut.slice(0, signOut.indexOf('\n};')), /clearTypedToken\(\);/);
    // (a) a device on the token makes the upgrade sign-in when it connects, and when its
    // settings are pushed (a hub that refuses tokens never welcomes it).
    assert.match(actions, /export const upgradeFromToken = async/);
    assert.match(actions, /if \(state\.signedIn \|\| state\.needsSignIn\) return;/);
    const useHub = read('../../../../renderer/features/hub/hooks/use-hub.tsx');
    assert.match(useHub, /silentSignIn\.welcome\(\);[\s\S]{0,700}void upgradeFromToken\(\);/);
    assert.match(useHub, /void reconcileSignIn\(\);/);
});

// --- review I7 (R24): a 4001 to a hello that carried a secret is an older server -----------------

test('a 4001 answering a secret hello is an older server', async () => {
    const w = world({ answers: [signedIn()] });
    w.auth.load();
    await w.auth.signIn(PAIR);
    w.setToken('typed-for-the-old-hub');
    w.auth.oldServer();
    assert.equal(w.plain[SECRET_KEY], undefined, 'the secret is no use there');
    assert.equal(w.plain[SIGNED_IN_KEY], undefined, 'no silent sign-in is owed');
    assert.equal(w.auth.bearer(), 'typed-for-the-old-hub', 'the token field is the credential');
    assert.deepEqual(w.auth.state(), { memoryOnly: false, needsSignIn: false, signedIn: false });

    const hub = read('./index.ts');
    assert.match(hub, /helloHadSecret = 'auth' in credential;/);
    assert.match(
        hub,
        /if \(code === CLOSE_BAD_TOKEN && helloHadSecret\) \{[\s\S]{0,700}hubAuth\.oldServer\(httpBaseOfAddress\(url\)\);[\s\S]{0,400}emitStatus\('oldServer'\);/,
    );
    // The `auth` error before that close says "check the token" - there is no token: not passed on.
    assert.match(
        hub,
        /if \(msg\?\.t === 'error' && msg\?\.code === 'auth' && helloHadSecret\) return;/,
    );
    const useHub = read('../../../../renderer/features/hub/hooks/use-hub.tsx');
    assert.match(
        useHub,
        /msg\.t === 'oldServer'\)[\s\S]{0,500}signInResult: \{ kind: 'oldServer' \}/,
        'the renderer shows the Advanced token field and its sentence',
    );
});

// --- review M2, M3: no direct fingerprint while a sign-in is owed; no bridge without a credential --

test('nothing goes out on a credential that is not there', () => {
    const muse = read('../audiomuse/index.ts');
    assert.match(
        muse,
        /if \(!ep\.viaHub && \(auth\.signedIn \|\| auth\.needsSignIn\)\) return \[\];/,
    );
    const cast = read('../cast/index.ts');
    const connect = cast.slice(cast.indexOf('private connectHub(): void {'));
    assert.match(
        connect.slice(0, 1400),
        /if \(!hubAuth\.bearer\(\)\) \{[\s\S]{0,400}return;/,
        'a bridge with nothing to say hello with does not open a socket (4005 each time)',
    );
});

// --- R6 clarification: any 5xx is a gateway failure, never an older hub -------------------------

test('a 5xx from the sign-in is unreachable whatever its body', async () => {
    const proxyPage = '<html><body><h1>502 Bad Gateway</h1></body></html>';
    for (const [label, answer] of [
        ['proxy 502 HTML', { body: proxyPage, status: 502 }],
        ['proxy 503 HTML', { body: '<html>Service Unavailable</html>', status: 503 }],
        ['proxy 504 empty', { body: '', status: 504 }],
        ['500 JSON not the route', json(500, { error: 'internal' })],
        ['503 with another code', json(503, { code: 'lbbot_too_old' })],
    ] as [string, Answer][]) {
        const w = world({ answers: [answer], token: 'typed' });
        w.auth.load();
        assert.equal((await w.auth.signIn(PAIR)).kind, 'unreachable', label);
        assert.equal(w.auth.bearer(), null, `${label}: not connected on the token (R31)`);
    }
    // The hub's own 503 refusal stays what it is.
    const own = world({ answers: [json(503, { code: 'navidrome_unreachable' })] });
    own.auth.load();
    assert.equal((await own.auth.signIn(PAIR)).kind, 'navidromeUnreachable');
    // And a 4xx that is not the route's JSON is still an older hub.
    const old = world({ answers: [{ body: '<html>Forbidden</html>', status: 403 }] });
    old.auth.load();
    assert.equal((await old.auth.signIn(PAIR)).kind, 'oldServer');
});

// --- walk B2 (R27): the adopted device id is kept per (hub address, account) ---------------------

test('each account gets its own device id back after a switch', async () => {
    const w = world({
        answers: [
            signedIn('id-alice'),
            json(200, {}),
            signedIn('id-bob', { admin: false, name: 'bob', primary: false }),
            json(200, {}),
            signedIn('id-alice'),
        ],
    });
    w.auth.load();
    const BOB: SignInPair = { ...PAIR, username: 'bob' };
    // First sign-in: today's single slot is offered (R4's upgrade path). The hub minted another
    // id, so the old one was not alice's: it stays unclaimed (re-review N4).
    await w.auth.signIn(PAIR);
    assert.equal(w.calls[0].body.deviceId, 'old-device-id');
    await w.auth.signOut();
    // Another account: alice's id is never offered for bob; the unclaimed old id is.
    await w.auth.signIn(BOB);
    assert.equal(w.calls[2].body.deviceId, 'old-device-id', "never alice's id");
    assert.equal(w.plain['hub.deviceId'], 'id-bob', 'the hello and bridgedBy use the current one');
    await w.auth.signOut();
    // Back to alice, name case and spaces aside: her own id is offered, so the hub keeps it.
    await w.auth.signIn({ ...PAIR, username: ' Alice' });
    assert.equal(w.calls[4].body.deviceId, 'id-alice');
    assert.equal(w.plain['hub.deviceId'], 'id-alice');
    const ids = w.plain[DEVICE_IDS_KEY] as Record<string, string>;
    assert.deepEqual(Object.values(ids).sort(), ['id-alice', 'id-bob']);

    // Another hub address is another space: alice there has no id of her own.
    w.deps.httpBase = () => 'http://other.lan:4790';
    const elsewhere = createHubAuth(w.deps);
    elsewhere.load();
    w.answers.push(signedIn('id-alice-2'));
    await elsewhere.signIn(PAIR);
    assert.notEqual(w.calls.at(-1)?.body.deviceId, 'id-alice');
});

// --- re-review N4: the old single slot waits for the account the hub says it is ------------------

test('the legacy device id waits for its own account', async () => {
    const OWNER_PAIR: SignInPair = { ...PAIR, username: 'owner' };
    const BOB: SignInPair = { ...PAIR, username: 'bob' };
    const owner = { admin: true, name: 'owner', primary: true };
    const bob = { admin: false, name: 'bob', primary: false };

    // bob signs in first on an upgraded owner device: the hub mints bob an id (the old one is
    // owner's), and the old one stays unclaimed for owner.
    const a = world({
        answers: [
            signedIn('id-bob', bob),
            json(200, {}),
            signedIn('old-device-id', owner),
            json(200, {}),
            signedIn('id-bob', bob),
            json(200, {}),
            signedIn('old-device-id', owner),
        ],
    });
    a.auth.load();
    await a.auth.signIn(BOB);
    assert.equal(a.calls[0].body.deviceId, 'old-device-id', 'offered while unclaimed');
    await a.auth.signOut();
    await a.auth.signIn(OWNER_PAIR);
    assert.equal(a.calls[2].body.deviceId, 'old-device-id', "owner's row, name and volume kept");
    assert.equal(a.plain['hub.deviceId'], 'old-device-id');
    await a.auth.signOut();
    await a.auth.signIn(BOB);
    assert.equal(a.calls[4].body.deviceId, 'id-bob', "bob's own; owner's is claimed now");
    await a.auth.signOut();
    await a.auth.signIn(OWNER_PAIR);
    assert.equal(a.calls[6].body.deviceId, 'old-device-id');

    // Another hub address first: the old id is not claimed there either.
    const c = world({ answers: [signedIn('id-elsewhere', owner)] });
    c.auth.load();
    c.deps.httpBase = () => 'http://other.lan:4790';
    await createHubAuth(c.deps).signIn(OWNER_PAIR);
    c.deps.httpBase = () => 'http://hub.lan:4790';
    const home = createHubAuth(c.deps);
    home.load();
    c.answers.push(signedIn('old-device-id', owner));
    await home.signIn(OWNER_PAIR);
    assert.equal(c.calls.at(-1)?.body.deviceId, 'old-device-id');

    // owner first: the hub keeps the old id, so it is owner's from then on, and bob gets none.
    const b = world({
        answers: [signedIn('old-device-id', owner), json(200, {}), signedIn('id-bob', bob)],
    });
    b.auth.load();
    await b.auth.signIn(OWNER_PAIR);
    assert.equal(b.calls[0].body.deviceId, 'old-device-id');
    await b.auth.signOut();
    await b.auth.signIn(BOB);
    assert.equal(b.calls[2].body.deviceId, undefined, "never owner's id once it is owner's");
});

// --- R35: an OldServer verdict is about one moment, not the address -----------------------------

test('an older-hub verdict lasts one launch and ends at a P2 welcome', async () => {
    const P1_405 = json(405, { error: 'method not allowed' });
    const w = world({ answers: [P1_405], token: 'legacy-hub-token' });
    w.auth.load();
    await w.auth.signIn(PAIR);
    assert.equal(w.auth.bearer(), 'legacy-hub-token', 'a P1 hub still works on the token');

    // Relaunch: the token waits for this launch's own sign-in answer.
    const relaunch = createHubAuth(w.deps);
    relaunch.load();
    assert.equal(relaunch.bearer(), null, 'not before /hub/signin is asked again');
    assert.deepEqual(relaunch.helloCredential(), { token: '' });
    w.answers.push(P1_405);
    assert.equal((await relaunch.signIn(PAIR)).kind, 'oldServer');
    assert.equal(
        relaunch.bearer(),
        'legacy-hub-token',
        'still P1: one 405 per launch, then the token',
    );

    // The hub is upgraded in place while connected: its welcome names a user.
    relaunch.newServer();
    assert.equal(relaunch.bearer(), null, 'a P2 hub: the token is no longer sent');
    assert.deepEqual(relaunch.helloCredential(), { token: '' });
    const afterUpgrade = createHubAuth(w.deps);
    afterUpgrade.load();
    assert.equal(afterUpgrade.bearer(), null, 'nor after a relaunch');
    // The upgrade sign-in then works and the secret takes over.
    w.answers.push(signedIn());
    assert.equal((await afterUpgrade.signIn(PAIR)).kind, 'signedIn');
    assert.equal(afterUpgrade.bearer(), SECRET);

    // The transport: a welcome with `user` on a socket that said hello with the token ends the
    // verdict and restarts without it; the renderer runs the upgrade sign-in from that welcome.
    const hub = read('./index.ts');
    assert.match(hub, /msg\?\.t === 'welcome' && msg\.user && !helloHadSecret\) p2Welcome = true;/);
    assert.match(
        hub,
        /if \(p2Welcome\) \{\s*(?:\/\/[^\n]*\n\s*)*hubAuth\.newServer\(httpBaseOfAddress\(url\)\);\s*restartWithCredential\(true\);/,
    );
    const useHub = read('../../../../renderer/features/hub/hooks/use-hub.tsx');
    assert.match(
        useHub,
        /if \(welcomeUser && useHubStore\.getState\(\)\.signInResult\?\.kind === 'oldServer'\) \{\s*setStore\(\{ signInResult: null \}\);\s*\}[\s\S]{0,300}void upgradeFromToken\(\);/,
    );
    // While a sign-in waits (unreachable, busy, Navidrome down) nothing is connecting, so the
    // renderer asks again on its own.
    const actions = read('../../../../renderer/features/hub/utils/hub-signin-actions.ts');
    assert.match(actions, /const RETRY_SIGN_IN_MS = 30_000;/);
    assert.match(
        actions,
        /retryTimer = setTimeout\(\(\) => \{\s*retryTimer = null;\s*void reconcileSignIn\(\);/,
    );
});

// --- R36: within a launch, a P2 welcome outranks an older-hub sign-in answer ---------------------

test('a P2 hub whose sign-in answers like an older one settles instead of looping', async () => {
    const P1_405 = json(405, { error: 'method not allowed' });
    const w = world({ answers: [P1_405], token: 'legacy-hub-token' });
    w.auth.load();
    await w.auth.signIn(PAIR);
    assert.equal(w.auth.bearer(), 'legacy-hub-token');

    // The transport and the renderer, step by step: connect only with a credential; the hub
    // (P2, behind a proxy that does not forward /hub/*) welcomes with a user; main ends the
    // older-hub verdict; the renderer's upgrade sign-in gets the proxy's 405.
    let handshakes = 0;
    const kinds: string[] = [];
    for (let i = 0; i < 10; i++) {
        if (!w.auth.bearer()) break;
        handshakes += 1;
        w.auth.newServer();
        w.answers.push(P1_405);
        kinds.push((await w.auth.signIn(PAIR)).kind);
    }
    assert.ok(handshakes <= 2, `${handshakes} handshakes: P2 welcome, token back, restart, again`);
    assert.deepEqual(kinds, ['unreachable'], 'read as unreachable: status line and 30 s retry');
    assert.equal(w.auth.bearer(), null, 'no token to the P2 hub');
    // R36 is about sign-in answers only. A 4001 to a secret hello there is still R24: the hub was
    // rolled back to P1 mid-launch (a P1 welcome names no user, so this cannot loop) - the token
    // field and the token, not a silent stand-down behind "Can't reach".
    w.auth.oldServer();
    assert.equal(w.auth.bearer(), 'legacy-hub-token', 'R24 applies at that address');
    w.answers.push(P1_405);
    assert.equal((await w.auth.signIn(PAIR)).kind, 'oldServer', 'and it is P1 from then on');
    // A new launch knows nothing of this one's welcome: it asks again, and a real P1 hub works.
    const relaunch = createHubAuth(w.deps);
    relaunch.load();
    w.answers.push(P1_405);
    assert.equal((await relaunch.signIn(PAIR)).kind, 'oldServer');

    const hub = read('./index.ts');
    assert.match(
        hub,
        /if \(code === CLOSE_BAD_TOKEN && helloHadSecret\) \{\s*(?:\/\/[^\n]*\n\s*)*hubAuth\.oldServer\(httpBaseOfAddress\(url\)\);/,
    );
    // The tidy-up: the renderer's 30 s retry ends on a sign-out, logout, switch or a tapped
    // sign-in.
    const actions = read('../../../../renderer/features/hub/utils/hub-signin-actions.ts');
    for (const name of ['signOutOfServer', 'signInWithCurrentServer']) {
        const body = actions.slice(actions.indexOf(`export const ${name}`));
        assert.match(body.slice(0, body.indexOf('\n};')), /cancelSignInRetry\(\);/, name);
    }
});
