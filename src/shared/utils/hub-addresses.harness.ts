import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubAddress, HubServerRecord, InfoOutcome } from './hub-addresses.ts';

import {
    admitsAddress,
    applyServerEdit,
    applyWelcomeServer,
    classifyHubAddress,
    classifyInfoAnswer,
    connectOrder,
    EMPTY_HUB_SERVER_RECORD,
    httpBaseOfAddress,
    migrateFrom,
    normaliseHubAddress,
    probeTimeoutMs,
    removeAddress,
    selectAddress,
    serverKey,
    welcomeAt,
    withFound,
} from './hub-addresses.ts';

/**
 * Worbus P3 lane F, F1: node --test src/shared/utils/hub-addresses.harness.ts
 *
 * The address model both processes share (design §6.3): one normaliser, the private test, the
 * server record, the order, `welcome.server`, and the selection rule that decides which address
 * may receive the device secret.
 */

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);

const record = (patch: Partial<HubServerRecord>): HubServerRecord => ({
    ...EMPTY_HUB_SERVER_RECORD,
    ...patch,
});
const addr = (url: string, source: HubAddress['source'], lastOkAt: null | number = null) => ({
    lastOkAt,
    source,
    url,
});
const info = (serverId: string, name = 'Worbus Server') =>
    JSON.stringify({ name, serverId, service: 'worbus', signin: true });

test('normalise_adds_ws_keeps_path_drops_connect', () => {
    const cases: [string, null | string][] = [
        ['192.168.1.20:4790', 'ws://192.168.1.20:4790'],
        ['  192.168.1.20:4790  ', 'ws://192.168.1.20:4790'],
        ['http://192.168.1.20:4790', 'ws://192.168.1.20:4790'],
        ['https://hub.example.com', 'wss://hub.example.com'],
        ['HTTPS://hub.example.com/', 'wss://hub.example.com'],
        ['ws://h:4790/connect', 'ws://h:4790'],
        // Controller ruling (hub review): `/`, then `/connect`, then `/` - a `/connect/` must not
        // survive, or `<base>/hub/info` would hit the socket's 426 and read as an older server.
        ['ws://h:4790/connect/', 'ws://h:4790'],
        ['ws://h:4790/', 'ws://h:4790'],
        ['wss://example.com/worbus/', 'wss://example.com/worbus'],
        ['wss://example.com/worbus/connect', 'wss://example.com/worbus'],
        ['https://example.com/a/b', 'wss://example.com/a/b'],
        ['WS://h:4790', 'ws://h:4790'],
        ['[::1]:4790', 'ws://[::1]:4790'],
        ['ws://alice:secret@h:4790/x', 'ws://h:4790/x'],
        ['', null],
        ['   ', null],
        ['ftp://h:4790', null],
        ['ws://', null],
        ['ws:///path', null],
    ];
    for (const [input, expected] of cases) {
        assert.equal(normaliseHubAddress(input), expected, JSON.stringify(input));
    }
    // Every derived URL appends to the base, path kept.
    assert.equal(httpBaseOfAddress('wss://example.com/worbus'), 'https://example.com/worbus');
    assert.equal(httpBaseOfAddress('ws://h:4790/connect'), 'http://h:4790');
    assert.equal(httpBaseOfAddress(''), null);
});

