import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { LbBotActivityRequest } from '../../../../shared/utils/lbbot-activity.ts';
import type { LbBotAttentionAlbum } from '../../../../shared/utils/lbbot-attention.ts';
import type { LedgerRow } from '../stores/active-fills.store.ts';
import type { DismissedRequest } from './need-you.ts';

import { activityRequests, screenRead } from '../../../../shared/utils/lbbot-activity.ts';
import { attentionAlbums } from '../../../../shared/utils/lbbot-attention.ts';
import { singleFlight } from '../../../../shared/utils/single-flight.ts';
import {
    dismissalsStillListed,
    drawnRow,
    needYouCount,
    needYouItems,
    serverLedgerRow,
} from './need-you.ts';

/**
 * node --test src/renderer/features/lbbot/utils/need-you.harness.ts
 *
 * The owner, 2026-11-13: Need you makes "no separation for requests between clients" - one set,
 * one number, from any client. The set is built from three sources, in the shapes lb-bot actually
 * sends (read in `Lb-bot-missing/listenbrainz_bot.py`, 2026-11-14):
 *
 * - `/lb/activity` (`_activity_view`): the album-fill LEDGER, every client's. Its `state` is the
 *   ledger's: searching, queued, downloading, placing, placed, verified, failed, cancelled,
 *   needs_match. Never `picking`. A gap fill writes a ledger row only once its placement runs, so
 *   for a gap the row is the last fill that reached placement, not the gap's state now.
 * - `/lb/attention` (`_attention_view`) `albums`: failed gaps and picks (`kind: gap`, the review
 *   group's own status now, `failed` or `picking`) and failed requests (`kind: request`).
 * - this device's ledger (`useFillLedger`).
 *
 * lb-bot wins only when its row is the newer state of the same request (review H1).
 */

const T0 = 1_700_000_000; // lb-bot's clock, epoch seconds
const ms = (seconds: number) => seconds * 1000;

const ledgerRow = (patch: Partial<LedgerRow>): LedgerRow =>
    ({
        album: 'Album',
        allFiles: false,
        artist: 'Artist',
        attempts: 0,
        bytesDone: 0,
        bytesTotal: 0,
        cancellable: false,
        done: 0,
        failed: 0,
        failureKind: '',
        groupId: '',
        isGap: false,
        key: 'rg-1',
        lastCheckedAt: 0,
        lastError: '',
        lastErrorTicks: 0,
        lastSourcePeer: '',
        leftOut: 0,
        mp3WouldHelp: false,
        otherSourceExcludes: [],
        outcome: 'failed',
        percent: 0,
        reason: '',
        releaseMbid: 'rel-1',
        retryable: true,
        retryAt: 0,
        rgid: 'rg-1',
        settled: true,
        sortAt: ms(T0 + 60),
        speedBps: 0,
        stalledPlacement: false,
        state: 'failed',
        total: 0,
        verifyGaveUp: false,
        ...patch,
    }) as LedgerRow;

/** A `/lb/activity` row, as `_activity_view` builds it (after main's allowlist). */
const activity = (patch: Partial<LbBotActivityRequest>): LbBotActivityRequest => ({
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
    updatedAt: T0,
    ...patch,
});

/** A `/lb/attention` `albums` row, as `_attention_view` builds it (after main's allowlist). */
const attention = (patch: Partial<LbBotAttentionAlbum>): LbBotAttentionAlbum => ({
    album: 'Album',
    albumId: 'nd-1',
    artist: 'Artist',
    groupId: 'g-1',
    kind: 'gap',
    releaseMbid: 'rel-canon',
    rgid: 'rg-1',
    state: 'picking',
    updatedAt: T0,
    ...patch,
});

const count = (input: Partial<Parameters<typeof needYouCount>[0]>) =>
    needYouCount({ activity: null, attention: null, dismissed: [], ledger: [], ...input });
const items = (input: Partial<Parameters<typeof needYouItems>[0]>) =>
    needYouItems({ activity: null, attention: null, dismissed: [], ledger: [], ...input });

// ---- H1: the vocabulary lb-bot speaks --------------------------------------------------------

