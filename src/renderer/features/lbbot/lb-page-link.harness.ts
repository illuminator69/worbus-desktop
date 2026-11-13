import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isPrivateAddress } from '../../../shared/utils/hub-addresses.ts';
import { serverVersionCopy } from '../settings/components/server/server-status.ts';
import {
    attentionImports,
    importsRow,
    lbPageLink,
    serverVersionOf,
    toFixCount,
} from './lb-page-link.ts';

/**
 * Worbus P4 lane F, F3:  node --test src/renderer/features/lbbot/lb-page-link.harness.ts
 *
 * A failed import that used to arrive as a Telegram message shows in Needs attention as one row
 * linking to lb-bot's page (design §6.4, §6.5). The same seven cases as Worbus for Android's N4, with the same
 * inputs and outputs. `counts.imports` comes from `/lb/attention`; absent means 0.
 */

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const SETTLED_FAILED = { outcome: 'failed', settled: true };
const RUNNING = { outcome: '', settled: false };

test('imports_counted_in_to_fix', () => {
    const answer = {
        counts: {
            failedGaps: 2,
            failedRequests: 1,
            folders: 1,
            foldersUnidentified: 0,
            imports: 2,
            picks: 3,
        },
    };
    // Worbus for desktop's to-fix number is its own ledger's failures (the sidebar badge) plus the
    // imports and (B-406, the phone's units) the folders waiting to be filed.
    assert.equal(toFixCount([SETTLED_FAILED, RUNNING], answer), 4);
    assert.equal(toFixCount([SETTLED_FAILED], null), 1, 'no answer: the ledger alone');
    assert.equal(toFixCount([], { counts: { failedGaps: 4 } }), 0, 'an older lb-bot: no imports');
    // The badge reads it.
    assert.match(
        read('src/renderer/features/sidebar/components/sidebar-groups.tsx'),
        /toFixCount\(ledger, attention, downloadsOn\)/,
    );
});

test('imports_row_only_when_positive', () => {
    assert.equal(importsRow(0, 'https://lb.example.org/#/needs/imports'), null);
    assert.equal(importsRow(-1, null), null);
    assert.deepEqual(importsRow(1, null), { count: 1, link: null });
    assert.deepEqual(importsRow(3, 'https://lb.example.org/#/needs/imports'), {
        count: 3,
        link: 'https://lb.example.org/#/needs/imports',
    });
});

test('link_uses_web_url', () => {
    assert.equal(
        lbPageLink('https://lb.example.org', 'wss://hub.example.org', isPrivateAddress),
        'https://lb.example.org/#/needs/imports',
    );
    assert.equal(
        lbPageLink('https://lb.example.org/', 'ws://192.168.1.20:4790', isPrivateAddress),
        'https://lb.example.org/#/needs/imports',
    );
});

test('link_from_private_hub_host', () => {
    assert.equal(
        lbPageLink('', 'ws://192.168.1.20:4790', isPrivateAddress),
        'http://192.168.1.20:8899/#/needs/imports',
    );
    assert.equal(
        lbPageLink('', 'ws://[fd00::20]:4790', isPrivateAddress),
        'http://[fd00::20]:8899/#/needs/imports',
    );
});

test('no_link_from_public_host', () => {
    assert.equal(lbPageLink('', 'wss://hub.example.org', isPrivateAddress), null);
    assert.equal(lbPageLink('', null, isPrivateAddress), null, 'no address in use');
});

test('unknown_attention_keys_ignored', () => {
    const answer = {
        albums: [],
        counts: { failedGaps: 0, imports: 2, laterKey: 9 },
        laterTopLevel: { x: 1 },
        version: 1,
    };
    assert.equal(attentionImports(answer), 2);
    assert.equal(attentionImports({ counts: { failedGaps: 1 } }), 0, 'absent means 0');
    assert.equal(attentionImports({ counts: { imports: 'two' } }), 0);
    assert.equal(attentionImports(null), 0);
});

test('server_version_shown', () => {
    const server = { id: 'a'.repeat(32), name: 'Home', publicUrl: '', version: '0.4.0 (678af87)' };
    assert.equal(serverVersionOf(server), '0.4.0 (678af87)');
    assert.equal(serverVersionOf({ id: 'a'.repeat(32), name: 'Home' }), null, 'absent: no line');
    assert.equal(serverVersionOf(undefined), null);
    assert.deepEqual(serverVersionCopy(serverVersionOf(server)), {
        key: 'serverVersion',
        values: { version: '0.4.0 (678af87)' },
    });
    assert.equal(serverVersionCopy(null), null);
    // The welcome is read into the store, and the Server tab's line comes from i18n.
    assert.match(
        read('src/renderer/features/hub/hooks/use-hub.tsx'),
        /serverVersion: serverVersionOf\(msg\.server\)/,
    );
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    assert.equal(en.setting.worbus.serverVersion, 'Server version {{version}}');
});

test('the row says the fixed sentences, and its button opens the system browser', () => {
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const copy = en.naviConnect.imports;
    assert.equal(copy.title_one, '{{count}} import needs you');
    assert.equal(copy.title_other, '{{count}} imports need you');
    assert.equal(copy.line, "lb-bot couldn't finish filing these albums.");
    assert.equal(copy.lineAway, "Open lb-bot's page on your home network to fix them.");
    assert.equal(copy.open, 'Open in lb-bot');
    const row = read('src/renderer/features/lbbot/components/imports-row.tsx');
    // A `_blank` window is handed to shell.openExternal by main's setWindowOpenHandler.
    assert.match(row, /target="_blank"/);
    // B-406: the row is the To fix section's first, on the Downloads page.
    assert.match(
        read('src/renderer/features/lbbot/components/to-fix-section.tsx'),
        /<ImportsRow \/>/,
    );
    assert.match(
        read('src/renderer/features/lbbot/routes/lbbot-downloads-route.tsx'),
        /<ToFixSection \/>/,
    );
});