test('classify_private_tailscale_public', () => {
    const cases: [string, ReturnType<typeof classifyHubAddress>][] = [
        // 127.0.0.0/8
        ['ws://127.0.0.1:4790', 'private'],
        ['ws://127.255.255.254:4790', 'private'],
        ['ws://128.0.0.1:4790', 'public'],
        // 10.0.0.0/8
        ['ws://10.0.0.1:4790', 'private'],
        ['ws://10.255.255.255:4790', 'private'],
        ['ws://11.0.0.1:4790', 'public'],
        ['ws://9.255.255.255:4790', 'public'],
        // 172.16.0.0/12
        ['ws://172.16.0.1:4790', 'private'],
        ['ws://172.31.255.255:4790', 'private'],
        ['ws://172.15.255.255:4790', 'public'],
        ['ws://172.32.0.0:4790', 'public'],
        // 192.168.0.0/16
        ['ws://192.168.1.20:4790', 'private'],
        ['ws://192.169.0.1:4790', 'public'],
        ['ws://192.167.255.255:4790', 'public'],
        // 169.254.0.0/16
        ['ws://169.254.10.1:4790', 'private'],
        ['ws://169.255.0.1:4790', 'public'],
        // 100.64.0.0/10 (Tailscale)
        ['ws://100.64.0.1:4790', 'tailscale'],
        ['ws://100.127.255.255:4790', 'tailscale'],
        ['ws://100.63.255.255:4790', 'public'],
        ['ws://100.128.0.0:4790', 'public'],
        // IPv6
        ['ws://[::1]:4790', 'private'],
        ['ws://[::2]:4790', 'public'],
        ['ws://[fc00::1]:4790', 'private'],
        ['ws://[fdff:ffff::1]:4790', 'private'],
        ['ws://[fe00::1]:4790', 'public'],
        ['ws://[fe80::1]:4790', 'private'],
        ['ws://[febf::1]:4790', 'private'],
        ['ws://[fec0::1]:4790', 'public'],
        ['ws://[2001:db8::1]:4790', 'public'],
        // names
        ['ws://localhost:4790', 'private'],
        ['ws://localhost.example.com:4790', 'public'],
        ['ws://tower.local:4790', 'private'],
        ['ws://local.example.com:4790', 'public'],
        ['ws://box.tail1234.ts.net', 'tailscale'],
        ['wss://ts.net.example.com', 'public'],
        ['wss://hub.example.com', 'public'],
        ['wss://hub.example.com/worbus', 'public'],
    ];
    for (const [url, expected] of cases) {
        assert.equal(classifyHubAddress(url), expected, url);
    }
    assert.equal(probeTimeoutMs('ws://192.168.1.20:4790'), 1500);
    assert.equal(probeTimeoutMs('ws://100.100.1.1:4790'), 1500);
    assert.equal(probeTimeoutMs('wss://hub.example.com'), 5000);
});

test('default_address_not_migrated (blank)', () => {
    assert.deepEqual(migrateFrom('', false), EMPTY_HUB_SERVER_RECORD);
    assert.deepEqual(migrateFrom('   ', true), EMPTY_HUB_SERVER_RECORD);
});

test('typed_address_migrated', () => {
    const migrated = migrateFrom('192.168.1.20:4790/connect', true);
    assert.deepEqual(migrated, {
        addresses: [{ lastOkAt: null, source: 'typed', url: 'ws://192.168.1.20:4790' }],
        learnedOff: false,
        name: null,
        promptDismissed: [],
        serverId: null,
    });
});

test('order_private_first_then_newest', () => {
    const r = record({
        addresses: [
            addr('wss://hub.example.com', 'learned', 900),
            addr('ws://192.168.1.20:4790', 'typed', 100),
            addr('ws://100.100.1.1:4790', 'found', 500),
            addr('wss://other.example.com', 'typed', null),
            addr('ws://10.0.0.5:4790', 'found', null),
        ],
        serverId: ID_A,
    });
    assert.deepEqual(
        connectOrder(r).map((a) => a.url),
        [
            'ws://100.100.1.1:4790',
            'ws://192.168.1.20:4790',
            'ws://10.0.0.5:4790',
            'wss://hub.example.com',
            'wss://other.example.com',
        ],
    );
});

test('learned_ws_rejected', () => {
    const base = record({ addresses: [addr('ws://192.168.1.20:4790', 'typed', 1)] });
    for (const publicUrl of ['ws://hub.example.com', 'http://hub.example.com', 'ws://10.0.0.1']) {
        const next = applyWelcomeServer(base, { id: ID_A, name: 'Home', publicUrl });
        assert.equal(next.serverId, ID_A);
        assert.equal(
            next.addresses.some((a) => a.source === 'learned'),
            false,
            `${publicUrl} must never be stored as learned`,
        );
    }
    // `https://` is the same as `wss://`.
    const https = applyWelcomeServer(base, {
        id: ID_A,
        name: 'Home',
        publicUrl: 'https://hub.example.com',
    });
    assert.deepEqual(
        https.addresses.find((a) => a.source === 'learned'),
        addr('wss://hub.example.com', 'learned'),
    );
});

