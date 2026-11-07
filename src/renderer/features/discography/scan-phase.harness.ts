import assert from 'node:assert/strict';
import test from 'node:test';

import { isOlderScanRefusal } from '../../../shared/utils/lbbot-failure.ts';
import {
    justScanned,
    nextScanVisit,
    SCAN_VISIT_START,
    SCAN_WAIT_MS,
    scanCountsText,
    scanLine,
    type ScanPhase,
    scanPhase,
    scanPollMs,
    scanScannable,
    type ScanVisit,
} from './scan-phase.ts';

/**
 * F7 Task 4 / Call 13: the states a scan really has, including the hub's cached pre-scan read.
 *
 *     node --test src/renderer/features/discography/scan-phase.harness.ts
 */

const NOW = 1_800_000_000_000;
const base = {
    available: true,
    indexed: true,
    loading: false,
    nowMs: NOW,
    pending: false,
    readAtMs: null,
    releaseCount: 9,
    scan: null,
    scannable: true,
    started: null,
};
type Scan = { error: string; state: 'done' | 'failed' | 'running'; taskId: string };
const rec = (state: Scan['state'], taskId = 't1', error = ''): Scan => ({ error, state, taskId });

test('pending or a running record is running, over everything', () => {
    assert.equal(scanPhase({ ...base, pending: true }), 'running');
    assert.equal(scanPhase({ ...base, scan: rec('running') }), 'running');
    assert.equal(
        scanPhase({ ...base, available: false, indexed: false, pending: true }),
        'running',
    );
    assert.equal(scanPhase({ ...base, pending: true, scan: rec('failed', 'x') }), 'running');
});

test('the cached-read cases: a scan this session started is running until a record with its task id ends', () => {
    const started = { atMs: NOW - 10_000, taskId: 't1' };
    assert.equal(scanPhase({ ...base, started }), 'running');
    assert.equal(scanPhase({ ...base, scan: rec('done', 'older'), started }), 'running');
    assert.equal(
        scanPhase({ ...base, scan: rec('failed', 'older', 'old error'), started }),
        'running',
    );
    assert.equal(scanPhase({ ...base, scan: rec('done', 't1'), started }), 'idle');
    assert.equal(scanPhase({ ...base, scan: rec('failed', 't1', 'MB down'), started }), 'failed');
});

test('a read made after the hub cache can hold a pre-scan answer, with no record of the task, means lb-bot lost it', () => {
    const started = { atMs: NOW - 90_000, taskId: 't1' };
    // Read 70 s after the press: not the pre-scan cache, and no record of t1 (lb-bot restarted).
    assert.equal(scanPhase({ ...base, readAtMs: started.atMs + 70_000, started }), 'idle');
    assert.equal(
        scanPhase({
            ...base,
            readAtMs: started.atMs + 70_000,
            scan: rec('done', 'older'),
            started,
        }),
        'idle',
    );
    assert.equal(
        scanPhase({
            ...base,
            indexed: false,
            readAtMs: started.atMs + 70_000,
            releaseCount: 0,
            started,
        }),
        'never',
    );
    // Read 30 s after the press: may be the cached pre-scan answer, so still running.
    assert.equal(scanPhase({ ...base, readAtMs: started.atMs + 30_000, started }), 'running');
    // A record of t1 still running keeps it running whenever it was read.
    assert.equal(
        scanPhase({ ...base, readAtMs: started.atMs + 70_000, scan: rec('running'), started }),
        'running',
    );
});

test('a started scan stops waiting after five minutes', () => {
    const started = { atMs: NOW - SCAN_WAIT_MS - 60_000, taskId: 't1' };
    assert.equal(scanPhase({ ...base, started }), 'idle');
    assert.equal(scanPhase({ ...base, indexed: false, releaseCount: 0, started }), 'never');
});

test('a failed record is failed even when the artist is indexed', () => {
    assert.equal(scanPhase({ ...base, scan: rec('failed', 't9', 'boom') }), 'failed');
});

test('the resting phases', () => {
    assert.equal(
        scanPhase({ ...base, available: false, indexed: false, releaseCount: 0 }),
        'unavailable',
    );
    assert.equal(scanPhase({ ...base, indexed: false, releaseCount: 0 }), 'never');
    assert.equal(scanPhase({ ...base, releaseCount: 0 }), 'empty');
    assert.equal(scanPhase(base), 'idle');
    assert.equal(scanPhase({ ...base, scan: rec('done', 'x') }), 'idle');
    // lb-bot down but the mirror holds the artist: the tiles are real, so it reads as idle.
    assert.equal(scanPhase({ ...base, available: false }), 'idle');
    assert.equal(
        scanPhase({ ...base, indexed: false, releaseCount: 0, scannable: false }),
        'never',
    );
});

