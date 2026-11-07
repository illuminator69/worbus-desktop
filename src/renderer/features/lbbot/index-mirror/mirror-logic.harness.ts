import type { LbBotIndexArtist, LbBotIndexItem } from '/@/shared/types/lbbot-types';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    EMPTY_MIRROR_META,
    isArtistStale,
    lookupByNdId,
    mirrorTotals,
    ndIdsOf,
    pageSeqLookup,
    planDrift,
    planPage,
    toDiscography,
} from './mirror-logic.ts';

/**
 * Q-003 (Worbus for desktop half): `mirror-logic.ts` has no test runner in this repo and
 * has never executed — its rules (PLAN-lbbot-index-mirror-2026-09-23 §1a) were
 * reasoned from the doc comments and Worbus for Android's Kotlin port, never run. This
 * harness runs the pure functions directly against hand-built cases derived
 * from those doc comments and from how `index-mirror.ts` calls them.
 *
 * Node 24 strips TypeScript's erasable syntax natively, so this needs no
 * devDependency and no build step:
 *
 *     node --test src/renderer/features/lbbot/index-mirror/mirror-logic.harness.ts
 *
 * (a `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr is expected and
 * harmless — this repo's package.json has no "type" field and none should be
 * added just for this file; it does not affect the exit code.)
 */

const artist = (
    over: Partial<LbBotIndexArtist> & { key: string; seq: number },
): LbBotIndexArtist => ({
    mbid: '',
    name: over.key,
    ndArtistId: '',
    rows: [],
    scannedAt: 0,
    scanVersion: 1,
    ...over,
});

const artistItem = (
    over: Partial<LbBotIndexItem> & { key: string; seq: number },
): LbBotIndexItem => ({
    mbid: '',
    name: over.key,
    ndArtistId: '',
    rows: [],
    scannedAt: 0,
    scanVersion: 1,
    type: 'artist',
    ...over,
});

const tombstone = (key: string, seq: number): LbBotIndexItem => ({ key, seq, type: 'tombstone' });

// ---------------------------------------------------------------------------
// planPage
// ---------------------------------------------------------------------------

void test('planPage: fresh epoch, no local seq — every artist item is a put', () => {
    const items = [artistItem({ key: 'a', seq: 1 }), artistItem({ key: 'b', seq: 1 })];
    const delta = planPage(() => undefined, items);
    assert.equal(delta.puts.length, 2);
    assert.deepEqual(delta.deletes, []);
    assert.deepEqual(delta.puts.map((p) => p.key).sort(), ['a', 'b']);
});

void test('planPage: page continuation — a higher seq over an existing local seq applies', () => {
    const items = [artistItem({ key: 'a', name: 'A v6', seq: 6 })];
    const delta = planPage((key) => (key === 'a' ? 5 : undefined), items);
    assert.equal(delta.puts.length, 1);
    assert.equal(delta.puts[0].seq, 6);
    assert.equal(delta.puts[0].name, 'A v6');
});

void test('planPage: an item at or below the held seq is a no-op (duplicate/out-of-order delivery)', () => {
    const equalSeq = planPage(() => 5, [artistItem({ key: 'a', seq: 5 })]);
    const lowerSeq = planPage(() => 5, [artistItem({ key: 'a', seq: 4 })]);
    assert.deepEqual(equalSeq.puts, []);
    assert.deepEqual(equalSeq.deletes, []);
    assert.deepEqual(lowerSeq.puts, []);
    assert.deepEqual(lowerSeq.deletes, []);
});

void test('planPage: the same key twice in one page is resolved against the running overlay, not local', () => {
    // localSeq never sees 'a' — both items in this one page carry it. If the
    // overlay were not consulted, the second item's `held` would come back
    // `undefined` again (from the unchanged local map) and BOTH would be
    // treated as fresh, which is still harmless for a plain artist item, so
    // the real assertion is that the FINAL value wins and there is exactly
    // one entry for the key.
    const items = [
        artistItem({ key: 'a', name: 'first', seq: 1 }),
        artistItem({ key: 'a', name: 'second', seq: 2 }),
    ];
    const delta = planPage(() => undefined, items);
    assert.equal(delta.puts.length, 1);
    assert.equal(delta.puts[0].name, 'second');
    assert.equal(delta.puts[0].seq, 2);
});

