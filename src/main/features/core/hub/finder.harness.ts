import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { HubFinderState, InfoOutcome, InfoProbe } from './addresses.ts';
import type { NetInterfaces } from './finder.ts';

import { createAutoLook } from '../../../../renderer/features/hub/utils/hub-finder-auto.ts';
import {
    notSetView,
    promptFor,
} from '../../../../renderer/features/settings/components/server/server-status.ts';
import { createInfoProbe } from './addresses.ts';
import {
    candidatesFor,
    findHomeAddress,
    homeBesideNavidrome,
    lookBeside,
    ownSubnets,
    sweep,
} from './finder.ts';

/**
 * Worbus P3 lane F, F4:  node --test src/main/features/core/hub/finder.harness.ts
 *
 * Looking for the Worbus Server (design §6.4): beside Navidrome (its host on 4790, then `hub.` and
 * `worbus.` beside a three-label name), and on a tap the device's own /24. Only `GET /hub/info`
 * is ever sent.
 */

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const match = (serverId = ID_A, name = 'Worbus Server'): InfoOutcome => ({
    kind: 'match',
    name,
    serverId,
});
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** A probe that answers from a table and records every call. */
const tableProbe = (table: Record<string, InfoOutcome>) => {
    const calls: { base: string; timeoutMs: number }[] = [];
    const probe: InfoProbe = async (base, timeoutMs) => {
        calls.push({ base, timeoutMs });
        return table[base] ?? { kind: 'unreachable' };
    };
    return { calls, probe };
};

const nic = (address: string, extra: Partial<{ family: string; internal: boolean }> = {}) => ({
    address,
    family: 'IPv4',
    internal: false,
    netmask: '255.255.255.0',
    ...extra,
});

test('candidates_for_ip_host', () => {
    assert.deepEqual(candidatesFor(['http://192.168.1.20:4533']), ['ws://192.168.1.20:4790']);
    assert.deepEqual(candidatesFor(['http://[fd00::5]:4533/']), ['ws://[fd00::5]:4790']);
});

test('candidates_for_three_label_name', () => {
    assert.deepEqual(candidatesFor(['https://music.example.com']), [
        'ws://music.example.com:4790',
        'wss://hub.example.com',
        'wss://worbus.example.com',
    ]);
    assert.deepEqual(candidatesFor(['https://music.home.example.org/navidrome']), [
        'ws://music.home.example.org:4790',
        'wss://hub.home.example.org',
        'wss://worbus.home.example.org',
    ]);
});

test('no_siblings_for_two_labels', () => {
    assert.deepEqual(candidatesFor(['https://example.com']), ['ws://example.com:4790']);
    assert.deepEqual(candidatesFor(['http://tower.local:4533']), ['ws://tower.local:4790']);
    assert.deepEqual(candidatesFor(['http://localhost:4533']), ['ws://localhost:4790']);
    assert.deepEqual(candidatesFor(['not a url', '']), []);
});

test('remote_url_host_is_a_candidate', () => {
    // The current server's `url` and `remoteUrl` (domain-types.ts), both hosts, deduplicated.
    assert.deepEqual(
        candidatesFor([
            'http://192.168.1.20:4533',
            'https://music.example.com',
            'http://192.168.1.20:80',
        ]),
        [
            'ws://192.168.1.20:4790',
            'ws://music.example.com:4790',
            'wss://hub.example.com',
            'wss://worbus.example.com',
        ],
    );
});

test('results_grouped_by_server_id', async () => {
    const { probe } = tableProbe({
        'ws://192.168.1.20:4790': match(ID_A, 'Home'),
        'ws://music.example.com:4790': match(ID_B, 'Other'),
        'wss://hub.example.com': match(ID_A, 'Home'),
    });
    const found = await lookBeside(
        ['http://192.168.1.20:4533', 'https://music.example.com'],
        probe,
    );
    const servers = found.filter((f) => f.kind === 'server');
    assert.equal(servers.length, 1, 'the public plain-text one is not a server row');
    assert.deepEqual(servers[0], {
        addresses: ['ws://192.168.1.20:4790', 'wss://hub.example.com'],
        kind: 'server',
        name: 'Home',
        serverId: ID_A,
    });
    const two = await lookBeside(
        ['http://192.168.1.20:4533', 'http://10.0.0.5:4533'],
        tableProbe({
            'ws://10.0.0.5:4790': match(ID_B, 'Den'),
            'ws://192.168.1.20:4790': match(ID_A, 'Home'),
        }).probe,
    );
    assert.deepEqual(
        two.map((f) => (f.kind === 'server' ? f.serverId : f.kind)),
        [ID_A, ID_B],
    );
});

