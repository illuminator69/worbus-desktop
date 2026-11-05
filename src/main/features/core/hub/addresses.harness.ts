import assert from 'node:assert/strict';
import test from 'node:test';

import type { SignInPair } from '../../../../shared/utils/hub-signin.ts';
import type { InfoFetch } from './addresses.ts';

import {
    applyWelcomeServer,
    createInfoProbe,
    createServerRecordStore,
    DEFAULT_HUB_URL,
    HUB_SERVER_KEY,
    hubConfiguredFrom,
    markAddressOk,
} from './addresses.ts';
import { createHubAuth } from './auth.ts';

/**
 * Worbus P3 lane F, F1:  node --test src/main/features/core/hub/addresses.harness.ts
 *
 * Main's half of the address model: the server record persisted under electron-store
 * `hubServer`, migrated from `hub.url` (never from the untouched default), and the `/hub/info`
 * probe, which sends nothing but a bare GET.
 */

const ID_A = 'a'.repeat(32);
const SECRET = 'planted-device-secret-Zq81_xK3vT0aBcDeFgHiJkLmNoPqRsTuVwXyZ01234';
const PAIR: SignInPair = {
    salt: 'c0ffee5a1t',
    token: 'fedcba9876543210fedcba9876543210',
    username: 'alice',
};

const fakeStore = (initial: Record<string, unknown> = {}) => {
    const plain: Record<string, unknown> = { ...initial };
    return {
        delete: (key: string) => {
            delete plain[key];
        },
        get: (key: string) => plain[key],
        plain,
        set: (key: string, value: unknown) => {
            plain[key] = JSON.parse(JSON.stringify(value));
        },
    };
};

test('default_address_not_migrated', () => {
    // Feishin's untouched profile: Connect off, no credential, the stored default address.
    const configured = hubConfiguredFrom({
        enabled: false,
        hasCredential: false,
        url: DEFAULT_HUB_URL,
    });
    assert.equal(configured, false);
    const store = fakeStore({ 'hub.url': DEFAULT_HUB_URL });
    const records = createServerRecordStore({ onChange: () => {}, store });
    const record = records.reconcile(DEFAULT_HUB_URL, configured);
    assert.deepEqual(record.addresses, [], 'no typed entry for ws://localhost:4790');
    assert.equal(record.serverId, null);
    assert.deepEqual((store.plain[HUB_SERVER_KEY] as { addresses: unknown[] }).addresses, []);
});

test('typed_address_migrated (through the store, once)', () => {
    const store = fakeStore();
    const changes: unknown[] = [];
    const records = createServerRecordStore({ onChange: (r) => changes.push(r), store });
    const first = records.reconcile('ws://192.168.1.20:4790/', true);
    assert.deepEqual(first.addresses, [
        { lastOkAt: null, source: 'typed', url: 'ws://192.168.1.20:4790' },
    ]);
    assert.equal(changes.length, 1);
    // The same push again changes nothing and says nothing.
    records.reconcile('ws://192.168.1.20:4790/', true);
    assert.equal(changes.length, 1);
    // A later launch reads the stored record, not hub.url again: what was learned stays.
    records.update((r) => applyWelcomeServer(r, { id: ID_A, name: 'Home' }));
    const relaunched = createServerRecordStore({ onChange: () => {}, store });
    assert.equal(relaunched.reconcile('ws://192.168.1.20:4790', true).serverId, ID_A);
    // Even the default address migrates once the profile is configured another way (enabled):
    // it was being dialled before, and keeps being.
    const enabled = createServerRecordStore({ onChange: () => {}, store: fakeStore() });
    assert.equal(enabled.reconcile(DEFAULT_HUB_URL, true).addresses.length, 1);
});