test('learned_replaced_and_removed', () => {
    const base = record({ addresses: [addr('ws://192.168.1.20:4790', 'typed', 1)] });
    const first = applyWelcomeServer(base, {
        id: ID_A,
        name: 'Home',
        publicUrl: 'wss://hub.example.com',
    });
    const kept = applyWelcomeServer(
        {
            ...first,
            addresses: first.addresses.map((a) =>
                a.source === 'learned' ? { ...a, lastOkAt: 42 } : a,
            ),
        },
        { id: ID_A, name: 'Home', publicUrl: 'wss://hub.example.com/' },
    );
    assert.equal(kept.addresses.find((a) => a.source === 'learned')?.lastOkAt, 42, 'same url');
    const replaced = applyWelcomeServer(first, {
        id: ID_A,
        name: 'Home',
        publicUrl: 'wss://worbus.example.org',
    });
    assert.deepEqual(
        replaced.addresses.filter((a) => a.source === 'learned').map((a) => a.url),
        ['wss://worbus.example.org'],
        'exactly one learned entry',
    );
    const removed = applyWelcomeServer(replaced, { id: ID_A, name: 'Home' });
    assert.equal(removed.addresses.filter((a) => a.source === 'learned').length, 0);
    assert.deepEqual(removed.addresses, base.addresses, 'typed untouched');
    // A malformed `server` changes nothing.
    assert.equal(applyWelcomeServer(base, { id: 'not-hex', name: 'x' }), base);
    assert.equal(applyWelcomeServer(base, undefined), base);
});

test('learned_off_excluded', () => {
    const r = record({
        addresses: [
            addr('ws://192.168.1.20:4790', 'typed', 1),
            addr('wss://hub.example.com', 'learned', 2),
        ],
        learnedOff: true,
        serverId: ID_A,
    });
    assert.deepEqual(
        connectOrder(r).map((a) => a.url),
        ['ws://192.168.1.20:4790'],
    );
    // Still stored (the switch shows it), and a welcome keeps it there, still switched off.
    const next = applyWelcomeServer(r, { id: ID_A, name: 'x', publicUrl: 'wss://hub.example.com' });
    assert.equal(next.learnedOff, true);
    assert.equal(next.addresses.filter((a) => a.source === 'learned').length, 1);
    assert.deepEqual(
        connectOrder({ ...r, learnedOff: false }).map((a) => a.url),
        ['ws://192.168.1.20:4790', 'wss://hub.example.com'],
    );
});

test('other_server_id_gets_no_secret', () => {
    const typed = addr('ws://192.168.1.20:4790', 'typed', 100);
    const r = record({ addresses: [typed], serverId: ID_A });
    const outcome = classifyInfoAnswer(200, info(ID_B), ID_A);
    assert.deepEqual(outcome, { kind: 'otherServer', serverId: ID_B });
    assert.equal(admitsAddress(r, typed, outcome), false);
    assert.equal(selectAddress(r, new Map([[typed.url, outcome]])), null, 'nothing to dial');
    // ...and with a second address answering as this server, that one is chosen instead.
    const learned = addr('wss://hub.example.com', 'learned', null);
    const both = record({ addresses: [typed, learned], serverId: ID_A });
    const outcomes = new Map<string, InfoOutcome>([
        [learned.url, classifyInfoAnswer(200, info(ID_A), ID_A)],
        [typed.url, outcome],
    ]);
    assert.equal(selectAddress(both, outcomes)?.url, learned.url);
    // The match's own id is re-checked: a `match` naming another id is never admitted.
    assert.equal(admitsAddress(r, typed, { kind: 'match', name: 'x', serverId: ID_B }), false);
});

