import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { HubServerRecord, InfoOutcome } from './addresses.ts';

import { typedUrlAfterRemove } from '../../../../renderer/features/settings/components/server/server-status.ts';
import { createActiveAddress, settingsAction } from './active-address.ts';
import {
    applyServerEdit,
    createServerRecordStore,
    EMPTY_HUB_SERVER_RECORD,
    httpBaseOfAddress,
    serverKey,
} from './addresses.ts';
import { createHubAuth } from './auth.ts';
import { kickAction } from './kick.ts';

/**
 * Worbus P3 lane F, F2:  node --test src/main/features/core/hub/active-address.harness.ts
 *
 * Connecting through whichever address answers as this server (design §6.3): each (re)connect
 * walks the order and probes; the first address that passes is dialled and is the active address,
 * which every main client and the cast bridge read through `getHubConfig().url`. A working socket
 * is never moved: not by a network change, not by a new `welcome.server`.
 */

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const PRIVATE = 'ws://192.168.1.20:4790';
const PUBLIC = 'wss://hub.example.com';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const match = (serverId = ID_A): InfoOutcome => ({ kind: 'match', name: 'Home', serverId });

/** A world: a stored record, a fake probe answering per address, and a fake socket factory. */
const world = (
    record: HubServerRecord,
    answers: Record<string, InfoOutcome>,
    onServerChange?: (from: string, to: null | string) => void,
) => {
    const plain: Record<string, unknown> = { hubServer: record };
    const records = createServerRecordStore({
        onChange: () => {},
        onServerChange,
        store: { get: (k) => plain[k], set: (k, v) => (plain[k] = v) },
    });
    const probed: string[] = [];
    const logs: string[] = [];
    const active = createActiveAddress({
        log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
        now: () => 1_000,
        probe: async (base, timeoutMs, expectedId) => {
            probed.push(`${base} ${timeoutMs} ${expectedId}`);
            const answer = answers[base] ?? { kind: 'unreachable' };
            // The real probe judges the id; the fake answers what the hub would say.
            if (answer.kind === 'match' && expectedId && answer.serverId !== expectedId) {
                return { kind: 'otherServer', serverId: answer.serverId };
            }
            return answer;
        },
        records,
    });
    const dialled: string[] = [];
    /** One (re)connect the way index.ts makes it: choose, then dial what was chosen. */
    const connect = async () => {
        const url = await active.choose();
        if (url) {
            dialled.push(url);
            active.opened(url);
        }
        return url;
    };
    return { active, connect, dialled, logs, plain, probed, records };
};

const both = (lastOk: { private?: number; public?: number } = {}): HubServerRecord => ({
    ...EMPTY_HUB_SERVER_RECORD,
    addresses: [
        { lastOkAt: lastOk.public ?? null, source: 'learned', url: PUBLIC },
        { lastOkAt: lastOk.private ?? null, source: 'typed', url: PRIVATE },
    ],
    serverId: ID_A,
});

test('dials_first_matching_address', async () => {
    const w = world(both(), { [PRIVATE]: match(), [PUBLIC]: match() });
    assert.equal(await w.connect(), PRIVATE);
    assert.deepEqual(w.probed, [`${PRIVATE} 1500 ${ID_A}`], 'one probe: the first one passed');
    assert.deepEqual(w.dialled, [PRIVATE]);
    // ...and with the private one down, the public one, with its 5 s timeout.
    const away = world(both(), { [PUBLIC]: match() });
    assert.equal(await away.connect(), PUBLIC);
    assert.deepEqual(away.probed, [`${PRIVATE} 1500 ${ID_A}`, `${PUBLIC} 5000 ${ID_A}`]);
    // None passes: nothing is dialled; the backoff retries the whole list.
    const none = world(both(), {});
    assert.equal(await none.connect(), null);
    assert.deepEqual(none.dialled, []);
});

test('skips_other_server_then_dials_next', async () => {
    const w = world(both(), { [PRIVATE]: match(ID_B), [PUBLIC]: match() });
    assert.equal(await w.connect(), PUBLIC);
    await w.connect();
    const skipped = w.logs.filter((l) => l.includes('another Worbus Server'));
    assert.equal(skipped.length, 1, 'logged once');
    assert.equal(skipped[0].includes(PRIVATE), true);
    // Skipped, never removed.
    assert.deepEqual(
        w.records.current().addresses.map((a) => a.url),
        [PUBLIC, PRIVATE],
    );
});