test("P1: this device's own needs_match album fill still counts when lb-bot lists it", () => {
    const rows = [ledgerRow({ state: 'needs_match' })];
    assert.equal(count({ ledger: rows }), 1, 'ledger only');
    assert.equal(count({ activity: [activity({ state: 'needs_match' })], ledger: rows }), 1);
});

test("P2: another client's needs_match request counts, and so does its failed one", () => {
    assert.equal(
        count({
            activity: [activity({ releaseMbid: 'rel-x', rgid: 'rg-x', state: 'needs_match' })],
        }),
        1,
    );
    assert.equal(count({ activity: [activity({ releaseMbid: 'rel-y', rgid: 'rg-y' })] }), 1);
});

test("P3: this device's gap waiting on a pick is not hidden by an earlier verified fill of its group", () => {
    const rows = [
        ledgerRow({
            groupId: 'g-1',
            isGap: true,
            key: 'g-1',
            outcome: 'needsPick',
            releaseMbid: '',
            rgid: '',
            sortAt: ms(T0 + 600),
            state: '',
        }),
    ];
    const verifiedEarlier = activity({
        gapFill: true,
        groupId: 'g-1',
        releaseMbid: 'rel-canon',
        state: 'verified',
        updatedAt: T0,
    });
    assert.equal(count({ ledger: rows }), 1, 'ledger only');
    assert.equal(count({ activity: [verifiedEarlier], ledger: rows }), 1, 'lb-bot older: ours');
    // The other way round: the gap filled from another client after ours stopped - done.
    const verifiedLater = { ...verifiedEarlier, updatedAt: T0 + 1200 };
    assert.equal(count({ activity: [verifiedLater], ledger: rows }), 0, 'lb-bot newer: theirs');
});

test("P3': this device's failed gap, with an older verified ledger row for the same group, counts", () => {
    const rows = [
        ledgerRow({
            groupId: 'g-1',
            isGap: true,
            key: 'g-1',
            outcome: 'failed',
            releaseMbid: '',
            rgid: '',
            sortAt: ms(T0 + 600),
        }),
    ];
    const verified = activity({ gapFill: true, groupId: 'g-1', state: 'verified' });
    assert.equal(count({ activity: [verified], ledger: rows }), 1);
});

test("another client's gap waiting on a pick comes from /lb/attention's albums", () => {
    const picks = [attention({})];
    assert.equal(count({ attention: picks }), 1);
    const [item] = items({ attention: picks });
    assert.equal(item.ledger, null);
    assert.equal(item.server?.state, 'picking');
    assert.equal(serverLedgerRow(item.server!).outcome, 'needsPick');
});

test("the gap's own status is not overruled by a finished fill of its group", () => {
    // A partly filled gap: lb-bot verified one fill and the group still misses tracks (picking).
    const listed = {
        activity: [
            activity({ gapFill: true, groupId: 'g-1', state: 'verified', updatedAt: T0 + 50 }),
        ],
        attention: [attention({ updatedAt: T0 })],
    };
    assert.equal(count(listed), 1);
    // ...but a fill of it in flight now is: nobody needs to pick while it runs.
    const running = {
        activity: [activity({ groupId: 'g-1', state: 'downloading', updatedAt: T0 + 50 })],
        attention: [attention({ updatedAt: T0 })],
    };
    assert.equal(count(running), 0);
});

test('a failed request /lb/attention and /lb/activity both list is one item', () => {
    assert.equal(
        count({
            activity: [activity({})],
            attention: [
                attention({ groupId: '', kind: 'request', releaseMbid: 'rel-1', state: 'failed' }),
            ],
        }),
        1,
    );
});

test("lb-bot's live and finished requests are not counted", () => {
    const rows = [
        'verified',
        'downloading',
        'searching',
        'queued',
        'placing',
        'placed',
        'cancelled',
    ].map((state, i) => activity({ releaseMbid: `rel-${i}`, rgid: `rg-${i}`, state }));
    assert.equal(count({ activity: rows }), 0);
});

test('lb-bot newer than our row wins: a failure retried elsewhere and landed is done', () => {
    const rows = [ledgerRow({ sortAt: ms(T0) })];
    for (const state of ['verified', 'downloading', 'searching', 'placed', 'cancelled']) {
        assert.equal(
            count({ activity: [activity({ state, updatedAt: T0 + 30 })], ledger: rows }),
            0,
            state,
        );
    }
});

