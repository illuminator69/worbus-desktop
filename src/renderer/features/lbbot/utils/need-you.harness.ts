import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { LbBotActivityRequest } from '../../../../shared/utils/lbbot-activity.ts';

import { activityRequests } from '../../../../shared/utils/lbbot-activity.ts';
import { needYouCount, needYouItems } from './need-you.ts';

/**
 * node --test src/renderer/features/lbbot/utils/need-you.harness.ts
 *
 * The owner, 2026-11-13: "no separation for requests between clients". Activity's Need you chip and
 * its sidebar badge counted this device's ledger only, so a request another client made that failed,
 * or waits on a pick, was nobody's. One set now: every request lb-bot's `/lb/activity` lists as
 * failed or picking, plus this device's ledger rows that need you and that lb-bot does not list.
 */

type Row = {
    groupId: string;
    isGap: boolean;
    key: string;
    outcome: string;
    releaseMbid: string;
    settled: boolean;
};

const ledgerRow = (patch: Partial<Row>): Row => ({
    groupId: '',
    isGap: false,
    key: 'rg-1',
    outcome: 'failed',
    releaseMbid: 'rel-1',
    settled: true,
    ...patch,
});

const request = (patch: Partial<LbBotActivityRequest>): LbBotActivityRequest => ({
    album: 'Album',
    albumId: '',
    artist: 'Artist',
    failureKind: '',
    gapFill: false,
    groupId: '',
    reason: '',
    releaseMbid: 'rel-1',
    retryable: false,
    rgid: 'rg-1',
    state: 'failed',
    updatedAt: 0,
    ...patch,
});

test("another client's failed request and one waiting on a pick count, with no ledger row here", () => {
    const requests = [
        request({ releaseMbid: 'rel-other', rgid: 'rg-other' }),
        request({ gapFill: true, groupId: 'g-2', releaseMbid: 'rel-gap', state: 'picking' }),
    ];
    assert.equal(needYouCount([], requests), 2);
    const items = needYouItems([], requests);
    assert.ok(items.every((item) => item.ledger === null && item.server !== null));
});

test('a request lb-bot lists that this device also holds is one item, joined by release or group', () => {
    const rows = [
        ledgerRow({}),
        ledgerRow({ groupId: 'g-2', isGap: true, key: 'g-2', outcome: 'needsPick', releaseMbid: '' }),
    ];
    const requests = [
        request({}),
        request({ gapFill: true, groupId: 'g-2', releaseMbid: 'rel-gap', state: 'picking' }),
    ];
    assert.equal(needYouCount(rows, requests), 2);
    const items = needYouItems(rows, requests);
    assert.ok(items.every((item) => item.ledger !== null && item.server !== null), 'joined');
});

test("this device's row that needs you and that lb-bot no longer lists still counts", () => {
    assert.equal(needYouCount([ledgerRow({ releaseMbid: 'rel-forgotten' })], [request({})]), 2);
});

test("lb-bot's row wins the state: a failure retried elsewhere and landed is no longer counted", () => {
    const rows = [ledgerRow({})];
    for (const state of ['verified', 'downloading', 'searching', 'placed', 'cancelled']) {
        assert.equal(needYouCount(rows, [request({ state })]), 0, state);
    }
});

test("lb-bot's live and finished requests are not counted", () => {
    const requests = ['verified', 'downloading', 'searching', 'placing', 'cancelled'].map(
        (state, i) => request({ releaseMbid: `rel-${i}`, state }),
    );
    assert.equal(needYouCount([], requests), 0);
});

test("no answer from lb-bot (an older one, not an admin, not read yet): the ledger's own set", () => {
    const rows = [
        ledgerRow({}),
        ledgerRow({ key: 'rg-2', outcome: 'needsPick', releaseMbid: 'rel-2' }),
        ledgerRow({ key: 'rg-3', outcome: 'cancelled', releaseMbid: 'rel-3' }),
        ledgerRow({ key: 'rg-4', outcome: 'running', releaseMbid: 'rel-4', settled: false }),
    ];
    assert.equal(needYouCount(rows, null), 2);
});

test('activityRequests: the allowlist, a row without a state or a key dropped', () => {
    const rows = activityRequests({
        requests: [
            { ...request({}), extra: 'x', path: '/mnt/music' },
            { releaseMbid: 'rel-2' },
            { groupId: '', releaseMbid: '', state: 'failed' },
            'not a row',
        ],
        version: 1,
    });
    assert.equal(rows?.length, 1);
    assert.deepEqual(Object.keys(rows![0]).sort(), Object.keys(request({})).sort());
    assert.equal(activityRequests({ error: 'nope' }), null, 'no requests list: no answer');
    assert.equal(activityRequests(null), null);
});

test('the badge and the chip read the one set', () => {
    const read = (path: string) => readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
    const sidebar = read('src/renderer/features/sidebar/components/sidebar-groups.tsx');
    assert.match(sidebar, /attentionCount: needYouCount\(ledger, activity\)/);
    const route = read('src/renderer/features/lbbot/routes/lbbot-downloads-route.tsx');
    assert.match(route, /needYouItems\(rows, activity\)/);
});
