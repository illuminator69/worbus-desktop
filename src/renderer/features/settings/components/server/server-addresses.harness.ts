import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type {
    HubFinderState,
    HubFound,
    HubServerRecord,
} from '../../../../../shared/utils/hub-addresses.ts';
import type { Copy } from './server-status.ts';

import {
    applyServerEdit,
    createServerRecordStore,
} from '../../../../../main/features/core/hub/addresses.ts';
import { EMPTY_HUB_SERVER_RECORD } from '../../../../../shared/utils/hub-addresses.ts';
import { createFoundTap } from '../../../hub/utils/hub-found-tap.ts';
import {
    dismissKey,
    notSetView,
    promptFor,
    setView,
    statusRoute,
    titlesToArrive,
    typedUrlAfterRemove,
} from './server-status.ts';

/**
 * Worbus P3 lane F, F5:
 *   node --test src/renderer/features/settings/components/server/server-addresses.harness.ts
 *
 * The Server tab finds the server and lists its addresses (design §6.4, §6.6): not set - the found
 * rows, an older one, a plain-text one, Look on this network, Type an address, each finder state's
 * sentence; set - the address the socket is on, the others, the list (remove, the learned switch,
 * add), Find home address; the status line names the route; the post-sign-in prompt asks once.
 * Every sentence is read from en.json and checked against design §6.6 verbatim.
 */

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const en = JSON.parse(read('../../../../../i18n/locales/en.json')).setting.worbus as Record<
    string,
    string
>;
/** i18next's `{{name}}`, as the component renders it. */
const say = (copy: Copy | null): string => {
    if (!copy) return '';
    const template = en[copy.key];
    assert.equal(typeof template, 'string', `en.json setting.worbus.${copy.key}`);
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => copy.values?.[k] ?? `<${k}?>`);
};

const finder = (patch: Partial<HubFinderState>): HubFinderState => ({
    kind: 'results',
    results: [],
    scope: 'beside',
    ...patch,
});
const server = (serverId = ID_A, addresses = ['ws://192.168.1.20:4790']): HubFound => ({
    addresses,
    kind: 'server',
    name: 'Worbus Server',
    serverId,
});
const record = (patch: Partial<HubServerRecord>): HubServerRecord => ({
    ...EMPTY_HUB_SERVER_RECORD,
    ...patch,
});