test('while the discography read is still out, nothing is said and nothing is offered', () => {
    const waiting = { ...base, indexed: false, loading: true, releaseCount: 0 };
    assert.equal(scanPhase(waiting), 'unavailable');
    // A scan this session started still reads as running.
    assert.equal(scanPhase({ ...waiting, started: { atMs: NOW - 1000, taskId: 't1' } }), 'running');
    // Once the artist is known to be indexed, loading does not hide it.
    assert.equal(scanPhase({ ...base, loading: true }), 'idle');
});

test('the poll runs only while running', () => {
    assert.equal(scanPollMs('running'), 5000);
    for (const phase of ['never', 'failed', 'idle', 'empty', 'unavailable'] as const) {
        assert.equal(scanPollMs(phase), null);
    }
});

const at = (days: number) => NOW - days * 86_400_000;
const line = (phase: Parameters<typeof scanLine>[0], over = {}) =>
    scanLine(phase, {
        error: '',
        nowMs: NOW,
        scannable: true,
        scannedAtMs: null,
        stale: false,
        ...over,
    });

test('the idle line reads scannedAt', () => {
    assert.equal(line('idle', { scannedAtMs: at(0.2) }), 'Scanned today');
    assert.equal(line('idle', { scannedAtMs: at(1.5) }), 'Scanned yesterday');
    assert.equal(line('idle', { scannedAtMs: at(3.2) }), 'Scanned 3 days ago');
    assert.equal(line('idle', { scannedAtMs: at(35) }), 'Scanned a month ago');
    assert.equal(line('idle', { scannedAtMs: at(95) }), 'Scanned 3 months ago');
    assert.equal(
        line('idle', { scannedAtMs: at(40), stale: true }),
        'Scanned a month ago · out of date',
    );
    assert.equal(line('idle', { scannedAtMs: null }), '');
});

test("a failed line is lb-bot's sentence verbatim", () => {
    const sentence = 'MusicBrainz is unavailable right now (503). Nothing was changed.';
    assert.equal(line('failed', { error: sentence }), sentence);
    assert.equal(line('failed'), 'The discography scan failed.');
});

test('the running line never says a percentage or a count', () => {
    const text = line('running');
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /\d/);
    assert.doesNotMatch(text, /%/);
});

test('never says why it cannot scan when it cannot', () => {
    assert.match(line('never'), /Find missing albums/);
    assert.match(line('never', { scannable: false }), /MusicBrainz id/);
    assert.match(line('empty'), /found no releases/);
    assert.equal(line('unavailable'), '');
});

// Worbus P1 (F6): Scan now by Navidrome id for a P1 peer, the scan's counts, the worker's own scans,
// and an artist lb-bot could not find on MusicBrainz. An older peer reads exactly as before.

const counted = (done: number, total: number, taskId = 'p1-1') => ({
    done,
    error: '',
    state: 'running' as const,
    taskId,
    total,
});

test('unindexed_offers_scan_now_without_mbid', () => {
    const p1 = { mbid: '', name: 'Aebel', ndId: '6V1La6', olderLbBot: false, p1Peer: true };
    assert.equal(scanScannable(p1), true);
    // Not the virtual `mb:` page: lb-bot scans by Navidrome id only.
    assert.equal(scanScannable({ ...p1, ndId: 'mb:0f0b' }), false);
    const unindexed = { ...base, indexed: false, releaseCount: 0, scannable: true };
    assert.equal(scanPhase(unindexed), 'never');
    assert.match(line('never', { scannable: true }), /Find missing albums/);
});

test('older_lbbot_scan_needs_mbid', () => {
    const older = { mbid: '', name: 'Aebel', ndId: '6V1La6', olderLbBot: false, p1Peer: false };
    assert.equal(scanScannable(older), false);
    // A P1 peer whose lb-bot answered 400 "mbid is required" is older after all.
    assert.equal(scanScannable({ ...older, olderLbBot: true, p1Peer: true }), false);
    // With an MBID and a name every peer can scan, as before.
    assert.equal(scanScannable({ ...older, mbid: 'a7d6' }), true);
    assert.equal(scanScannable({ ...older, mbid: 'a7d6', name: '' }), false);
    assert.equal(isOlderScanRefusal(400, 'mbid is required'), true);
    assert.equal(isOlderScanRefusal(400, 'nd_id is unknown'), false);
    assert.equal(isOlderScanRefusal(404, 'mbid is required'), false);
    assert.equal(isOlderScanRefusal(400, undefined), false);
});