test("this device's row that needs you and that lb-bot no longer lists still counts", () => {
    assert.equal(
        count({
            activity: [activity({})],
            ledger: [ledgerRow({ key: 'rg-gone', releaseMbid: 'rel-gone', rgid: 'rg-gone' })],
        }),
        2,
    );
});

test("no answer from lb-bot (an older one, not an admin, not read yet): the ledger's own set", () => {
    const rows = [
        ledgerRow({}),
        ledgerRow({ key: 'rg-2', outcome: 'needsPick', releaseMbid: 'rel-2', rgid: 'rg-2' }),
        ledgerRow({ key: 'rg-3', outcome: 'cancelled', releaseMbid: 'rel-3', rgid: 'rg-3' }),
        ledgerRow({
            key: 'rg-4',
            outcome: 'running',
            releaseMbid: 'rel-4',
            rgid: 'rg-4',
            settled: false,
        }),
    ];
    assert.equal(count({ ledger: rows }), 2);
});

// ---- M1: Dismiss and Add to wishlist clear the item here --------------------------------------

test('P4: a dismissed failure stays dismissed against the row lb-bot keeps for 24 h', () => {
    const dismissed: DismissedRequest[] = [
        {
            album: 'Album',
            artist: 'Artist',
            at: ms(T0 + 120),
            groupId: '',
            isGap: false,
            releaseMbid: 'rel-1',
            rgid: 'rg-1',
        },
    ];
    assert.equal(count({ activity: [activity({})], dismissed }), 0);
    // A newer state of that request (retried elsewhere and failed again) is news: it shows.
    assert.equal(count({ activity: [activity({ updatedAt: T0 + 600 })], dismissed }), 1);
});

test('a dismissed gap stays dismissed against its pick and its fill rows', () => {
    const dismissed: DismissedRequest[] = [
        {
            album: 'Album',
            artist: 'Artist',
            at: ms(T0 + 120),
            groupId: 'g-1',
            isGap: true,
            releaseMbid: '',
            rgid: '',
        },
    ];
    assert.equal(
        count({
            activity: [activity({ gapFill: true, groupId: 'g-1', releaseMbid: 'rel-canon' })],
            attention: [attention({})],
            dismissed,
        }),
        0,
    );
});

test('a dismissal is forgotten once lb-bot lists nothing for it, never on a missing answer', () => {
    const d: DismissedRequest = {
        album: 'Album',
        artist: 'Artist',
        at: ms(T0 + 120),
        groupId: '',
        isGap: false,
        releaseMbid: 'rel-1',
        rgid: 'rg-1',
    };
    assert.deepEqual(dismissalsStillListed([d], [activity({})], []), [d]);
    assert.deepEqual(dismissalsStillListed([d], [], []), []);
    assert.deepEqual(dismissalsStillListed([d], null, []), [d], 'activity not read');
    assert.deepEqual(dismissalsStillListed([d], [], null), [d], 'attention not read');
});