void test('planPage: the overlay blocks a stale duplicate arriving after a fresher one in the same page', () => {
    // Out-of-order WITHIN one page: seq 3 first, then seq 2 for the same key.
    // Without the overlay this would incorrectly overwrite with the older item.
    const items = [
        artistItem({ key: 'a', name: 'newer', seq: 3 }),
        artistItem({ key: 'a', name: 'older', seq: 2 }),
    ];
    const delta = planPage(() => undefined, items);
    assert.equal(delta.puts.length, 1);
    assert.equal(delta.puts[0].name, 'newer');
});

void test('planPage: a tombstone above the held seq deletes and clears any pending put', () => {
    const items = [artistItem({ key: 'a', seq: 1 }), tombstone('a', 2)];
    const delta = planPage(() => undefined, items);
    assert.deepEqual(delta.puts, []);
    assert.deepEqual(delta.deletes, ['a']);
});

void test('planPage: a tombstone for a key never held locally is a no-op (nothing to delete)', () => {
    const delta = planPage(() => undefined, [tombstone('ghost', 1)]);
    assert.deepEqual(delta.puts, []);
    assert.deepEqual(delta.deletes, []);
});

void test('planPage: a tombstone at or below the held seq is a no-op — the key was re-created after the delete', () => {
    const atSeq = planPage(() => 5, [tombstone('a', 5)]);
    const belowSeq = planPage(() => 5, [tombstone('a', 3)]);
    assert.deepEqual(atSeq.deletes, []);
    assert.deepEqual(belowSeq.deletes, []);
});

void test('planPage: empty page is a no-op', () => {
    const delta = planPage(() => undefined, []);
    assert.deepEqual(delta, { deletes: [], puts: [] });
});

void test('planPage: a mixed page keeps an artist put and a tombstone delete independent', () => {
    // 'b' must already be HELD locally for its tombstone to take effect (see
    // the "never held locally" case above) — a delete for a key this mirror
    // never had is correctly a no-op, not a bug.
    const items = [artistItem({ key: 'a', seq: 1 }), tombstone('b', 2)];
    const delta = planPage((key) => (key === 'b' ? 1 : undefined), items);
    assert.deepEqual(
        delta.puts.map((p) => p.key),
        ['a'],
    );
    assert.deepEqual(delta.deletes, ['b']);
});

// ---------------------------------------------------------------------------
// pageSeqLookup — fix-round-1 review, Critical 2
//
// `pull()` in index-mirror.ts used to plan EVERY page — a resync's first
// real page included — against `byKey`, which still holds the OLD epoch at
// that point (the wipe is deferred into the same commit as the first new
// page, so tiles don't flicker empty for a round trip). A new epoch's whole
// reason for existing is that its seq values no longer mean what the old
// cursor assumed: reset to a fresh database, or moved backwards after a
// restore. So a new epoch's first page, planned against the old epoch's
// held seqs, silently dropped every item whose new (often much lower) seq
// read at or below what the old epoch held for that same key.
// ---------------------------------------------------------------------------

void test('pageSeqLookup: pendingWipe ignores byKey entirely, regardless of what it holds', () => {
    const byKey = new Map([['a', artist({ key: 'a', seq: 100 })]]);
    assert.equal(pageSeqLookup(byKey, true)('a'), undefined);
    assert.equal(pageSeqLookup(byKey, false)('a'), 100);
});