test('older_only_at_navidrome_host', async () => {
    const older: InfoOutcome = { kind: 'older' };
    // A home host (a public one is never offered: public_http_found_not_offered).
    const { probe } = tableProbe({
        'ws://music.home.local:4790': older,
        'wss://hub.home.local': older,
        'wss://worbus.home.local': older,
    });
    assert.deepEqual(await lookBeside(['https://music.home.local'], probe), [
        { address: 'ws://music.home.local:4790', kind: 'olderAt' },
    ]);
    // The sweep never reports a 426: any WebSocket server answers one.
    const swept = await sweep({
        interfaces: () => ({ eth0: [nic('192.168.1.37')] }),
        now: () => 0,
        probe: async () => older,
    });
    assert.deepEqual(swept, { kind: 'results', results: [] });
});

test('public_http_found_not_offered', async () => {
    const { probe } = tableProbe({ 'ws://music.example.com:4790': match() });
    assert.deepEqual(await lookBeside(['https://music.example.com'], probe), [
        { address: 'ws://music.example.com:4790', kind: 'notEncrypted' },
    ]);
    // A private or Tailscale plain-text one is offered.
    const home = tableProbe({ 'ws://100.101.1.2:4790': match() });
    assert.equal((await lookBeside(['http://100.101.1.2:4533'], home.probe))[0].kind, 'server');
    // Review I1: an older server's 426 on a public host is plain text too - its sign-in would
    // carry the Navidrome token pair over the internet. Not an `olderAt`, and never prompted.
    const older = tableProbe({ 'ws://music.example.com:4790': { kind: 'older' } });
    const results = await lookBeside(['https://music.example.com'], older.probe);
    assert.deepEqual(results, [{ address: 'ws://music.example.com:4790', kind: 'notEncrypted' }]);
    const state: HubFinderState = { kind: 'results', results, scope: 'beside' };
    assert.equal(promptFor(state, null, false), null, 'nothing is offered');
    assert.deepEqual(
        notSetView(state, 'alice').rows.map((r) => r.action),
        [null],
        'no Use this address',
    );
});

test('sweep_bounded_to_own_24', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: { base: string; timeoutMs: number }[] = [];
    const result = await sweep({
        interfaces: () => ({ eth0: [nic('192.168.1.37')] }),
        now: () => 0,
        probe: async (base, timeoutMs) => {
            seen.push({ base, timeoutMs });
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setImmediate(resolve));
            inFlight -= 1;
            return base === 'ws://192.168.1.37:4790' ? match() : { kind: 'unreachable' };
        },
    });
    const expected = Array.from({ length: 254 }, (_, i) => `ws://192.168.1.${i + 1}:4790`);
    assert.deepEqual(seen.map((s) => s.base).sort(), [...expected].sort(), 'the 254 hosts, 4790');
    assert.equal(new Set(seen.map((s) => s.base)).size, 254, 'each once');
    assert.ok(seen.every((s) => s.timeoutMs <= 700));
    assert.equal(peak, 32, 'at most 32 at a time');
    assert.deepEqual(result, {
        kind: 'results',
        results: [
            {
                addresses: ['ws://192.168.1.37:4790'],
                kind: 'server',
                name: 'Worbus Server',
                serverId: ID_A,
            },
        ],
    });
    // The 10 s cap: on a clock that moves 100 ms per probe, nothing starts after 10 s and no
    // probe's timeout reaches past it.
    let clock = 0;
    const capped: { at: number; timeoutMs: number }[] = [];
    await sweep({
        interfaces: () => ({ eth0: [nic('192.168.1.37')] }),
        now: () => clock,
        probe: async (_base, timeoutMs) => {
            capped.push({ at: clock, timeoutMs });
            clock += 100;
            await new Promise((resolve) => setImmediate(resolve));
            return { kind: 'unreachable' };
        },
    });
    assert.ok(capped.length < 254, `stopped early (${capped.length})`);
    assert.ok(capped.every((p) => p.at < 10_000 && p.at + p.timeoutMs <= 10_000));
});

test('sweep_skips_public_and_virtual_interfaces', () => {
    const interfaces: NetInterfaces = {
        'br-1a2b': [nic('172.18.0.1')],
        docker0: [nic('172.17.0.1')],
        enp3s0: [nic('169.254.3.3')],
        eth1: [nic('8.8.4.4')],
        lo: [nic('127.0.0.1', { internal: true })],
        tailscale0: [nic('100.101.1.2')],
        veth12: [nic('10.1.1.1')],
        virbr0: [nic('192.168.122.1')],
        wlan0: [nic('10.0.0.5'), nic('fe80::1', { family: 'IPv6' })],
    };
    assert.deepEqual(ownSubnets(interfaces), ['10.0.0']);
    // At most two interfaces.
    assert.deepEqual(
        ownSubnets({
            eth0: [nic('192.168.1.37')],
            eth1: [nic('192.168.2.37')],
            wlan0: [nic('10.0.0.5')],
        }),
        ['192.168.1', '192.168.2'],
    );
    // Two addresses in one /24 are swept once. Node 18's numeric family is read too.
    assert.deepEqual(
        ownSubnets({ eth0: [nic('192.168.1.37'), { ...nic('192.168.1.38'), family: 4 as never }] }),
        ['192.168.1'],
    );
    // M13: interfaces are counted, not subnets - an interface with addresses in two /24s is one
    // interface (its first), and the second interface is still swept.
    assert.deepEqual(
        ownSubnets({
            eth0: [nic('192.168.1.37'), nic('192.168.5.37')],
            wlan0: [nic('10.0.0.5')],
        }),
        ['192.168.1', '10.0.0'],
    );
});