test('older_answer_uses_typed_never_learned', () => {
    const older = classifyInfoAnswer(426, 'Upgrade Required', ID_A);
    assert.deepEqual(older, { kind: 'older' });
    assert.deepEqual(classifyInfoAnswer(404, '', ID_A), { kind: 'older' });
    const typedOk = addr('ws://192.168.1.20:4790', 'typed', 100);
    const foundOk = addr('ws://10.0.0.5:4790', 'found', 90);
    const learnedOk = addr('wss://hub.example.com', 'learned', 80);
    const typedNever = addr('ws://192.168.1.21:4790', 'typed', null);
    const r = record({ addresses: [typedOk, foundOk, learnedOk, typedNever], serverId: ID_A });
    assert.equal(admitsAddress(r, typedOk, older), true, 'typed that last passed');
    assert.equal(admitsAddress(r, foundOk, older), true, 'found that last passed');
    assert.equal(admitsAddress(r, learnedOk, older), false, 'never a learned one');
    assert.equal(admitsAddress(r, typedNever, older), false, 'never passed: no');
    // Only the learned one left: nothing to dial.
    const onlyLearned = record({ addresses: [learnedOk], serverId: ID_A });
    assert.equal(selectAddress(onlyLearned, new Map([[learnedOk.url, older]])), null);
    // No id yet (an older server): the typed address is used exactly as today.
    const noId = record({ addresses: [typedNever] });
    assert.equal(admitsAddress(noId, typedNever, older), true);
    // Anything else is not this server.
    for (const outcome of [{ kind: 'notWorbus' }, { kind: 'unreachable' }] as InfoOutcome[]) {
        assert.equal(admitsAddress(r, typedOk, outcome), false, outcome.kind);
    }
    assert.deepEqual(classifyInfoAnswer(200, '<html>', ID_A), { kind: 'notWorbus' });
    assert.deepEqual(classifyInfoAnswer(502, '', ID_A), { kind: 'notWorbus' });
    assert.deepEqual(
        classifyInfoAnswer(200, JSON.stringify({ serverId: ID_A, service: 'other' }), ID_A),
        { kind: 'notWorbus' },
    );
    assert.deepEqual(classifyInfoAnswer(200, info(ID_B, 'Den'), null), {
        kind: 'match',
        name: 'Den',
        serverId: ID_B,
    });
    // Review I3: `lastOkAt` counts only when earned WITH this id. A project 2 era record: typed X
    // passed against an older hub B (no id). Y, server A, connects: the id becomes A, and X's
    // pass (made with no id) no longer admits it on an older answer - A's secret never goes to B.
    const x = addr('ws://192.168.1.20:4790', 'typed', 100);
    const y = addr('ws://192.168.1.30:4790', 'typed', null);
    const p2Era = record({ addresses: [x, y] });
    assert.equal(admitsAddress(p2Era, x, older), true, 'before any id: as today');
    const afterA = welcomeAt(p2Era, y.url, { id: ID_A, name: 'A' }, 200);
    const xNow = afterA.addresses.find((a) => a.url === x.url);
    assert.ok(xNow);
    assert.equal(xNow.lastOkAt, null, 'its pass was not as A');
    assert.equal(afterA.addresses.find((a) => a.url === y.url)?.lastOkAt, 200);
    assert.equal(admitsAddress(afterA, xNow, older), false);
    // The same after a welcome that changes the id.
    const toB = welcomeAt(afterA, x.url, { id: ID_B, name: 'B' }, 300);
    const yNow = toB.addresses.find((a) => a.url === y.url);
    assert.ok(yNow);
    assert.equal(admitsAddress(toB, yNow, older), false, 'passed as A, not as B');
    // A welcome with the same id keeps every pass.
    const again = welcomeAt(afterA, y.url, { id: ID_A, name: 'A' }, 400);
    assert.deepEqual(
        again.addresses.map((a) => a.lastOkAt),
        [null, 400],
    );
});

test('typed_not_worbus_dialled_until_id_known', () => {
    // M5: project 2 dialled a typed address blindly; a proxy in front may answer `/hub/info`
    // with a page or a 5xx. With no id known, a typed one is still dialled; never a found or
    // learned one, never once an id is known.
    const notWorbus: InfoOutcome = { kind: 'notWorbus' };
    const typed = addr('ws://192.168.1.20:4790', 'typed', null);
    const found = addr('ws://192.168.1.21:4790', 'found', null);
    assert.equal(admitsAddress(record({ addresses: [typed] }), typed, notWorbus), true);
    assert.equal(admitsAddress(record({ addresses: [found] }), found, notWorbus), false);
    const known = record({ addresses: [{ ...typed, lastOkAt: 5 }], serverId: ID_A });
    assert.equal(admitsAddress(known, known.addresses[0], notWorbus), false);
});