void test('pageSeqLookup + planPage: reproduces Critical 2 — an epoch change with a LOWER seq', () => {
    // The mirror is mid-way through an OLD epoch, holding artist 'a' at a
    // high seq (100). The server mints a NEW epoch and restarts counting:
    // the same artist's first item in the new epoch's first page carries
    // seq 3 — far lower than what the OLD epoch held.
    const oldEpochByKey = new Map([['a', artist({ key: 'a', scannedAt: 1, seq: 100 })]]);
    const newEpochFirstPage = [artistItem({ key: 'a', name: 'A (new epoch)', seq: 3 })];

    // THE BUG (what `pull()` did before this fix): planning the new epoch's
    // page against the OLD epoch's held seq. 3 <= 100, so the item is
    // dropped as a false no-op — the artist silently disappears.
    const buggy = planPage((key) => oldEpochByKey.get(key)?.seq, newEpochFirstPage);
    assert.deepEqual(buggy.puts, [], 'documents the bug: the item is wrongly dropped');

    // THE FIX: `pageSeqLookup(byKey, pendingWipe=true)` ignores `byKey`
    // entirely for a resync's first real page, so the item applies.
    const fixed = planPage(pageSeqLookup(oldEpochByKey, true), newEpochFirstPage);
    assert.equal(fixed.puts.length, 1);
    assert.equal(fixed.puts[0].key, 'a');
    assert.equal(fixed.puts[0].seq, 3);
});

// ---------------------------------------------------------------------------
// mirrorTotals
// ---------------------------------------------------------------------------

void test('mirrorTotals: empty mirror', () => {
    assert.deepEqual(mirrorTotals([]), { artistCount: 0, seqSum: 0 });
});

void test('mirrorTotals: sums seq and counts artists', () => {
    const totals = mirrorTotals([artist({ key: 'a', seq: 3 }), artist({ key: 'b', seq: 5 })]);
    assert.deepEqual(totals, { artistCount: 2, seqSum: 8 });
});

// ---------------------------------------------------------------------------
// planDrift
// ---------------------------------------------------------------------------

void test('planDrift: nothing differs — no deletes, no rewind', () => {
    const local = new Map([['a', 1]]);
    const server = [{ key: 'a', seq: 1 }];
    assert.deepEqual(planDrift(local, server), { deletes: [], rewindTo: null });
});

void test('planDrift: a local key the server no longer has is deleted', () => {
    const local = new Map([['a', 1]]);
    const server: { key: string; seq: number }[] = [];
    const plan = planDrift(local, server);
    assert.deepEqual(plan.deletes, ['a']);
    assert.equal(plan.rewindTo, null);
});

void test('planDrift: a local key held at a HIGHER seq than the server is deleted (impossible-state defence)', () => {
    // An artist only applies over a LOWER seq (planPage's gate), so the
    // mirror ever holding something newer than the server is a state that
    // would otherwise block every future refetch of that key forever.
    const local = new Map([['a', 9]]);
    const server = [{ key: 'a', seq: 3 }];
    const plan = planDrift(local, server);
    assert.deepEqual(plan.deletes, ['a']);
});

void test('planDrift: a local key held at a LOWER seq than the server rewinds to just below the lowest such seq', () => {
    const local = new Map([
        ['a', 1],
        ['b', 1],
    ]);
    const server = [
        { key: 'a', seq: 1 },
        { key: 'b', seq: 5 },
    ];
    const plan = planDrift(local, server);
    assert.deepEqual(plan.deletes, []);
    assert.equal(plan.rewindTo, 4);
});

void test('planDrift: rewindTo never goes negative — the lowest differing seq is 0', () => {
    const local = new Map<string, number>();
    const server = [{ key: 'a', seq: 0 }];
    const plan = planDrift(local, server);
    assert.equal(plan.rewindTo, 0);
});

void test('planDrift: the lowest differing seq wins across several mismatched keys', () => {
    const local = new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
    ]);
    const server = [
        { key: 'a', seq: 10 },
        { key: 'b', seq: 4 },
        { key: 'c', seq: 20 },
    ];
    const plan = planDrift(local, server);
    assert.equal(plan.rewindTo, 3);
});

