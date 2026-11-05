import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { HubServerRecord, InfoOutcome } from './addresses.ts';

import { createActiveAddress } from './active-address.ts';
import { createServerRecordStore, EMPTY_HUB_SERVER_RECORD } from './addresses.ts';
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
const world = (record: HubServerRecord, answers: Record<string, InfoOutcome>) => {
    const plain: Record<string, unknown> = { hubServer: record };
    const records = createServerRecordStore({
        onChange: () => {},
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
    // Before any socket: the first of the order (sign-in works before the first connect).
    assert.equal(w.active.url(), PRIVATE);
    await w.connect();
    assert.equal(w.active.url(), PUBLIC, 'the live socket decides');
    w.active.closed(PUBLIC);
    // The private address was probed this launch and did not pass: still not offered... unless
    // it merely did not answer, which says nothing about whose it is.
    assert.equal(w.active.url(), PRIVATE);
    const other = world(both(), { [PRIVATE]: match(ID_B), [PUBLIC]: match() });
    await other.connect();
    other.active.closed(PUBLIC);
    assert.equal(other.active.url(), PUBLIC, 'never an address that answered as another server');
    const lone = world({ ...both(), addresses: [both().addresses[1]] }, { [PRIVATE]: match(ID_B) });
    await lone.connect();
    assert.equal(lone.active.url(), '', 'nothing of this server to call');
    // Every main client reads `getHubConfig().url`, and sign-in builds on it too.
    const index = read('./index.ts');
    assert.match(index, /url: activeAddress\.url\(\),/);
    assert.match(index, /httpBase: \(\) => httpBaseOfAddress\(getHubConfig\(\)\.url\),/);
});
