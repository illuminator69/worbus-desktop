import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { HubServerRecord } from '../../../../shared/utils/hub-addresses.ts';
import type { MirrorMeta } from '../../lbbot/index-mirror/mirror-logic.ts';

import { createHubAuth, DEVICE_IDS_KEY } from '../../../../main/features/core/hub/auth.ts';
import { EMPTY_HUB_SERVER_RECORD } from '../../../../shared/utils/hub-addresses.ts';
import { rekeyMode, rememberMode } from '../../../../shared/utils/lbbot-mode.ts';
import { mirrorVerdict } from '../../lbbot/index-mirror/mirror-logic.ts';
import { serverKeyMove, serverKeyOf } from './server-key.ts';

/**
 * Worbus P3 lane F, F3:  node --test src/renderer/features/hub/utils/server-key.harness.ts
 *
 * Per-server data follows the server's id, not its address (design §6.5): the device id per
 * account (main, `hub.deviceIds`), lb-bot's downloads mode per hub (`store_lbbot_mode`), the
 * index mirror (B-014's check), the mood catalogue's query and the `lbStatus` reset. On the first
 * welcome that carries `server.id`, what was stored under the address is copied, never wiped; a
 * different id still wipes as today.
 */

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const TYPED = 'ws://192.168.1.20:4790';
const TYPED_BASE = 'http://192.168.1.20:4790';
const PUBLIC_BASE = 'https://hub.example.com';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const rec = (serverId: null | string): HubServerRecord => ({
    ...EMPTY_HUB_SERVER_RECORD,
    addresses: [
        { lastOkAt: 1, source: 'typed', url: TYPED },
        { lastOkAt: null, source: 'learned', url: 'wss://hub.example.com' },
    ],
    serverId,
});

/** Main's sign-in, with the active address and the record's key as index.ts hands them. */
const mainAuth = (state: { base: string; key: string }, plain: Record<string, unknown>) => {
    const offered: (string | undefined)[] = [];
    const auth = createHubAuth({
        device: () => ({ id: 'dev-0', kind: 'computer', name: 'Desk', platform: 'desktop' }),
        fetch: async (_url, init) => {
            const body = JSON.parse(init.body ?? '{}');
            offered.push(body.deviceId);
            return {
                status: 200,
                text: async () =>
                    JSON.stringify({
                        // The hub keeps an id it issued (to this user), and mints for any other -
                        // the pre-P2 legacy id `dev-0` included.
                        deviceId: /^(minted|p2)-/.test(body.deviceId ?? '')
                            ? body.deviceId
                            : `minted-${offered.length}`,
                        deviceSecret: 'secret-xyz-0123456789',
                        user: { admin: false, name: 'alice', primary: false },
                    }),
            };
        },
        httpBase: () => state.base,
        legacyToken: () => '',
        log: { info: () => {}, warn: () => {} },
        serverKey: () => state.key,
        setDeviceId: () => {},
        store: {
            delete: (k) => delete plain[k],
            get: (k) => plain[k],
            set: (k, v) => (plain[k] = v),
        },
        vault: { available: () => true, decrypt: (h) => h, encrypt: (t) => t },
    });
    return { auth, offered };
};
const PAIR = { salt: 'abcdef12', token: '0123456789abcdef0123456789abcdef', username: 'alice' };

/** A stored mirror of three artists and its meta, and what a verdict does to it. */
const mirror = (meta: Partial<MirrorMeta>) => {
    const rows = new Map([
        ['mbid-1', 1],
        ['mbid-2', 2],
        ['nd:3', 3],
    ]);
    let stored: Partial<MirrorMeta> = meta;
    return {
        check: (current: { hubUrl: string; known: boolean; serverKey: string }) => {
            const verdict = mirrorVerdict(stored, current);
            if (verdict === 'clear') rows.clear();
            if (verdict === 'adopt') stored = { ...stored, ...current };
            return verdict;
        },
        rows,
        stored: () => stored,
    };
};

test('address_change_keeps_every_key', async () => {
    // The key does not read the active address at all: private → public is the same server.
    const record = rec(ID_A);
    assert.equal(serverKeyOf(record, TYPED), `id:${ID_A}`);
    assert.equal(serverKeyMove(`id:${ID_A}`, serverKeyOf(record, TYPED)), 'same');
    // Device id: signed in at home, then again away (the active address moved to the public one).
    const plain: Record<string, unknown> = {};
    const state = { base: TYPED_BASE, key: `id:${ID_A}` };
    const { auth, offered } = mainAuth(state, plain);
    await auth.signIn(PAIR);
    state.base = PUBLIC_BASE;
    await auth.signIn(PAIR);
    assert.deepEqual(offered, ['dev-0', 'minted-1'], 'the id minted at home is offered away');
    // Downloads mode: remembered under the key, read under the same key.
    const mode = rememberMode({}, [], serverKeyOf(record, TYPED), 'off');
    assert.equal(mode.map[serverKeyOf(record, 'ws://anything-else:4790')], 'off');
    // Mirror: the row count stays.
    const m = mirror({ hubUrl: TYPED, serverKey: `id:${ID_A}` });
    assert.equal(m.check({ hubUrl: TYPED, known: true, serverKey: `id:${ID_A}` }), 'keep');
    // ...also when the typed address itself changed (a found one tapped, the old one removed).
    assert.equal(
        m.check({ hubUrl: 'ws://10.0.0.9:4790', known: true, serverKey: `id:${ID_A}` }),
        'keep',
    );
    assert.equal(m.rows.size, 3);
});