test('a row only lb-bot knows says so without claiming whose it is', () => {
    const route = readFileSync(
        new URL('../routes/lbbot-downloads-route.tsx', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(route, /Requested from another device/);
    assert.match(route, /Requested elsewhere\./);
});

// ---- L1: one request, one item, one key -----------------------------------------------------

test('P5: two lb-bot rows (two releases) of one group and our gap row are one item', () => {
    const rows = [
        ledgerRow({ groupId: 'g-1', isGap: true, key: 'g-1', releaseMbid: '', rgid: '' }),
    ];
    const listed = items({
        activity: [
            activity({ groupId: 'g-1', releaseMbid: 'rel-a', updatedAt: T0 - 10 }),
            activity({ groupId: 'g-1', releaseMbid: 'rel-b', updatedAt: T0 - 20 }),
        ],
        ledger: rows,
    });
    assert.equal(listed.length, 1);
});

test('P6: a gap fill whose review group is gone (no groupId) is not counted twice', () => {
    const rows = [
        ledgerRow({ groupId: 'g-1', isGap: true, key: 'g-1', releaseMbid: '', rgid: '' }),
    ];
    const gone = activity({ gapFill: true, groupId: '', releaseMbid: 'rel-gap', rgid: '' });
    assert.equal(count({ activity: [gone], ledger: rows }), 1);
    // An empty id never joins two unrelated rows either.
    const other = activity({
        album: 'Other',
        artist: 'Else',
        gapFill: true,
        groupId: '',
        releaseMbid: 'rel-z',
        rgid: '',
    });
    assert.equal(count({ activity: [gone, other], ledger: rows }), 2);
});

test('every item has a unique, stable key', () => {
    const listed = items({
        activity: [
            activity({ releaseMbid: 'rel-x', rgid: 'rg-x' }),
            activity({ groupId: 'g-9', releaseMbid: 'rel-y', rgid: '' }),
        ],
        attention: [attention({ groupId: 'g-2', releaseMbid: 'rel-c2', rgid: 'rg-2' })],
        ledger: [
            ledgerRow({}),
            ledgerRow({ groupId: 'g-3', isGap: true, key: 'g-3', releaseMbid: '', rgid: '' }),
        ],
    });
    const keys = listed.map((item) => item.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(listed.length, 5);
    const again = items({
        activity: [
            activity({ groupId: 'g-9', releaseMbid: 'rel-y', rgid: '' }),
            activity({ releaseMbid: 'rel-x', rgid: 'rg-x' }),
        ],
        attention: [attention({ groupId: 'g-2', releaseMbid: 'rel-c2', rgid: 'rg-2' })],
        ledger: [
            ledgerRow({ groupId: 'g-3', isGap: true, key: 'g-3', releaseMbid: '', rgid: '' }),
            ledgerRow({}),
        ],
    });
    assert.deepEqual(new Set(again.map((item) => item.key)), new Set(keys));
});

// ---- L3: drawn from the state that decided ---------------------------------------------------

test("P7: a local Retry started after lb-bot's failure is in flight, not Need you", () => {
    const rows = [
        ledgerRow({ outcome: 'running', settled: false, sortAt: ms(T0 + 5), state: 'searching' }),
    ];
    assert.equal(count({ activity: [activity({ updatedAt: T0 })], ledger: rows }), 0);
});

test("P8: our cancelled row under lb-bot's newer failure is drawn as lb-bot's failure", () => {
    const rows = [ledgerRow({ outcome: 'cancelled', sortAt: ms(T0), state: 'cancelled' })];
    const listed = items({
        activity: [activity({ reason: 'No peer had it', updatedAt: T0 + 30 })],
        ledger: rows,
    });
    assert.equal(listed.length, 1);
    const row = drawnRow(listed[0])!;
    assert.equal(row.outcome, 'failed');
    assert.equal(row.state, 'failed');
    assert.equal(row.reason, 'No peer had it');
    assert.equal(row.key, 'rg-1', "this device's key: its buttons act on its own row");
});

test("a row this device decided is drawn as this device's", () => {
    const rows = [ledgerRow({ reason: 'ours', sortAt: ms(T0 + 60) })];
    const listed = items({
        activity: [activity({ reason: 'theirs', updatedAt: T0 })],
        ledger: rows,
    });
    assert.equal(drawnRow(listed[0])?.reason, 'ours');
});

// ---- L2: a failed read is not an answer ------------------------------------------------------

test('L2: a failed screen read rejects; only a route lb-bot does not have is "no answer"', () => {
    const parse = (data: unknown) => activityRequests(data);
    assert.deepEqual(screenRead({ data: { requests: [] }, ok: true, status: 200 }, parse), []);
    assert.equal(screenRead({ data: null, ok: false, status: 404 }, parse), null, 'older lb-bot');
    assert.equal(
        screenRead({ code: 'lbbot_too_old', data: null, ok: false, status: 503 }, parse),
        null,
        'too old for this hub',
    );
    for (const failed of [
        { data: null, ok: false, status: 502 },
        { code: 'busy', data: null, ok: false, status: 504 },
        { data: null, ok: false, status: 500 },
        { data: null, ok: false, status: 0 },
        { code: 'not_found', data: null, ok: false, status: 404 },
    ]) {
        assert.throws(() => screenRead(failed, parse), undefined, JSON.stringify(failed));
    }
});

// ---- L4: one read in flight ----------------------------------------------------------------

test('L4: reads asked for during a read share one follow-up read', async () => {
    let calls = 0;
    const gates: (() => void)[] = [];
    const read = singleFlight(
        () =>
            new Promise<number>((resolve) => {
                calls += 1;
                const n = calls;
                gates.push(() => resolve(n));
            }),
    );
    const first = read();
    const burst = [read(), read(), read(), read()];
    assert.equal(calls, 1, 'one in flight');
    gates[0]();
    assert.equal(await first, 1);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls, 2, 'the burst made one more read, after the first');
    gates[1]();
    assert.deepEqual(await Promise.all(burst), [2, 2, 2, 2], 'the burst sees the read after it');
    // A failed read does not wedge it.
    const failing = singleFlight(() => Promise.reject(new Error('down')));
    await assert.rejects(failing());
    await assert.rejects(failing());
});

test('L4: the Need you reads drop what they hold when the user may no longer read them', () => {
    const hooks = readFileSync(new URL('../hooks/use-lbbot.ts', import.meta.url), 'utf8');
    const slice = (name: string) =>
        hooks.slice(hooks.indexOf(`export const ${name}`)).slice(0, 2400);
    for (const name of ['useLbBotActivity', 'useLbBotAttention']) {
        assert.match(slice(name), /useAdminLbRead\(/, name);
    }
    assert.match(hooks, /removeQueries\(\{ exact: true, queryKey \}\)/);
    const main = readFileSync(
        new URL('../../../../main/features/core/lbbot/index.ts', import.meta.url),
        'utf8',
    );
    assert.match(main, /'lbbot-activity',\s*singleFlight\(/);
    assert.match(main, /'lbbot-attention-counts',\s*singleFlight\(/);
});

// ---- the allowlists --------------------------------------------------------------------------

test('activityRequests: the allowlist, a row without a state or a key dropped', () => {
    const rows = activityRequests({
        requests: [
            { ...activity({}), extra: 'x', path: '/mnt/music' },
            { releaseMbid: 'rel-2' },
            { groupId: '', releaseMbid: '', state: 'failed' },
            'not a row',
        ],
        version: 1,
    });
    assert.equal(rows?.length, 1);
    assert.deepEqual(Object.keys(rows![0]).sort(), Object.keys(activity({})).sort());
    assert.equal(activityRequests({ error: 'nope' }), null, 'no requests list: no answer');
    assert.equal(activityRequests(null), null);
});

test("attentionAlbums: the allowlist, lb-bot's real row shape", () => {
    const rows = attentionAlbums({
        albums: [
            {
                album: 'A',
                albumId: 'nd-1',
                artist: 'B',
                coverUrl: 'https://coverartarchive.org/x',
                groupId: 'g-1',
                key: 'g-1',
                kind: 'gap',
                missingCount: 3,
                releaseMbid: 'rel-c',
                rgid: 'rg-1',
                state: 'picking',
                total: 10,
                updatedAt: T0,
            },
            { kind: 'request', releaseMbid: 'rel-2', state: 'failed', updatedAt: T0 },
            { kind: 'gap', state: 'picking' },
            { kind: 'other', releaseMbid: 'rel-3', state: 'failed' },
            null,
        ],
    });
    assert.equal(rows?.length, 2);
    assert.deepEqual(Object.keys(rows![0]).sort(), Object.keys(attention({})).sort());
    assert.equal(attentionAlbums({ counts: {} }), null, 'no albums list: no answer');
});

// ---- the badge and the chip read the one set -------------------------------------------------

test('the badge and the chip read the one set', () => {
    const read = (path: string) =>
        readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
    const sidebar = read('src/renderer/features/sidebar/components/sidebar-groups.tsx');
    assert.match(sidebar, /attentionCount: needYou\.length/);
    assert.match(sidebar, /const needYou = useNeedYou\(\)/);
    const route = read('src/renderer/features/lbbot/routes/lbbot-downloads-route.tsx');
    assert.match(route, /const needYou = useNeedYou\(\)/);
    const store = read('src/renderer/features/lbbot/stores/active-fills.store.ts');
    assert.match(store, /dismissed: \[\.\.\.state\.dismissed/, 'Dismiss remembers the request');
});