// ---------------------------------------------------------------------------
// A drift rewind followed by a page — fix-round-1 review, Critical 3
//
// The bug itself was NOT in these pure functions: `planDrift`'s `rewindTo`
// was always computed correctly, and the commit that persists it was always
// correct too. It was in `pull()`'s own loop, which read its local `cursor`
// variable (not `meta.cursor`) at the top of every iteration and never
// reassigned it after the drift commit — so the rewound value landed on
// disk but the very next request went out at the OLD, un-rewound cursor,
// silently undoing the rewind before it could do anything (that page's own
// `Math.max(cursor, nextSince)` then pushed `meta.cursor` straight back up).
// That is a control-flow defect — a loop variable failing to follow the
// state it just wrote — which has no meaningful expression as a pure
// function distinct from what `planDrift` already proves above: there is no
// "wrong value" to catch, only a value that was computed correctly and then
// not used. The fix (`index-mirror.ts`, in the drift branch) now reads
// `cursor = meta.cursor; epoch = meta.epoch;` from what `commit()` actually
// persisted, rather than recomputing or trusting stale locals — verified by
// reading the code, not by a test, per this round's own instructions where
// "the logic lives in index-mirror.ts rather than mirror-logic.ts."
//
// What IS a pure-function contract, and IS covered here: once a rewind
// takes effect and the loop re-pulls from the rewound cursor, the page that
// comes back must apply correctly against the mirror's CURRENT state (which
// the drift's own deletes may just have changed) — i.e. `planPage`'s
// ordinary seq gate, not a special case. This is the scenario named in the
// review ("a drift rewind followed by a page"), worked end to end.
// ---------------------------------------------------------------------------

void test('drift rewind followed by a page: the deletes apply, then the re-pulled page applies over the (now smaller) local state', () => {
    // The mirror holds three artists. The server's key listing (from
    // `/lb/index/keys`) says: 'a' matches, 'b' is a key the server no
    // longer has at all (deleted upstream), 'c' differs (the mirror missed
    // an update — held at 5, server is at 9).
    const byKey = new Map([
        ['a', artist({ key: 'a', seq: 20 })],
        ['b', artist({ key: 'b', seq: 7 })],
        ['c', artist({ key: 'c', seq: 5 })],
    ]);
    const localSeqs = new Map([...byKey].map(([key, a]) => [key, a.seq]));
    const server = [
        { key: 'a', seq: 20 },
        { key: 'c', seq: 9 },
    ];
    const plan = planDrift(localSeqs, server);
    assert.deepEqual(plan.deletes, ['b']);
    // rewindTo = the one differing key's server seq (9), minus one.
    assert.equal(plan.rewindTo, 8);

    // Apply the drift's OWN delta first, exactly as `commit()` does — 'b'
    // leaves `byKey`, matching the fixed loop's next iteration.
    for (const key of plan.deletes) byKey.delete(key);
    assert.deepEqual([...byKey.keys()].sort(), ['a', 'c']);

    // The re-pulled page, fetched from the rewound cursor (8), carries the
    // update the mirror missed: 'c' at the server's real seq (9).
    const rewoundPage = [artistItem({ key: 'c', name: 'C (repaired)', seq: 9 })];
    const delta = planPage((key) => byKey.get(key)?.seq, rewoundPage);
    assert.equal(delta.puts.length, 1);
    assert.equal(delta.puts[0].key, 'c');
    assert.equal(delta.puts[0].seq, 9);
    assert.equal(delta.puts[0].name, 'C (repaired)');
});

// ---------------------------------------------------------------------------
// ndIdsOf
// ---------------------------------------------------------------------------

void test('ndIdsOf: an ndArtistId and a matching nd: key collapse via the Set, still both present when they differ', () => {
    const both = ndIdsOf(artist({ key: 'nd:42', ndArtistId: '99', seq: 1 }));
    assert.deepEqual(new Set(both), new Set(['42', '99']));
});

void test('ndIdsOf: neither field present is empty — an id is never indexed unset', () => {
    assert.deepEqual(ndIdsOf(artist({ key: '11111111-1111-1111-1111-111111111111', seq: 1 })), []);
});

void test('ndIdsOf: an `nd:` key of length 3 (empty id) contributes nothing', () => {
    // `artist.key.length > 3` guards exactly this: "nd:" with nothing after it.
    assert.deepEqual(ndIdsOf(artist({ key: 'nd:', seq: 1 })), []);
});