test('scanning_shows_counts', () => {
    assert.equal(scanCountsText(counted(6, 10)), '6 of 10 done');
    assert.equal(scanCountsText(counted(0, 1)), '0 of 1 done');
    assert.equal(scanCountsText(counted(1821, 2479)), '1,821 of 2,479 done');
});

test('scanning_without_counts_is_indeterminate', () => {
    assert.equal(scanCountsText(counted(0, 0)), null);
    assert.equal(scanCountsText(null), null);
    assert.equal(scanCountsText(rec('running')), null);
    // A finished record has no bar to fill.
    assert.equal(scanCountsText({ ...counted(10, 10), state: 'done' }), null);
});

test('worker_scan_followed', () => {
    const worker = counted(12, 40, 'auto-index');
    assert.equal(scanPhase({ ...base, indexed: false, releaseCount: 0, scan: worker }), 'running');
    assert.equal(scanCountsText(worker), '12 of 40 done');
    // A P1 peer polls every 3 s, an older one every 5 s as before.
    assert.equal(scanPollMs('running', true), 3000);
    assert.equal(scanPollMs('running', false), 5000);
    assert.equal(scanPollMs('unresolved', true), null);
});

test('unresolved_offers_retry_and_match', () => {
    const unresolved = { ...base, releaseCount: 0, unresolved: true };
    assert.equal(scanPhase(unresolved), 'unresolved');
    assert.equal(line('unresolved'), "lb-bot couldn't find this artist on MusicBrainz.");
    // A Retry is a scan: while it runs the page reads running.
    assert.equal(scanPhase({ ...unresolved, pending: true }), 'running');
    // MusicBrainz down is not "no match": a failed scan stays the failed line.
    assert.equal(scanPhase({ ...unresolved, scan: rec('failed', 't9', 'MB down') }), 'failed');
});

test('older_peer_no_unresolved_reads_as_today', () => {
    assert.equal(scanPhase({ ...base, releaseCount: 0 }), 'empty');
    assert.equal(scanPhase({ ...base, releaseCount: 0, unresolved: false }), 'empty');
    assert.equal(scanPhase({ ...base, unresolved: undefined }), 'idle');
});

test('expired_scan_reads_idle', () => {
    // lb-bot keeps a scan record ten minutes: the next read without one is no scan at all.
    assert.equal(scanPhase({ ...base, scan: counted(4, 10) }), 'running');
    assert.equal(scanPhase({ ...base, scan: null }), 'idle');
    assert.equal(scanPhase({ ...base, indexed: false, releaseCount: 0, scan: null }), 'never');
    // Nor does a scan this session started spin past its wait.
    const started = { atMs: NOW - SCAN_WAIT_MS - 1, taskId: 'p1-1' };
    assert.equal(scanPhase({ ...base, scan: null, started }), 'idle');
});

test('reload_mid_scan_reads_running', () => {
    // B-200: after a reload this session started nothing, and the record lb-bot answers on open says
    // the scan runs - for any scan, the worker's included.
    assert.equal(
        scanPhase({ ...base, indexed: false, releaseCount: 0, scan: counted(3, 10, 'p1-77') }),
        'running',
    );
    assert.equal(
        scanPhase({ ...base, indexed: false, releaseCount: 0, scan: rec('running', 'auto-index') }),
        'running',
    );
});

// Worbus P1 (review 4): "Updated just now" only after a scan this visit saw run REALLY finished -
// its record read `done`, or the artist's scannedAt moved past the first one this visit read - and
// only for a P1 peer, so an older peer's line is the base's byte for byte.

type Step = {
    answered?: boolean;
    phase: ScanPhase;
    scan?: null | Scan;
    scannedAtMs?: null | number;
};

const walk = (steps: Step[]): ScanVisit =>
    steps.reduce(
        (visit, step) =>
            nextScanVisit(visit, {
                answered: step.answered ?? true,
                phase: step.phase,
                scan: step.scan ?? null,
                scannedAtMs: step.scannedAtMs ?? null,
            }),
        SCAN_VISIT_START,
    );