test('the sweep needs a private address on a real interface', async () => {
    const probed = tableProbe({});
    assert.deepEqual(
        await sweep({
            interfaces: () => ({ docker0: [nic('172.17.0.1')], eth1: [nic('8.8.4.4')] }),
            now: () => 0,
            probe: probed.probe,
        }),
        { kind: 'notOnWifi', results: [] },
    );
    assert.equal(probed.calls.length, 0, 'nothing sent');
});

test('home_address_only_same_id', async () => {
    const deps = (table: Record<string, InfoOutcome>) => ({
        interfaces: () => ({ eth0: [nic('192.168.1.37')] }),
        now: () => 0,
        probe: tableProbe(table).probe,
    });
    assert.equal(
        await findHomeAddress(ID_A, deps({ 'ws://192.168.1.20:4790': match(ID_B) })),
        null,
        'another server on this network is not this one',
    );
    assert.equal(
        await findHomeAddress(
            ID_A,
            deps({ 'ws://192.168.1.20:4790': match(ID_B), 'ws://192.168.1.21:4790': match(ID_A) }),
        ),
        'ws://192.168.1.21:4790',
    );
    // The silent look on a reconnect: Navidrome's host on 4790 only, this id only, private only.
    const beside = tableProbe({
        'ws://192.168.1.20:4790': match(ID_A),
        'ws://music.example.com:4790': match(ID_A),
        'wss://hub.example.com': match(ID_A),
    });
    assert.deepEqual(
        await homeBesideNavidrome(
            ['http://192.168.1.20:4533', 'https://music.example.com'],
            ID_A,
            beside.probe,
        ),
        ['ws://192.168.1.20:4790'],
    );
    assert.deepEqual(
        beside.calls.map((c) => c.base),
        ['ws://192.168.1.20:4790'],
    );
    assert.deepEqual(
        await homeBesideNavidrome(
            ['http://192.168.1.20:4533'],
            ID_B,
            tableProbe({ 'ws://192.168.1.20:4790': match(ID_A) }).probe,
        ),
        [],
    );
});

test('autolook_runs_when_no_server_set', () => {
    const looks: string[][] = [];
    const run = (configured: boolean, urls: string[] = ['http://192.168.1.20:4533']) =>
        createAutoLook({
            configured: () => configured,
            look: (u) => {
                looks.push(u);
                return Promise.resolve();
            },
            navidromeUrls: () => urls,
        })();
    assert.equal(run(false), true);
    assert.deepEqual(looks, [['http://192.168.1.20:4533']]);
    assert.equal(run(true), false, 'not when a server is set');
    assert.equal(run(false, []), false, 'nothing to look beside');
    assert.equal(looks.length, 1);
    // Wired after a server is added, with "no server set" read as !isHubConfigured.
    const auto = read('../../../../renderer/features/hub/utils/hub-finder-actions.ts');
    assert.match(auto, /configured: \(\) =>\s*isHubConfigured\(/);
    for (const file of [
        '../../../../renderer/features/servers/components/add-server-form.tsx',
        '../../../../renderer/features/login/routes/login-route.tsx',
    ]) {
        const src = read(file);
        const sets =
            src.match(/setCurrentServer\([^)]*\);\n(\s*\/\/[^\n]*\n)?\s*startAutoLook\(\);/g) ?? [];
        assert.ok(sets.length >= 2, `${file}: ${sets.length}`);
    }
});

test('probe_sends_no_credentials', async () => {
    const seen: { init: Record<string, unknown>; url: string }[] = [];
    const probe = createInfoProbe(async (url, init) => {
        seen.push({ init: init as unknown as Record<string, unknown>, url });
        return { status: 404, text: async () => '' };
    });
    await lookBeside(
        ['https://alice:pw@music.example.com/?u=alice&t=tok&s=salt', 'http://192.168.1.20:4533'],
        probe,
    );
    await sweep({
        interfaces: () => ({ eth0: [nic('192.168.1.37')] }),
        now: () => 0,
        probe,
    });
    assert.ok(seen.length > 254);
    for (const { init, url } of seen) {
        assert.match(url, /^https?:\/\/[^/@?]+(\/[^?]*)?\/hub\/info$/, url);
        assert.equal('body' in init, false);
        const headers = init.headers as Record<string, string>;
        assert.deepEqual(Object.keys(headers), ['Accept']);
        assert.equal(JSON.stringify(init).includes('Authorization'), false);
    }
});