void test('ndIdsOf: a bare mbid key with no ndArtistId is empty', () => {
    assert.deepEqual(ndIdsOf(artist({ key: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', seq: 1 })), []);
});

// ---------------------------------------------------------------------------
// lookupByNdId
// ---------------------------------------------------------------------------

void test('lookupByNdId: an mbid hits the byKey map directly, ahead of the ndId index', () => {
    const mbidArtist = artist({ key: 'mb:1', ndArtistId: 'nd-1', seq: 1 });
    const byKey = new Map([['mb:1', mbidArtist]]);
    const keysByNdId = new Map([['nd-1', new Set(['mb:1'])]]);
    const found = lookupByNdId(byKey, keysByNdId, 'nd-1', 'mb:1');
    assert.equal(found, mbidArtist);
});

void test('lookupByNdId: no mbid, or the mbid key is absent — falls back to the ndId index', () => {
    const a = artist({ key: 'nd:5', ndArtistId: '5', seq: 1 });
    const byKey = new Map([['nd:5', a]]);
    const keysByNdId = new Map([['5', new Set(['nd:5'])]]);
    assert.equal(lookupByNdId(byKey, keysByNdId, '5'), a);
    // An mbid that isn't in byKey (never scanned under that id) also falls
    // through to the ndId index rather than returning undefined outright.
    assert.equal(lookupByNdId(byKey, keysByNdId, '5', 'mb:unknown'), a);
});

void test('lookupByNdId: an empty ndId with no mbid answers undefined', () => {
    assert.equal(lookupByNdId(new Map(), new Map(), ''), undefined);
});

void test('lookupByNdId: several candidates for one ndId resolve by server order — newest scannedAt first', () => {
    const older = artist({ key: 'a', ndArtistId: '5', scannedAt: 100, seq: 1 });
    const newer = artist({ key: 'b', ndArtistId: '5', scannedAt: 200, seq: 1 });
    const byKey = new Map([
        ['a', older],
        ['b', newer],
    ]);
    const keysByNdId = new Map([['5', new Set(['a', 'b'])]]);
    assert.equal(lookupByNdId(byKey, keysByNdId, '5'), newer);
});

void test('lookupByNdId: a scannedAt tie breaks on the key, BINARY order (not locale)', () => {
    const zArtist = artist({ key: 'z', ndArtistId: '5', scannedAt: 100, seq: 1 });
    const aArtist = artist({ key: 'a', ndArtistId: '5', scannedAt: 100, seq: 1 });
    const byKey = new Map([
        ['a', aArtist],
        ['z', zArtist],
    ]);
    const keysByNdId = new Map([['5', new Set(['a', 'z'])]]);
    // 'a' < 'z' in byte order, so 'a' wins the tie.
    assert.equal(lookupByNdId(byKey, keysByNdId, '5'), aArtist);
});

// ---------------------------------------------------------------------------
// isArtistStale / toDiscography
// ---------------------------------------------------------------------------

void test('isArtistStale: within the TTL and same scanVersion is fresh', () => {
    const stale = isArtistStale(
        { scannedAt: 1000, scanVersion: 3 },
        { scanVersion: 3, ttlDays: 7 },
        1000 + 86400,
    );
    assert.equal(stale, false);
});

void test('isArtistStale: past the TTL window is stale', () => {
    const stale = isArtistStale(
        { scannedAt: 0, scanVersion: 3 },
        { scanVersion: 3, ttlDays: 1 },
        86400 + 1,
    );
    assert.equal(stale, true);
});

void test('isArtistStale: a scanVersion mismatch is stale even with no time elapsed', () => {
    const stale = isArtistStale(
        { scannedAt: 1000, scanVersion: 2 },
        { scanVersion: 3, ttlDays: 30 },
        1000,
    );
    assert.equal(stale, true);
});

void test('toDiscography: carries the rows through with scan null and stale computed from the envelope', () => {
    const a = artist({
        key: 'a',
        name: 'Artist A',
        rows: [],
        scannedAt: 500,
        scanVersion: 1,
        seq: 1,
    });
    const d = toDiscography(a, { scanVersion: 1, ttlDays: 7 }, 500 + 3600);
    assert.equal(d.artistName, 'Artist A');
    assert.equal(d.indexed, true);
    assert.equal(d.scan, null);
    assert.equal(d.scannedAt, 500);
    assert.equal(d.stale, false);
});

void test('EMPTY_MIRROR_META: the sentinel a fresh mirror starts from', () => {
    assert.deepEqual(EMPTY_MIRROR_META, {
        cursor: 0,
        epoch: '',
        hubUrl: '',
        scanVersion: 0,
        ttlDays: 0,
    });
});