test('status_names_route_for_each_class', () => {
    const r = record({ serverId: ID_A });
    const line = (active: null | string) =>
        statusRoute(active)
            .map((c) => say(c))
            .join(' · ');
    assert.equal(line('ws://192.168.1.20:4790'), 'home network');
    assert.equal(line('ws://tower.local:4790'), 'home network');
    assert.equal(line('ws://100.101.1.2:4790'), 'Tailscale');
    assert.equal(line('wss://box.tail1234.ts.net'), 'Tailscale');
    assert.equal(line('wss://hub.example.com'), 'via hub.example.com');
    assert.equal(line('wss://example.com/worbus'), 'via example.com');
    assert.equal(line('ws://music.example.com:4790'), 'via music.example.com · not encrypted');
    assert.equal(line(null), '');
    // The project 2 sentence it is appended to.
    const src = read('./worbus-server-settings.tsx');
    assert.match(src, /statusRoute\(/);
    void r;
});

test('not_set_rows_for_each_finder_state', () => {
    const sentence = (state: HubFinderState) => say(notSetView(state, 'alice').sentence);
    // Design §6.6, verbatim.
    assert.equal(sentence(finder({ kind: 'looking' })), 'Looking for your Worbus Server…');
    assert.equal(
        sentence(finder({ kind: 'nothingBeside' })),
        'No Worbus Server found beside your Navidrome. Look on this network, or type its address.',
    );
    assert.equal(
        sentence(finder({ kind: 'nothingOnNetwork', scope: 'network' })),
        'No Worbus Server answered on this network.',
    );
    assert.equal(
        sentence(finder({ kind: 'notOnWifi', scope: 'network' })),
        'Connect to your home Wi-Fi to look on this network.',
    );
    assert.equal(sentence(finder({ kind: 'idle', scope: null })), '');
    // Results: one row per server, then an older one, then a plain-text line.
    const view = notSetView(
        finder({
            results: [
                server(ID_A, ['wss://hub.example.com', 'ws://192.168.1.20:4790']),
                { address: 'ws://192.168.1.30:4790', kind: 'olderAt' },
                { address: 'ws://music.example.com:4790', kind: 'notEncrypted' },
            ],
        }),
        'alice',
    );
    assert.deepEqual(
        view.rows.map((row) => [row.kind, say(row.title), say(row.action)]),
        [
            ['server', 'Worbus Server · 192.168.1.20', 'Sign in as alice'],
            ['older', 'An older Worbus Server may be at 192.168.1.30.', 'Use this address'],
            [
                'notEncrypted',
                'Found a Worbus Server at music.example.com:4790, but not encrypted',
                '',
            ],
        ],
    );
    // The found server's row names the home address, and that is the one tapped.
    assert.equal(view.rows[0].address, 'ws://192.168.1.20:4790');
    // No music server account: the row is there, with no sign-in to offer.
    assert.equal(notSetView(finder({ results: [server()] }), null).rows[0].action, null);
    // The two actions and the words that are not sentences.
    for (const [key, text] of Object.entries({
        findHomeAddress: 'Find home address',
        lookOnNetwork: 'Look on this network',
        notNow: 'Not now',
        typeAddress: 'Type an address',
        useAwayFromHome: 'Use away from home',
    })) {
        assert.equal(en[key], text, key);
    }
    // A found row says found, never connected (design §6.6).
    assert.doesNotMatch(JSON.stringify(en), /[Cc]onnected/);
});

test('sign_in_tap_saves_found_sets_url_and_enables', async () => {
    const calls: string[] = [];
    const tap = createFoundTap({
        edit: async (op) => {
            calls.push(`edit ${JSON.stringify(op)}`);
        },
        setHub: (patch) => calls.push(`settings ${JSON.stringify(patch)}`),
        signIn: async () => {
            calls.push('signIn');
        },
        stopLooking: () => calls.push('stopLooking'),
    });
    const found = server(ID_A, ['wss://hub.example.com', 'ws://192.168.1.20:4790']);
    await tap(found, 'ws://192.168.1.20:4790');
    assert.deepEqual(calls, [
        'stopLooking',
        `edit ${JSON.stringify({
            found: {
                addresses: ['wss://hub.example.com', 'ws://192.168.1.20:4790'],
                name: 'Worbus Server',
                serverId: ID_A,
            },
            op: 'adoptFound',
        })}`,
        `settings ${JSON.stringify({ enabled: true, url: 'ws://192.168.1.20:4790' })}`,
        'signIn',
    ]);
    // An older server: saved by its address, no id.
    calls.length = 0;
    await tap({ address: 'ws://192.168.1.30:4790', kind: 'olderAt' }, 'ws://192.168.1.30:4790');
    assert.match(calls[1], /"serverId":null/);
    assert.match(calls[2], /"url":"ws:\/\/192\.168\.1\.30:4790"/);
    // Main saves them as `found`, under the server's id.
    const plain: Record<string, unknown> = {};
    const records = createServerRecordStore({
        onChange: () => {},
        store: { get: (k) => plain[k], set: (k, v) => (plain[k] = v) },
    });
    records.update((r) =>
        applyServerEdit(r, {
            found: { addresses: found.addresses, name: 'Worbus Server', serverId: ID_A },
            op: 'adoptFound',
        }),
    );
    const saved = plain.hubServer as HubServerRecord;
    assert.equal(saved.serverId, ID_A);
    assert.deepEqual(
        saved.addresses.map((a) => `${a.source} ${a.url}`),
        ['found wss://hub.example.com', 'found ws://192.168.1.20:4790'],
    );
    // Wired: the Server tab's row and the prompt both go through it.
    assert.match(read('../../../hub/utils/hub-signin-actions.ts'), /createFoundTap\(\{/);
});

test('sheet_once_per_server', () => {
    const one = finder({ results: [server()] });
    assert.equal(promptFor(one, record({}), false), one.results[0]);
    const dismissed = applyServerEdit(record({}), {
        key: dismissKey(one.results[0]),
        op: 'dismiss',
    });
    assert.deepEqual(dismissed.promptDismissed, [ID_A]);
    assert.equal(promptFor(one, dismissed, false), null, 'asked once');
    assert.ok(
        promptFor(finder({ results: [server(ID_B)] }), dismissed, false),
        'another server is asked',
    );
    // An older server is remembered by its address.
    const older: HubFound = { address: 'ws://192.168.1.30:4790', kind: 'olderAt' };
    assert.equal(dismissKey(older), 'ws://192.168.1.30:4790');
    assert.equal(
        promptFor(
            finder({ results: [older] }),
            applyServerEdit(record({}), { key: dismissKey(older), op: 'dismiss' }),
            false,
        ),
        null,
    );
    // Exactly one server; not on the network sweep; not once a server is set.
    assert.equal(promptFor(finder({ results: [server(), server(ID_B)] }), record({}), false), null);
    assert.equal(
        promptFor(finder({ results: [server()], scope: 'network' }), record({}), false),
        null,
    );
    assert.equal(promptFor(one, record({}), true), null);
    assert.equal(
        promptFor(
            finder({ results: [{ address: 'ws://m.example.com:4790', kind: 'notEncrypted' }] }),
            record({}),
            false,
        ),
        null,
    );
    // The prompt is Feishin's own confirm modal, with Not now.
    const prompt = read('../../../hub/components/hub-found-prompt.tsx');
    assert.match(prompt, /<ConfirmModal/);
    assert.match(prompt, /t\('setting\.worbus\.notNow'\)/);
    // Shown after a sign-in's look only, with promptFor deciding; Not now goes to main.
    const actions = read('../../../hub/utils/hub-finder-actions.ts');
    assert.match(actions, /promptFor\(state, useHubStore\.getState\(\)\.server\?\.record/);
    assert.match(actions, /op: 'dismiss'/);
});

test('remove_and_learned_switch_persist', () => {
    const plain: Record<string, unknown> = {
        hubServer: record({
            addresses: [
                { lastOkAt: 5, source: 'typed', url: 'ws://192.168.1.20:4790' },
                { lastOkAt: 3, source: 'found', url: 'ws://10.0.0.9:4790' },
                { lastOkAt: null, source: 'learned', url: 'wss://hub.example.com' },
            ],
            serverId: ID_A,
        }),
    };
    const store = { get: (k: string) => plain[k], set: (k: string, v: unknown) => (plain[k] = v) };
    const records = createServerRecordStore({ onChange: () => {}, store });
    records.update((r) => applyServerEdit(r, { op: 'remove', url: 'ws://192.168.1.20:4790' }));
    records.update((r) => applyServerEdit(r, { op: 'learnedOff', value: true }));
    records.update((r) => applyServerEdit(r, { op: 'add', url: '192.168.1.50:4790' }));
    // A learned address is switched off, never removed.
    records.update((r) => applyServerEdit(r, { op: 'remove', url: 'wss://hub.example.com' }));
    const reread = createServerRecordStore({ onChange: () => {}, store }).current();
    assert.equal(reread.learnedOff, true);
    assert.deepEqual(
        reread.addresses.map((a) => `${a.source} ${a.url}`),
        [
            'found ws://10.0.0.9:4790',
            'learned wss://hub.example.com',
            'typed ws://192.168.1.50:4790',
        ],
    );
    // hub.url keeps a typed or tapped address: the removed one is replaced, never by a learned one.
    assert.equal(
        typedUrlAfterRemove(reread, 'ws://192.168.1.20:4790', 'ws://192.168.1.20:4790'),
        'ws://10.0.0.9:4790',
    );
    assert.equal(typedUrlAfterRemove(reread, 'ws://10.0.0.9:4790', 'ws://192.168.1.50:4790'), null);
    // The list: the last typed or found address cannot be removed; the learned one is a switch.
    const only = record({
        addresses: [
            { lastOkAt: 5, source: 'typed', url: 'ws://192.168.1.20:4790' },
            { lastOkAt: null, source: 'learned', url: 'wss://hub.example.com' },
        ],
        learnedOff: false,
        serverId: ID_A,
    });
    const view = setView(only, 'ws://192.168.1.20:4790', 'ws://192.168.1.20:4790');
    assert.deepEqual(
        view.rows.map((row) => [row.url, row.removable]),
        [['ws://192.168.1.20:4790', false]],
    );
    assert.deepEqual(view.learned, { on: true, url: 'wss://hub.example.com' });
    assert.equal(view.primary, '192.168.1.20:4790');
    assert.deepEqual(
        view.others.map((c) => say(c)),
        ['Away from home: hub.example.com'],
    );
    assert.equal(view.findHome, false);
    const away = setView(
        record({
            addresses: [{ lastOkAt: 1, source: 'found', url: 'wss://hub.example.com' }],
            serverId: ID_A,
        }),
        'wss://hub.example.com',
        'wss://hub.example.com',
    );
    assert.equal(away.findHome, true, 'no home address: Find home address');
    // The renderer moves hub.url off a removed address.
    assert.match(
        read('../../../hub/utils/hub-finder-actions.ts'),
        /typedUrlAfterRemove\(before, url, useSettingsStore\.getState\(\)\.hub\.url\)/,
    );
    // Wired through main's one edit route.
    const index = read('../../../../../main/features/core/hub/index.ts');
    assert.match(index, /ipcMain\.handle\('hub-server-edit'/);
    assert.match(index, /applyServerEdit\(/);
});

test('found_rows_fold_in_when_they_arrive', () => {
    // F6 walk (W-4): a found row that arrives with a look (Look on this network, the look when the
    // tab opens) was mounted already open: the section jumped 46 px in one frame. A new row is now
    // drawn folded once and opens on the next frame, so its Fold eases in like every other row.
    assert.deepEqual(titlesToArrive(new Set(), ['Worbus Server · 192.168.129.194']), [
        'Worbus Server · 192.168.129.194',
    ]);
    assert.deepEqual(titlesToArrive(new Set(['a']), ['a', 'b']), ['b']);
    assert.deepEqual(titlesToArrive(new Set(['a', 'b']), ['a']), []);
    const tab = read('./worbus-server-settings.tsx');
    assert.match(tab, /isHidden: configured \|\| !drawnFound\.has\(title\),/);
    assert.match(tab, /requestAnimationFrame\(\(\) =>\s*setDrawnFound\(/);
});