const just = (steps: Step[], p1Peer = true): boolean => {
    const last = steps[steps.length - 1];
    return justScanned(walk(steps), {
        p1Peer,
        phase: last.phase,
        scannedAtMs: last.scannedAtMs ?? null,
    });
};

test('just_scanned_after_a_done_record', () => {
    const before = at(40);
    assert.equal(
        just([
            { phase: 'idle', scannedAtMs: before },
            { phase: 'running', scan: rec('running', 'p1-9'), scannedAtMs: before },
            { phase: 'idle', scan: rec('done', 'p1-9'), scannedAtMs: before },
        ]),
        true,
    );
});

test('just_scanned_after_scannedAt_advanced', () => {
    // The record expired (or never came): the index moving says the scan landed.
    assert.equal(
        just([
            { phase: 'idle', scannedAtMs: at(40) },
            { phase: 'running', scannedAtMs: at(40) },
            { phase: 'idle', scannedAtMs: at(0) },
        ]),
        true,
    );
    // An artist never scanned before: the first scannedAt is the advance.
    assert.equal(
        just([
            { phase: 'never', scannedAtMs: null },
            { phase: 'running', scannedAtMs: null },
            { phase: 'idle', scannedAtMs: at(0) },
        ]),
        true,
    );
});

test('failed_start_is_not_just_scanned', () => {
    // Rescan pressed with lb-bot unreachable: running for the start, then idle on the old index.
    const before = at(40);
    assert.equal(
        just([
            { phase: 'idle', scannedAtMs: before },
            { phase: 'running', scannedAtMs: before },
            { phase: 'idle', scannedAtMs: before },
        ]),
        false,
    );
    // An old `done` record still on file (lb-bot keeps one ten minutes) is not this scan's end.
    assert.equal(
        just([
            { phase: 'idle', scan: rec('done', 'p1-1'), scannedAtMs: before },
            { phase: 'running', scan: rec('done', 'p1-1'), scannedAtMs: before },
            { phase: 'idle', scan: rec('done', 'p1-1'), scannedAtMs: before },
        ]),
        false,
    );
});

test('lost_or_given_up_scan_is_not_just_scanned', () => {
    const before = at(40);
    // lb-bot lost it (no record), or the five-minute wait ran out with it still running.
    assert.equal(
        just([
            { phase: 'idle', scannedAtMs: before },
            { phase: 'running', scan: rec('running', 'p1-3'), scannedAtMs: before },
            { phase: 'idle', scan: null, scannedAtMs: before },
        ]),
        false,
    );
    assert.equal(
        just([
            { phase: 'running', scan: rec('running', 'p1-3'), scannedAtMs: before },
            { phase: 'idle', scan: rec('running', 'p1-3'), scannedAtMs: before },
        ]),
        false,
    );
    // A failed scan never reads "just now" either.
    assert.equal(
        just([
            { phase: 'running', scan: rec('running', 'p1-3'), scannedAtMs: before },
            { phase: 'failed', scan: rec('failed', 'p1-3'), scannedAtMs: before },
        ]),
        false,
    );
});

test('a_late_discography_answer_is_not_an_advance', () => {
    // The first scannedAt counted is the first one read after the discography answered: one
    // arriving after a failed start is where the visit began, not a scan landing.
    assert.equal(
        just([
            { answered: false, phase: 'running', scannedAtMs: null },
            { phase: 'idle', scannedAtMs: at(40) },
        ]),
        false,
    );
});

test('older_peer_never_just_scanned', () => {
    // An older peer's idle line stays "Scanned today", as before P1.
    const steps: Step[] = [
        { phase: 'idle', scannedAtMs: at(40) },
        { phase: 'running', scan: rec('running', 't1'), scannedAtMs: at(40) },
        { phase: 'idle', scan: rec('done', 't1'), scannedAtMs: at(0) },
    ];
    assert.equal(just(steps, false), false);
    assert.equal(
        line('idle', { justScanned: just(steps, false), scannedAtMs: at(0) }),
        'Scanned today',
    );
    assert.equal(
        line('idle', { justScanned: just(steps, true), scannedAtMs: at(0) }),
        'Updated just now',
    );
});

test('scan_visit_converges', () => {
    // Applied again to the same input it changes nothing (the hook steps it during render).
    const input = {
        answered: true,
        phase: 'idle' as const,
        scan: rec('done', 'p1-9'),
        scannedAtMs: at(0),
    };
    const once = nextScanVisit(walk([{ phase: 'running', scannedAtMs: at(40) }]), input);
    assert.deepEqual(nextScanVisit(once, input), once);
});