test('first_welcome_rekeys_not_wipes', async () => {
    // Before: a project 2 install, everything under the address.
    assert.equal(serverKeyOf(rec(null), TYPED), TYPED);
    assert.equal(serverKeyMove(TYPED, `id:${ID_A}`), 'rekey');
    // Device id: stored by P2 under [address, account]; copied to [id, account] by the first welcome.
    const plain: Record<string, unknown> = {
        [DEVICE_IDS_KEY]: { [JSON.stringify([TYPED_BASE, 'alice'])]: 'p2-device-id' },
    };
    const state = { base: TYPED_BASE, key: TYPED_BASE };
    const { auth, offered } = mainAuth(state, plain);
    auth.rekey([TYPED_BASE], `id:${ID_A}`);
    state.key = `id:${ID_A}`;
    state.base = PUBLIC_BASE;
    await auth.signIn(PAIR);
    assert.deepEqual(offered, ['p2-device-id']);
    const ids = plain[DEVICE_IDS_KEY] as Record<string, string>;
    assert.equal(
        ids[JSON.stringify([TYPED_BASE, 'alice'])],
        'p2-device-id',
        'old key left in place',
    );
    // Downloads mode: copied, the address entry kept.
    const before = rememberMode({}, [], TYPED, 'off');
    const after = rekeyMode(before.map, before.order, TYPED, `id:${ID_A}`);
    assert.equal(after.map[`id:${ID_A}`], 'off');
    assert.equal(after.map[TYPED], 'off');
    // Mirror: a P2 meta (address only) is adopted, rows kept.
    const m = mirror({ hubUrl: TYPED });
    assert.equal(m.check({ hubUrl: TYPED, known: true, serverKey: `id:${ID_A}` }), 'adopt');
    assert.equal(m.rows.size, 3);
    assert.equal(m.stored().serverKey, `id:${ID_A}`);
    // ...and one stamped before the record arrived (the key was still the address).
    const early = mirror({ hubUrl: TYPED, serverKey: TYPED });
    assert.equal(early.check({ hubUrl: TYPED, known: true, serverKey: `id:${ID_A}` }), 'adopt');
    assert.equal(early.rows.size, 3);
    // Before main has said what it knows, a mirror keyed by an id is not judged.
    const waiting = mirror({ hubUrl: TYPED, serverKey: `id:${ID_A}` });
    assert.equal(waiting.check({ hubUrl: TYPED, known: false, serverKey: TYPED }), 'keep');
});

test('other_id_still_wipes', async () => {
    assert.equal(serverKeyMove(`id:${ID_A}`, `id:${ID_B}`), 'moved');
    assert.equal(serverKeyMove(TYPED, 'ws://10.0.0.9:4790'), 'moved', 'older servers: as today');
    const m = mirror({ hubUrl: TYPED, serverKey: `id:${ID_A}` });
    assert.equal(m.check({ hubUrl: TYPED, known: true, serverKey: `id:${ID_B}` }), 'clear');
    assert.equal(m.rows.size, 0);
    const p2 = mirror({ hubUrl: TYPED });
    assert.equal(p2.check({ hubUrl: 'ws://10.0.0.9:4790', known: true, serverKey: 'x' }), 'clear');
    // Device id: another server's id is not offered to this one.
    const plain: Record<string, unknown> = {};
    const state = { base: TYPED_BASE, key: `id:${ID_A}` };
    const { auth, offered } = mainAuth(state, plain);
    await auth.signIn(PAIR);
    state.key = `id:${ID_B}`;
    await auth.signIn(PAIR);
    assert.equal(offered.length, 2);
    assert.notEqual(offered[1], 'minted-1', "server A's id is not offered to server B");
    // Downloads mode: none remembered for the other server.
    const mode = rememberMode({}, [], `id:${ID_A}`, 'off');
    assert.equal(mode.map[`id:${ID_B}`], undefined);
    // use-hub resets lbStatus, the downloads session, the mirror and the sign-in verdict on a move -
    // keyed by the server key now, not the typed address.
    const hook = read('../hooks/use-hub.tsx');
    assert.match(hook, /serverKeyMove\(lbStatusHub\.current, serverKey\)/);
    assert.doesNotMatch(hook, /lbStatusHub\.current !== settings\.url/);
});

test('every per-server key reads the server key', () => {
    assert.match(read('../../lbbot/stores/lbbot-mode.store.ts'), /currentServerKey\(\)/);
    assert.match(
        read('../../moods/mood-client.ts'),
        /queryKey: \['moods', 'catalogue', serverKey\]/,
    );
    const mirrorSrc = read('../../lbbot/index-mirror/index-mirror.ts');
    assert.match(mirrorSrc, /mirrorVerdict\(/);
    assert.doesNotMatch(mirrorSrc, /storedMeta\.hubUrl !== currentHubUrl\(\)/);
    const index = read('../../../../main/features/core/hub/index.ts');
    assert.match(index, /hubAuth\.rekey\(/);
    // `oldServers` stays keyed by address (an older server has no id).
    const auth = read('../../../../main/features/core/hub/auth.ts');
    assert.match(auth, /oldServers\(\)\.includes\(base\)/);
});