test('normalise_drops_query_and_fragment', () => {
    // M1: nothing after `?` or `#` is part of an address (a pasted token is never stored).
    assert.equal(normaliseHubAddress('ws://h:4790?x=1'), 'ws://h:4790');
    assert.equal(
        normaliseHubAddress('https://hub.example.com/worbus/connect?token=s3cret#a'),
        'wss://hub.example.com/worbus',
    );
    assert.equal(httpBaseOfAddress('ws://h:4790/?x=1'), 'http://h:4790');
});

test('found addresses: a plain-text public one is never stored, another id replaces', () => {
    const r = record({ addresses: [addr('ws://192.168.1.20:4790', 'typed', 5)], serverId: ID_A });
    const same = withFound(r, {
        addresses: ['wss://hub.example.com', 'ws://music.example.com:4790'],
        name: 'Home',
        serverId: ID_A,
    });
    assert.deepEqual(
        same.addresses.map((a) => `${a.source} ${a.url}`),
        ['typed ws://192.168.1.20:4790', 'found wss://hub.example.com'],
    );
    const other = withFound(
        { ...r, promptDismissed: ['x'] },
        { addresses: ['ws://10.0.0.9:4790'], name: 'Den', serverId: ID_B },
    );
    assert.equal(other.serverId, ID_B);
    assert.deepEqual(other.promptDismissed, ['x']);
    assert.deepEqual(
        other.addresses.map((a) => a.url),
        ['ws://10.0.0.9:4790'],
    );
});

test('removing the last address that ever passed forgets the server', () => {
    const r = record({
        addresses: [
            addr('ws://192.168.1.20:4790', 'typed', 5),
            addr('ws://10.0.0.9:4790', 'typed'),
        ],
        name: 'Home',
        serverId: ID_A,
    });
    const kept = removeAddress(
        { ...r, addresses: [...r.addresses, addr('ws://10.0.0.8:4790', 'found', 9)] },
        'ws://192.168.1.20:4790',
    );
    assert.equal(kept.serverId, ID_A);
    const forgot = removeAddress(r, 'ws://192.168.1.20:4790');
    assert.equal(forgot.serverId, null);
    assert.deepEqual(
        forgot.addresses.map((a) => a.url),
        ['ws://10.0.0.9:4790'],
    );
});

test('serverKey: the id once known, else the address', () => {
    assert.equal(serverKey(record({}), 'ws://h:4790'), 'ws://h:4790');
    assert.equal(serverKey(record({ serverId: ID_A }), 'ws://h:4790'), `id:${ID_A}`);
});

test('learned_off_with_nothing_else_passed_forgets_server', () => {
    // F6 walk (W-2): set to A, which taught its learned address and was reached through it; then
    // the person adds B's address, removes A's, and switches the learned one off. Before, the
    // learned entry's pass kept A's id for good: B was skipped as another server on every
    // reconnect and the device read "Can't reach" with no way left in the UI to change server.
    const learned = { lastOkAt: 9, source: 'learned' as const, url: 'wss://hub.example.com' };
    const r: HubServerRecord = {
        ...EMPTY_HUB_SERVER_RECORD,
        addresses: [learned, { lastOkAt: null, source: 'typed', url: 'ws://127.0.0.1:4798' }],
        name: 'Home',
        serverId: ID_A,
    };
    // While the learned address may be used, it is still A's way in: A is kept.
    assert.equal(applyServerEdit(r, { op: 'learnedOff', value: false }).serverId, ID_A);
    const off = applyServerEdit(r, { op: 'learnedOff', value: true });
    assert.equal(off.serverId, null, 'nothing usable has passed as A: A is forgotten');
    assert.deepEqual(
        off.addresses.map((a) => a.url),
        ['ws://127.0.0.1:4798'],
    );
    // The same when the learned address was off already and the last passed typed one goes.
    const before: HubServerRecord = {
        ...r,
        addresses: [
            learned,
            { lastOkAt: 5, source: 'typed', url: 'ws://127.0.0.1:4799' },
            r.addresses[1],
        ],
        learnedOff: true,
    };
    assert.equal(removeAddress(before, 'ws://127.0.0.1:4799').serverId, null);
    // A typed address that passed keeps the server, learned off or not.
    const home: HubServerRecord = {
        ...r,
        addresses: [learned, { lastOkAt: 5, source: 'typed', url: 'ws://192.168.1.20:4790' }],
    };
    assert.equal(applyServerEdit(home, { op: 'learnedOff', value: true }).serverId, ID_A);
});