test('an unconfigured push forgets the server, keeping the Not now answers', () => {
    const store = fakeStore();
    const records = createServerRecordStore({ onChange: () => {}, store });
    records.reconcile('ws://192.168.1.20:4790', true);
    records.update((r) => ({
        ...applyWelcomeServer(r, { id: ID_A, name: 'Home' }),
        promptDismissed: [ID_A],
    }));
    const cleared = records.reconcile(DEFAULT_HUB_URL, false);
    assert.deepEqual(cleared.addresses, []);
    assert.equal(cleared.serverId, null);
    assert.deepEqual(cleared.promptDismissed, [ID_A]);
});

test('record_never_holds_a_secret', async () => {
    const store = fakeStore({ 'hub.deviceId': 'dev-1' });
    const records = createServerRecordStore({ onChange: () => {}, store });
    records.reconcile('ws://alice:pw-in-url@192.168.1.20:4790', true);
    const auth = createHubAuth({
        device: () => ({ id: 'dev-1', kind: 'computer', name: 'Desk', platform: 'desktop' }),
        fetch: async () => ({
            status: 200,
            text: async () =>
                JSON.stringify({
                    deviceId: 'dev-1',
                    deviceSecret: SECRET,
                    user: { admin: true, name: 'alice', primary: true },
                }),
        }),
        httpBase: () => 'http://192.168.1.20:4790',
        legacyToken: () => 'legacy-typed-token-0123456789',
        log: { info: () => {}, warn: () => {} },
        setDeviceId: () => {},
        store,
        vault: { available: () => true, decrypt: (hex) => hex, encrypt: (text) => `enc:${text}` },
    });
    assert.equal((await auth.signIn(PAIR)).kind, 'signedIn');
    // The welcome that follows, with everything a welcome carries beside `server` - and a server
    // object padded with fields that must never be kept.
    records.update((r) =>
        markAddressOk(
            applyWelcomeServer(r, {
                deviceSecret: SECRET,
                id: ID_A,
                name: 'Home',
                publicUrl: `wss://alice:${PAIR.token}@hub.example.com`,
                salt: PAIR.salt,
                token: PAIR.token,
            }),
            'ws://192.168.1.20:4790',
            Date.now(),
        ),
    );
    const written = JSON.stringify(store.plain[HUB_SERVER_KEY]);
    for (const secret of [
        SECRET,
        PAIR.token,
        PAIR.salt,
        'legacy-typed-token-0123456789',
        'pw-in-url',
        'enc:',
    ]) {
        assert.equal(written.includes(secret), false, `record holds ${secret}`);
    }
    assert.deepEqual(Object.keys(store.plain[HUB_SERVER_KEY] as object).sort(), [
        'addresses',
        'learnedOff',
        'name',
        'promptDismissed',
        'serverId',
    ]);
    assert.match(written, /wss:\/\/hub\.example\.com/);
});

test('the probe sends a bare GET to <base>/hub/info, with the class timeout', async () => {
    const seen: { init: Parameters<InfoFetch>[1]; url: string }[] = [];
    const probe = createInfoProbe(async (url, init) => {
        seen.push({ init, url });
        return {
            status: 200,
            text: async () => JSON.stringify({ name: 'Home', serverId: ID_A, service: 'worbus' }),
        };
    });
    assert.deepEqual(await probe('wss://example.com/worbus', 5000, null), {
        kind: 'match',
        name: 'Home',
        serverId: ID_A,
    });
    assert.deepEqual(await probe('ws://192.168.1.20:4790', 1500, 'b'.repeat(32)), {
        kind: 'otherServer',
        serverId: ID_A,
    });
    assert.equal(seen[0].url, 'https://example.com/worbus/hub/info');
    assert.equal(seen[1].url, 'http://192.168.1.20:4790/hub/info');
    for (const { init } of seen) {
        assert.equal(init.method, 'GET');
        assert.equal('body' in init, false);
        assert.deepEqual(Object.keys(init.headers), ['Accept']);
        assert.equal(init.redirect, 'manual');
    }
    const failing = createInfoProbe(async () => {
        throw new TypeError('fetch failed');
    });
    assert.deepEqual(await failing('ws://10.0.0.1:4790', 1500, null), { kind: 'unreachable' });
});