test('no_hello_after_other_server', async () => {
    // The fake socket factory sees every dial; the other server's address gets none - the same
    // for a record holding only that address, and through the rollback fallback (an `older`
    // answer is no use on an address whose last answer was another id).
    const w = world(both({ private: 5 }), { [PRIVATE]: match(ID_B) });
    assert.equal(await w.connect(), null);
    assert.deepEqual(w.dialled, []);
    // index.ts dials only what `choose()` handed it - never `config.url`, never the record raw.
    const index = read('./index.ts');
    const sockets = [...index.matchAll(/new WebSocket\(([^,)]+)/g)].map((m) => m[1]);
    assert.deepEqual(sockets, ['url']);
    assert.match(index, /activeAddress\.choose\(\)\s*\.then\(/);
    assert.doesNotMatch(index, /new WebSocket\(config\.url/);
});

test('network_change_keeps_live_socket', async () => {
    const w = world(both({ private: 5 }), { [PRIVATE]: match(), [PUBLIC]: match() });
    await w.connect();
    // Home Wi-Fi came back while the socket is on the private address: the kick only probes it.
    assert.equal(kickAction({ readyState: 1, shouldRun: true, sinceLastKick: 60_000 }), 'probe');
    assert.equal(w.active.active(), PRIVATE);
    // A socket on the public address when home comes back is not moved either: nothing re-chooses
    // while it is open; only its close does.
    const away = world(both(), { [PUBLIC]: match() });
    await away.connect();
    assert.equal(away.active.active(), PUBLIC);
    assert.equal(kickAction({ readyState: 1, shouldRun: true, sinceLastKick: 60_000 }), 'probe');
    assert.equal(away.active.active(), PUBLIC);
    // M12: even a fresh choice made while it is open (the home address answering now) does not
    // move it: only a socket opening on an address makes that address active.
    const answersNow = world(both(), { [PRIVATE]: match(), [PUBLIC]: match() });
    await answersNow.connect();
    answersNow.active.closed(PRIVATE);
    answersNow.active.opened(PUBLIC);
    assert.equal(await answersNow.active.choose(), PRIVATE, 'home answers again');
    assert.equal(answersNow.active.active(), PUBLIC, 'the open socket stays where it is');
    assert.equal(answersNow.active.url(), PUBLIC);
    // index.ts's kick: a probe is answered by a ping only; the socket is closed only by silence.
    const index = read('./index.ts');
    const kick = index.slice(index.indexOf('function kick('), index.indexOf('function probe('));
    assert.match(kick, /if \(action === 'probe'\) \{\s*if \(ws\) probe\(ws\);\s*return;\s*\}/);
});

test('learned_update_keeps_live_socket', async () => {
    const w = world(both({ private: 5 }), { [PRIVATE]: match() });
    await w.connect();
    w.active.welcome(PRIVATE, { id: ID_A, name: 'Home', publicUrl: 'wss://worbus.example.org' });
    assert.deepEqual(
        w.records
            .current()
            .addresses.filter((a) => a.source === 'learned')
            .map((a) => a.url),
        ['wss://worbus.example.org'],
        'the record follows the welcome',
    );
    assert.equal(w.active.active(), PRIVATE, 'the socket stays where it is');
    assert.equal(w.records.current().addresses.find((a) => a.url === PRIVATE)?.lastOkAt, 1_000);
    // index.ts's handling of `welcome.server` reconnects nothing.
    const index = read('./index.ts');
    const body = index.slice(
        index.indexOf('function noteWelcomeServer('),
        index.indexOf('function probe('),
    );
    assert.ok(body.length > 0);
    assert.doesNotMatch(body, /stop\(|restartWithCredential\(|terminate\(|connect\(\)|close\(/);
});

test('cast_bridge_dials_active_address', () => {
    const cast = read('../cast/index.ts');
    // Each bridge reads the active address when it dials, not a copy taken when it was built.
    const sockets = [...cast.matchAll(/new WebSocket\(([^,)]+)/g)].map((m) => m[1]);
    assert.deepEqual(sockets, ['hubUrl']);
    const connectHub = cast.slice(cast.indexOf('private connectHub('));
    assert.match(connectHub, /const hubUrl = getHubActiveAddress\(\);/);
    assert.doesNotMatch(cast, /private readonly hubUrl/);
    // With no live socket there is nothing verified to dial: it waits for one.
    assert.match(connectHub, /if \(!hubUrl\) \{[\s\S]*?this\.scheduleReconnect\(\);\s*return;/);
    const index = read('./index.ts');
    assert.match(
        index,
        /export const getHubActiveAddress = \(\): null \| string => activeAddress\.active\(\);/,
    );
});

test('http_base_follows_active_address', async () => {
    const w = world(both(), { [PUBLIC]: match() });
    // Review C2: before any socket, nothing - not the first address in the order.
    assert.equal(w.active.url(), '');
    await w.connect();
    assert.equal(w.active.url(), PUBLIC, 'the live socket decides');
    w.active.closed(PUBLIC);
    assert.equal(w.active.url(), '', 'and only while it is up');
    // Every main client reads `getHubConfig().url`; the hello's token is judged by it too.
    const index = read('./index.ts');
    assert.match(index, /url: activeAddress\.url\(\),/);
    assert.match(index, /httpBase: \(\) => httpBaseOfAddress\(getHubConfig\(\)\.url\),/);
});

/** A device signed in to server A (`/hub/signin` answers per base), as `index.ts` wires it. */
const signedInWorld = (
    record: HubServerRecord,
    answers: Record<string, InfoOutcome>,
    opts: { syncServerChange?: boolean } = {},
) => {
    const calls: { auth?: string; url: string }[] = [];
    const plain: Record<string, unknown> = { 'hub.deviceId': 'dev-1' };
    let auth: null | ReturnType<typeof createHubAuth> = null;
    const w = world(record, answers, (from, to) => {
        void from;
        void to;
        if (opts.syncServerChange !== false) auth?.serverChanged();
    });
    auth = createHubAuth({
        device: () => ({ id: 'dev-1', kind: 'computer', name: 'Desk', platform: 'desktop' }),
        fetch: async (url, init) => {
            calls.push({ auth: init.headers.Authorization, url });
            return {
                status: 200,
                text: async () =>
                    JSON.stringify({
                        deviceId: 'dev-1',
                        deviceSecret: 'secret-of-a',
                        user: { admin: false, name: 'alice', primary: true },
                    }),
            };
        },
        httpBase: () => httpBaseOfAddress(w.active.url()),
        legacyToken: () => '',
        log: { info: () => {}, warn: () => {} },
        requestBase: () => w.active.requestBase(),
        serverKey: (base) => serverKey(w.records.current(), base),
        setDeviceId: () => {},
        store: {
            delete: (key) => {
                delete plain[key];
            },
            get: (key) => plain[key],
            set: (key, value) => {
                plain[key] = value;
            },
        },
        vault: { available: () => true, decrypt: (hex) => hex, encrypt: (text) => text },
    });
    return { ...w, auth, calls };
};

const PAIR = { salt: 'abcdef12', token: '0123456789abcdef0123456789abcdef', username: 'alice' };

test('signin_probes_before_sending_pair', async () => {
    // Away from home, no socket (an owed sign-in, Linux without a keyring): the stored private
    // address answers as another server, or not at all; the learned `wss` one answers as A.
    for (const privateAnswer of [match(ID_B), { kind: 'unreachable' } as InfoOutcome]) {
        const w = signedInWorld(both({ private: 5 }), {
            [PRIVATE]: privateAnswer,
            [PUBLIC]: match(),
        });
        const result = await w.auth.signIn(PAIR);
        assert.equal(result.kind, 'signedIn');
        assert.deepEqual(
            w.calls.map((c) => c.url),
            ['https://hub.example.com/hub/signin'],
            `the pair goes to the wss base only (private: ${privateAnswer.kind})`,
        );
        assert.ok(
            w.probed.some((p) => p.startsWith(PRIVATE)),
            'the private one was asked first',
        );
    }
    // Nothing passes: nothing is sent, and the device reads unreachable (the retry runs).
    const none = signedInWorld(both(), {});
    assert.equal((await none.auth.signIn(PAIR)).kind, 'unreachable');
    assert.deepEqual(none.calls, []);
    // No address at all: no server.
    const empty = signedInWorld(EMPTY_HUB_SERVER_RECORD, {});
    assert.equal((await empty.auth.signIn(PAIR)).kind, 'noServer');
    // Sign-out with no socket goes the same way: to the address that passed, never another.
    const out = signedInWorld(both({ private: 5 }), { [PRIVATE]: match(ID_B), [PUBLIC]: match() });
    await out.auth.signIn(PAIR);
    out.calls.length = 0;
    await out.auth.signOut();
    assert.deepEqual(out.calls, [
        { auth: 'Bearer secret-of-a', url: 'https://hub.example.com/hub/signout' },
    ]);
    // index.ts: sign-in and sign-out go through the choice; sign-out takes the live address
    // before stop() clears it.
    const index = read('./index.ts');
    assert.match(index, /requestBase: \(\) => activeAddress\.requestBase\(\),/);
    assert.match(
        index,
        /const live = httpBaseOfAddress\(activeAddress\.active\(\) \?\? ''\);\s*stop\(\);\s*await hubAuth\.signOut\(live\);/,
    );
});

test('bearer_calls_need_live_socket', async () => {
    const w = signedInWorld(both({ private: 5 }), { [PRIVATE]: match(), [PUBLIC]: match() });
    await w.auth.signIn(PAIR);
    // Probed and passed, but no socket open on it: `getHubConfig().url` is still empty.
    assert.equal(await w.active.choose(), PRIVATE);
    assert.equal(w.active.url(), '', 'a probe that passed is not a socket');
    await w.connect();
    assert.equal(w.active.url(), PRIVATE);
    // The laptop slept at home and woke elsewhere: the socket closed, nothing is called.
    w.active.closed(PRIVATE);
    assert.equal(w.active.url(), '');
    // Every bearer caller fails soft on an empty url.
    for (const file of ['lbbot', 'preview', 'mood', 'station', 'audiomuse']) {
        const src = read(`../${file}/index.ts`);
        assert.match(
            src,
            /if \(!enabled \|\| !url \|\| !hubAuth\.bearer\(\)\) return null;/,
            `${file} returns no hub on an empty url`,
        );
    }
    // The cast start check does not depend on it: `enabled` only; each bridge waits for the
    // live address, and the main socket opening cuts that wait.
    const cast = read('../cast/index.ts');
    const start = cast.slice(
        cast.indexOf('function startBridging('),
        cast.indexOf('if (browser) return;'),
    );
    assert.match(start, /if \(!getHubConfig\(\)\.enabled\) \{/);
    assert.doesNotMatch(start, /\.url/);
    assert.match(
        cast,
        /hubEvents\.on\('server', [\s\S]{0,200}bridges\.forEach\(\(bridge\) => bridge\.addressReady\(\)\);/,
    );
    const index = read('./index.ts');
    assert.match(index, /if \(!hubAuth\.mayConnect\(recordBases\(\)\)\) return;/);
});

test('no_secret_after_forgetting_server', async () => {
    const NINE = 'ws://10.0.0.9:4790';
    const w = signedInWorld(
        {
            ...EMPTY_HUB_SERVER_RECORD,
            addresses: [{ lastOkAt: 5, source: 'typed', url: PRIVATE }],
            serverId: ID_A,
        },
        { [NINE]: match(ID_B), [PRIVATE]: match() },
    );
    await w.connect();
    await w.auth.signIn(PAIR);
    assert.deepEqual(w.auth.helloCredential(), { auth: { deviceSecret: 'secret-of-a' } });
    // The person adds server B's address (skipped: another server), then removes A's - the last
    // one that ever passed, so the record forgets A.
    w.records.update((r) => applyServerEdit(r, { op: 'add', url: NINE }));
    w.active.closed(PRIVATE);
    w.records.update((r) => applyServerEdit(r, { op: 'remove', url: PRIVATE }));
    assert.equal(w.records.current().serverId, null);
    // B is admitted now (no id known) - but A's secret is not presented to it: not in the hello,
    // not as a bearer, not in a sign-out.
    assert.equal(await w.connect(), NINE);
    assert.deepEqual(w.auth.helloCredential(), { token: '' });
    assert.equal(w.auth.bearer(), null);
    assert.equal(w.auth.mayConnect([httpBaseOfAddress(NINE) ?? '']), false, 'nothing to dial with');
    assert.deepEqual(w.auth.state(), { memoryOnly: false, needsSignIn: false, signedIn: false });
    w.calls.length = 0;
    await w.auth.signOut();
    assert.deepEqual(w.calls, [], 'no sign-out to B with A`s secret');
    // A found server with another id replacing the record is a server change too.
    const f = signedInWorld(both({ private: 5 }), { [PRIVATE]: match() });
    await f.auth.signIn(PAIR);
    f.records.update((r) =>
        applyServerEdit(r, {
            found: { addresses: [NINE], name: 'B', serverId: ID_B },
            op: 'adoptFound',
        }),
    );
    assert.equal(f.auth.bearer(), null);
    // ...and a welcome naming another id.
    const g = signedInWorld(both({ private: 5 }), { [PRIVATE]: match() });
    await g.auth.signIn(PAIR);
    await g.connect();
    g.active.welcome(PRIVATE, { id: ID_B, name: 'B' });
    assert.equal(g.auth.bearer(), null);
    // index.ts: the record store's server change forgets the secret and restarts without it.
    const index = read('./index.ts');
    assert.match(
        index,
        /onServerChange: \(from, to\) => queueMicrotask\(\(\) => serverChanged\(from, to\)\),/,
    );
    const body = index.slice(
        index.indexOf('function serverChanged('),
        index.indexOf('function connect('),
    );
    assert.match(body, /hubAuth\.serverChanged\(\);\s*restartWithCredential\(config\.enabled\);/);
});

test('remove_keeps_live_socket', () => {
    // The socket is on the learned address; the typed home address (`hub.url`) is stale and is
    // removed from the list: `hub.url` moves to the found one.
    const FOUND = 'ws://192.168.1.21:4790';
    const record: HubServerRecord = {
        ...EMPTY_HUB_SERVER_RECORD,
        addresses: [
            { lastOkAt: 9, source: 'learned', url: PUBLIC },
            { lastOkAt: null, source: 'typed', url: PRIVATE },
            { lastOkAt: null, source: 'found', url: FOUND },
        ],
        serverId: ID_A,
    };
    const after = applyServerEdit(record, { op: 'remove', url: PRIVATE });
    const typed = typedUrlAfterRemove(record, PRIVATE, PRIVATE);
    assert.equal(typed, FOUND);
    const push = {
        credentialMoved: false,
        enabled: { after: true, before: true },
        name: { after: 'Desk', before: 'Desk' },
        recordMoved: false,
        url: { after: typed ?? '', before: PRIVATE },
    };
    assert.equal(settingsAction(push, { live: PUBLIC, record: after }), 'keep');
    // Anything else still restarts: no live socket, the live address gone from the record, a
    // URL not in the record, another change alongside.
    assert.equal(settingsAction(push, { live: null, record: after }), 'restart');
    assert.equal(settingsAction(push, { live: PRIVATE, record: after }), 'restart');
    assert.equal(
        settingsAction(
            { ...push, url: { after: 'ws://10.0.0.9:4790', before: PRIVATE } },
            { live: PUBLIC, record: after },
        ),
        'restart',
    );
    assert.equal(
        settingsAction({ ...push, credentialMoved: true }, { live: PUBLIC, record: after }),
        'restart',
    );
    assert.equal(
        settingsAction(
            { ...push, url: { after: PRIVATE, before: PRIVATE } },
            { live: PUBLIC, record },
        ),
        'none',
    );
    // index.ts's `hub-settings`: only `restart` stops the socket and rebuilds the bridges.
    const index = read('./index.ts');
    const handler = index.slice(
        index.indexOf("'hub-settings',"),
        index.indexOf('function restartWithCredential('),
    );
    assert.match(handler, /const action = settingsAction\(/);
    assert.match(handler, /if \(action !== 'restart'\) return null;\s*\/\/[^\n]*\n\s*stop\(\);/);
});
