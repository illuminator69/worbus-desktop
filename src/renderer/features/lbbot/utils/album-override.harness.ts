import assert from 'node:assert/strict';
import test from 'node:test';

import {
    albumCommit,
    APPLY_SPEC,
    awaitingIndex,
    canTryAgain,
    commitSentence,
    coverQuery,
    decideLeave,
    decideLeaveAfterJob,
    describeAlbumFailure,
    editionRows,
    extractReleaseMbid,
    forceAllowed,
    GIVE_UP_MS,
    isRunning,
    jobProgress,
    landingNote,
    nextAfterOverride,
    outcomeSentence,
    POLL_INTERVAL_MS,
    pollStart,
    pollStep,
    poorMatchSentence,
    previewCounts,
    problemsHeading,
    releaseUnchanged,
    releaseUrl,
    REMOVE_SPEC,
    rowStatusWords,
    slotLabel,
    STILL_WORKING,
    summarizePreview,
    tagLineFor,
    waitSentence,
} from './album-override.ts';

/**
 * I-022: the "Fix album match" logic that has no React in it - the release id a
 * user pastes, the preview's three counts, the apply/remove poll as one state
 * machine, the words for each failure, and where to go afterwards.
 *
 *     node --test src/renderer/features/lbbot/utils/album-override.harness.ts
 */

const UUID = '8b0a1c1e-3d6f-4a0e-9d52-0c4f2f5b7a11';

test('extractReleaseMbid: a bare uuid, any case, surrounded by spaces', () => {
    assert.equal(extractReleaseMbid(`  ${UUID.toUpperCase()} \n`), UUID);
});

test('extractReleaseMbid: a musicbrainz.org/release url, with and without extras', () => {
    assert.equal(extractReleaseMbid(`https://musicbrainz.org/release/${UUID}`), UUID);
    assert.equal(extractReleaseMbid(`musicbrainz.org/release/${UUID}/cover-art`), UUID);
    assert.equal(extractReleaseMbid(`https://beta.musicbrainz.org/release/${UUID}?x=1#a`), UUID);
});

test('extractReleaseMbid: other entities, other hosts and junk are not a release id', () => {
    assert.equal(extractReleaseMbid(`https://musicbrainz.org/artist/${UUID}`), null);
    assert.equal(extractReleaseMbid(`https://musicbrainz.org/release-group/${UUID}`), null);
    assert.equal(extractReleaseMbid(`https://evilmusicbrainz.org/release/${UUID}`), null);
    assert.equal(extractReleaseMbid(`https://example.com/musicbrainz.org/release/${UUID}`), null);
    assert.equal(extractReleaseMbid('not a uuid'), null);
    assert.equal(extractReleaseMbid(''), null);
});

const slot = (disc: number, track: number, title: string) => ({ disc, title, track });
const file = (
    from: ReturnType<typeof slot>,
    to: null | ReturnType<typeof slot>,
    changed: boolean,
) => ({
    basis: to ? 'exact' : '',
    changed,
    from,
    to,
});

test('summarizePreview: files that change, files with no slot, tracks still missing', () => {
    const summary = summarizePreview({
        albumId: 'a',
        files: [
            file(slot(1, 1, 'A'), slot(1, 2, 'A'), true),
            file(slot(1, 2, 'B'), slot(1, 2, 'B'), false),
            file(slot(1, 3, 'C'), slot(1, 4, 'C'), true),
            file(slot(1, 9, 'Z'), null, false),
        ],
        matched: 3,
        missing: [slot(1, 1, 'X'), slot(1, 3, 'Y')],
        release: {
            country: '',
            disambiguation: '',
            discCount: 1,
            format: '',
            title: 'T',
            trackCount: 5,
            year: '',
        },
        releaseMbid: 'r',
        unmatched: 1,
    });
    assert.deepEqual(summary, {
        changing: 2,
        matched: 3,
        missing: 2,
        noSlot: 1,
        total: 4,
        unchanged: 1,
    });
});

test('summarizePreview: nothing to change is a real answer, not a missing one', () => {
    const summary = summarizePreview({
        albumId: 'a',
        files: [file(slot(1, 1, 'A'), slot(1, 1, 'A'), false)],
        matched: 1,
        missing: [],
        release: {
            country: '',
            disambiguation: '',
            discCount: 1,
            format: '',
            title: '',
            trackCount: 1,
            year: '',
        },
        releaseMbid: 'r',
        unmatched: 0,
    });
    assert.equal(summary.changing, 0);
    assert.equal(summary.unchanged, 1);
});

test('commitSentence is the one fixed sentence before apply, singular and plural', () => {
    assert.equal(
        commitSentence(12),
        'lb-bot rewrites the tags of 12 files and keeps the previous ones, so this can be undone.',
    );
    assert.equal(
        commitSentence(1),
        'lb-bot rewrites the tags of 1 file and keeps the previous ones, so this can be undone.',
    );
});

test('poorMatchSentence names both numbers', () => {
    assert.match(poorMatchSentence(3, 12), /3 of the 12 files/);
    assert.match(poorMatchSentence(3, 12), /Apply anyway/);
});

// --- the poll -------------------------------------------------------------

const row = (state: string, extra: object = {}) => ({
    album: 'A',
    albumId: '',
    artist: 'B',
    coverUrl: '',
    done: 0,
    failures: [],
    id: 'ov',
    prevReleaseMbid: '',
    releaseMbid: 'r',
    rgid: '',
    setAt: 1,
    state,
    total: 10,
    ...extra,
});
const ok = (r: ReturnType<typeof row>) => ({ ok: true as const, row: r });
const bad = (status: number, code = '') => ({ code, ok: false as const, status });

test('constants: 2 s interval, 3 minute give-up, the contract sentence', () => {
    assert.equal(POLL_INTERVAL_MS, 2000);
    assert.equal(GIVE_UP_MS, 180_000);
    assert.equal(
        STILL_WORKING,
        'lb-bot is still working. The result will show on the Library Matches page.',
    );
});

test('apply poll: applying keeps going and carries the progress', () => {
    const s = pollStep(pollStart(APPLY_SPEC, 0), ok(row('applying', { done: 4 })), 2000);
    assert.equal(s.phase, 'polling');
    assert.equal(s.row?.done, 4);
});

test('apply poll: applied and failed are terminal, with the row', () => {
    const start = pollStart(APPLY_SPEC, 0);
    const applied = pollStep(start, ok(row('applied', { done: 10 })), 4000);
    assert.equal(applied.phase, 'settled');
    assert.equal(applied.row?.done, 10);
    const failed = pollStep(start, ok(row('failed')), 4000);
    assert.equal(failed.phase, 'failed');
});

test('apply poll: a failed poll is not an answer - keep polling, keep the last row', () => {
    let s = pollStep(pollStart(APPLY_SPEC, 0), ok(row('applying', { done: 2 })), 2000);
    s = pollStep(s, bad(0), 4000);
    assert.equal(s.phase, 'polling');
    assert.equal(s.row?.done, 2);
    s = pollStep(s, bad(502), 6000);
    s = pollStep(s, bad(504), 8000);
    assert.equal(s.phase, 'polling');
});

test('apply poll: a coded 404 no_override is an answer - the row is gone', () => {
    const s = pollStep(pollStart(APPLY_SPEC, 0), bad(404, 'no_override'), 2000);
    assert.equal(s.phase, 'gone');
});

test('apply poll: a code-less 404 is the hub or an older lb-bot, not an answer about the row', () => {
    const s = pollStep(pollStart(APPLY_SPEC, 0), bad(404), 2000);
    assert.equal(s.phase, 'polling');
});

test('apply poll: gives up after three minutes, whatever the last answer was', () => {
    const start = pollStart(APPLY_SPEC, 1000);
    assert.equal(pollStep(start, ok(row('applying')), 1000 + GIVE_UP_MS - 1).phase, 'polling');
    assert.equal(pollStep(start, ok(row('applying')), 1000 + GIVE_UP_MS).phase, 'timeout');
    assert.equal(pollStep(start, bad(0), 1000 + GIVE_UP_MS).phase, 'timeout');
});

test('apply poll: an answer that lands exactly at the deadline still wins over the clock', () => {
    const start = pollStart(APPLY_SPEC, 0);
    assert.equal(pollStep(start, ok(row('applied')), GIVE_UP_MS).phase, 'settled');
});

test('terminal phases do not move again', () => {
    const done = pollStep(pollStart(APPLY_SPEC, 0), ok(row('applied')), 2000);
    assert.equal(pollStep(done, ok(row('applying')), 4000).phase, 'settled');
    assert.equal(pollStep(done, bad(0), 999_999).phase, 'settled');
});

test('remove poll: 404 no_override is the finish', () => {
    let s = pollStep(pollStart(REMOVE_SPEC, 0), ok(row('removing', { done: 3 })), 2000);
    assert.equal(s.phase, 'polling');
    s = pollStep(s, bad(404, 'no_override'), 4000);
    assert.equal(s.phase, 'settled');
});

test('remove poll: a code-less 404 or a transport failure is not the finish', () => {
    assert.equal(pollStep(pollStart(REMOVE_SPEC, 0), bad(404), 2000).phase, 'polling');
    assert.equal(pollStep(pollStart(REMOVE_SPEC, 0), bad(0), 2000).phase, 'polling');
    assert.equal(pollStep(pollStart(REMOVE_SPEC, 0), bad(502), 2000).phase, 'polling');
});

test('remove poll: a row that goes back to applied/failed after removing ended without removing', () => {
    let s = pollStep(pollStart(REMOVE_SPEC, 0), ok(row('removing')), 2000);
    s = pollStep(s, ok(row('failed', { failures: [{ reason: 'busy', title: 'T' }] })), 4000);
    assert.equal(s.phase, 'failed');
    assert.equal(s.row?.failures.length, 1);
});

test('remove poll: applied/failed BEFORE removing was ever seen keeps polling', () => {
    const s = pollStep(pollStart(REMOVE_SPEC, 0), ok(row('applied')), 2000);
    assert.equal(s.phase, 'polling');
});

test('remove poll: also gives up after three minutes', () => {
    assert.equal(
        pollStep(pollStart(REMOVE_SPEC, 0), ok(row('removing')), GIVE_UP_MS).phase,
        'timeout',
    );
});

// --- failures -------------------------------------------------------------

test('describeAlbumFailure: older lb-bot is a 405 or a code-less 404, never an error text', () => {
    assert.equal(describeAlbumFailure({ error: 'x', status: 405 }).kind, 'older');
    assert.equal(describeAlbumFailure({ error: 'x', status: 404 }).kind, 'older');
    assert.equal(
        describeAlbumFailure({ code: 'unknown_album', error: 'No such album.', status: 404 }).kind,
        'answer',
    );
});

test('describeAlbumFailure: lb-bot own text is shown as is for coded answers', () => {
    const f = describeAlbumFailure({
        code: 'unknown_release',
        error: 'MusicBrainz has no such release.',
        status: 404,
    });
    assert.equal(f.message, 'MusicBrainz has no such release.');
    assert.equal(f.kind, 'answer');
    const busy = describeAlbumFailure({ code: 'busy', error: 'A fill is running.', status: 409 });
    assert.equal(busy.message, 'A fill is running.');
    const inProgress = describeAlbumFailure({
        code: 'in_progress',
        error: 'Already applying.',
        status: 409,
    });
    assert.equal(inProgress.message, 'Already applying.');
    assert.equal(describeAlbumFailure({ error: 'Bad id.', status: 400 }).message, 'Bad id.');
});

test('describeAlbumFailure: poor_match carries the counts and is its own kind', () => {
    const f = describeAlbumFailure({
        code: 'poor_match',
        error: 'Few files match.',
        matched: 3,
        status: 409,
        total: 12,
    });
    assert.equal(f.kind, 'poor_match');
    assert.equal(f.matched, 3);
    assert.equal(f.total, 12);
});

test('describeAlbumFailure: poor_match without numbers is not offered a forced retry', () => {
    const f = describeAlbumFailure({ code: 'poor_match', error: 'Few files match.', status: 409 });
    assert.equal(f.kind, 'answer');
});

test('describeAlbumFailure: a retryable 502 is retryable with lb-bot own text', () => {
    const f = describeAlbumFailure({
        error: 'MusicBrainz did not answer; nothing was written.',
        retryable: true,
        status: 502,
    });
    assert.equal(f.kind, 'retry');
    assert.match(f.message, /^MusicBrainz did not answer; nothing was written\./);
});

test('describeAlbumFailure: a 502 without retryable is the hub saying busy - also retryable, hub text', () => {
    const f = describeAlbumFailure({ error: 'lb-bot is busy or unreachable.', status: 502 });
    assert.equal(f.kind, 'retry');
});

test('describeAlbumFailure: status 0 (no hub) says so', () => {
    const f = describeAlbumFailure({ error: 'Could not reach the hub.', status: 0 });
    assert.equal(f.kind, 'retry');
    assert.equal(f.message, 'Could not reach the hub.');
});

// --- outcome ---------------------------------------------------------------

test('outcomeSentence: applied states what was written, nothing about favourites', () => {
    const text = outcomeSentence('apply', row('applied', { done: 10, total: 10 }));
    assert.equal(text, 'lb-bot wrote the tags of 10 files.');
    assert.doesNotMatch(text, /favou?rite|rating|play count/i);
});

test('outcomeSentence: problems are counted by problems, not by files (X9) - the list heading says how many', () => {
    const text = outcomeSentence(
        'apply',
        row('applied', {
            done: 12,
            failures: [{ reason: 'r', title: 'Cover image' }],
            total: 12,
        }),
    );
    // 12 of 12 files were written; the cover problem is not "a file that could not be written".
    assert.equal(text, 'lb-bot wrote the tags of 12 files.');
    assert.equal(problemsHeading(1), '1 problem');
    assert.equal(problemsHeading(3), '3 problems');
});

test('outcomeSentence: failed and removed', () => {
    assert.match(outcomeSentence('apply', row('failed', { done: 2, total: 10 })), /did not finish/);
    assert.equal(outcomeSentence('remove', null), 'lb-bot put the previous tags back.');
});

test('nextAfterOverride: the new album when lb-bot knows its id, else the artist', () => {
    assert.deepEqual(nextAfterOverride('al-9', 'ar-1'), { id: 'al-9', kind: 'album' });
    assert.deepEqual(nextAfterOverride('', 'ar-1'), { id: 'ar-1', kind: 'artist' });
    assert.deepEqual(nextAfterOverride('', ''), { kind: 'none' });
});

// --- editions --------------------------------------------------------------

const edition = (releaseMbid: string, extra: object = {}) => ({
    country: 'GB',
    coverUrl: '',
    format: 'CD',
    label: 'CD',
    releaseMbid,
    year: '1996',
    ...extra,
});

test('editionRows: flattens variants and marks the one the album is tagged as', () => {
    const rows = editionRows(
        [
            {
                coverUrl: '',
                disambiguation: '',
                editions: [edition('r1'), edition('r2', { country: 'US' })],
                releaseMbid: 'r1',
                title: 'Tigermilk',
                trackCount: 11,
                year: '1996',
            },
            {
                coverUrl: '',
                disambiguation: 'deluxe',
                editions: [],
                releaseMbid: 'r3',
                title: 'Tigermilk (deluxe)',
                trackCount: 15,
                year: '2010',
            },
        ],
        'r2',
    );
    assert.deepEqual(
        rows.map((r) => [r.releaseMbid, r.current, r.trackCount]),
        [
            ['r1', false, 11],
            ['r2', true, 11],
            ['r3', false, 15],
        ],
    );
    assert.equal(rows[1].country, 'US');
    assert.equal(rows[2].disambiguation, 'deluxe');
});

test('editionRows: an edition listed twice appears once', () => {
    const variant = (id: string) => ({
        coverUrl: '',
        disambiguation: '',
        editions: [edition(id)],
        releaseMbid: id,
        title: 'T',
        trackCount: 1,
        year: '',
    });
    assert.equal(editionRows([variant('r1'), variant('r1')], '').length, 1);
});

// --- fix round 1 -----------------------------------------------------------

test('forceAllowed: only for the release whose poor_match the user confirmed', () => {
    const pending = { matched: 3, releaseMbid: 'rA', total: 12 };
    assert.equal(forceAllowed(pending, 'rA'), true);
    assert.equal(forceAllowed(pending, 'rB'), false);
    assert.equal(forceAllowed(pending, ''), false);
    assert.equal(forceAllowed(null, 'rA'), false);
});

test('decideLeave: not on the dead album page means stay', () => {
    const base = {
        artistId: 'ar',
        deadAlbumId: 'al-1',
        kind: 'apply' as const,
        newAlbumId: 'al-2',
    };
    assert.deepEqual(decideLeave({ ...base, pathname: '/library/albums/other' }), { kind: 'stay' });
    assert.deepEqual(decideLeave({ ...base, pathname: '/library/albums' }), { kind: 'stay' });
    // a longer id that merely contains the dead one is not the dead page
    assert.deepEqual(decideLeave({ ...base, pathname: '/library/albums/al-10' }), { kind: 'stay' });
});

test('decideLeave: on the dead page goes to the new album, else the artist, else the list', () => {
    const on = { deadAlbumId: 'al-1', kind: 'apply' as const, pathname: '/library/albums/al-1' };
    assert.deepEqual(decideLeave({ ...on, artistId: 'ar', newAlbumId: 'al-2' }), {
        id: 'al-2',
        kind: 'album',
    });
    assert.deepEqual(decideLeave({ ...on, artistId: 'ar', newAlbumId: '' }), {
        id: 'ar',
        kind: 'artist',
    });
    assert.deepEqual(decideLeave({ ...on, artistId: '', newAlbumId: '' }), { kind: 'albums' });
});

test('decideLeave: the same id (a cover-only change) stays; a remove never lands on an album', () => {
    assert.deepEqual(
        decideLeave({
            artistId: 'ar',
            deadAlbumId: 'al-1',
            kind: 'apply',
            newAlbumId: 'al-1',
            pathname: '/library/albums/al-1',
        }),
        { kind: 'stay' },
    );
    assert.deepEqual(
        decideLeave({
            artistId: 'ar',
            deadAlbumId: 'al-1',
            kind: 'remove',
            newAlbumId: 'al-9',
            pathname: '/library/albums/al-1',
        }),
        { id: 'ar', kind: 'artist' },
    );
    assert.deepEqual(
        decideLeave({
            artistId: '',
            deadAlbumId: 'al-1',
            kind: 'remove',
            newAlbumId: '',
            pathname: '/library/albums/al-1',
        }),
        { kind: 'albums' },
    );
});

// =============================================================================
// Final fix wave
// =============================================================================

// --- X1: the active state is taken from the POST's own state ------------------

test('X1: a remove whose row is already failed at the first tick ends failed when seeded from the POST state', () => {
    const seeded = pollStart(REMOVE_SPEC, 0, 'removing');
    const ended = pollStep(
        seeded,
        ok(row('failed', { failures: [{ reason: 'file moved', title: 'T' }] })),
        2000,
    );
    assert.equal(ended.phase, 'failed');
    assert.equal(ended.row?.failures.length, 1);
});

test('X1: the same row without a seed keeps polling (the old behaviour, now only for an unseeded start)', () => {
    const s = pollStep(pollStart(REMOVE_SPEC, 0), ok(row('failed')), 2000);
    assert.equal(s.phase, 'polling');
});

test('a POST that itself answers failed is seeded too: a remove/undo already failed is seen', () => {
    assert.equal(pollStart(REMOVE_SPEC, 0, 'failed').sawActive, true);
    const ended = pollStep(pollStart(REMOVE_SPEC, 0, 'failed'), ok(row('failed')), 2000);
    assert.equal(ended.phase, 'failed');
    // an unrelated state still seeds nothing
    assert.equal(pollStart(REMOVE_SPEC, 0, 'applied').sawActive, false);
});

test('X1: a seed that is not an active state seeds nothing', () => {
    assert.equal(pollStart(REMOVE_SPEC, 0, 'applied').sawActive, false);
    assert.equal(pollStart(REMOVE_SPEC, 0, undefined).sawActive, false);
    assert.equal(pollStart(REMOVE_SPEC, 0, 'removing').sawActive, true);
});

// --- X2: the give-up clock measures silence ------------------------------------

test('X2: a job whose done keeps moving never times out', () => {
    let s = pollStart(APPLY_SPEC, 0);
    let t = 0;
    for (let done = 1; done <= 200; done += 1) {
        t += 2000;
        s = pollStep(s, ok(row('applying', { done, total: 1000 })), t);
        assert.equal(s.phase, 'polling', `tick ${done} at ${t} ms`);
    }
    assert.ok(t > GIVE_UP_MS);
});

test('X2: a job that stops advancing gives up three minutes after the last movement', () => {
    let s = pollStart(APPLY_SPEC, 0);
    s = pollStep(s, ok(row('applying', { done: 1 })), 2000);
    s = pollStep(s, ok(row('applying', { done: 2 })), 100_000);
    // silent since 100 s
    s = pollStep(s, ok(row('applying', { done: 2 })), 100_000 + GIVE_UP_MS - 1);
    assert.equal(s.phase, 'polling');
    s = pollStep(s, ok(row('applying', { done: 2 })), 100_000 + GIVE_UP_MS);
    assert.equal(s.phase, 'timeout');
});

test('X2: a changed state also counts as movement', () => {
    let s = pollStart(REMOVE_SPEC, 0, 'removing');
    s = pollStep(s, ok(row('removing', { done: 5 })), 2000);
    s = pollStep(s, ok(row('removing', { done: 5 })), 170_000);
    assert.equal(s.phase, 'polling');
    // the state label changes (nothing else does): still movement
    s = pollStep(s, ok(row('unknown-new-state', { done: 5 })), 175_000);
    s = pollStep(s, ok(row('removing', { done: 5 })), 175_000 + GIVE_UP_MS - 1);
    assert.equal(s.phase, 'polling');
});

// --- X3: where to look, and what is remembered ---------------------------------

test('X3: a timed-out job is not settled later - the phase is terminal', () => {
    let s = pollStart(APPLY_SPEC, 0);
    s = pollStep(s, ok(row('applying')), GIVE_UP_MS);
    assert.equal(s.phase, 'timeout');
    assert.equal(pollStep(s, ok(row('applied')), GIVE_UP_MS + 2000).phase, 'timeout');
});

// --- X4: the wait for Navidrome -------------------------------------------------

test('X4: the writes are over when done + failures reach total and the state is still active', () => {
    assert.equal(awaitingIndex(row('applying', { done: 11, total: 11 })), true);
    assert.equal(
        awaitingIndex(
            row('applying', { done: 10, failures: [{ reason: 'r', title: 'T' }], total: 11 }),
        ),
        true,
    );
    // done alone is NOT the test: one failure leaves done < total although the writes are over
    assert.equal(awaitingIndex(row('applying', { done: 10, total: 11 })), false);
    assert.equal(awaitingIndex(row('applying', { done: 0, total: 0 })), false);
    // an ended job is not waiting
    assert.equal(awaitingIndex(row('applied', { done: 11, total: 11 })), false);
    assert.equal(awaitingIndex(row('failed', { done: 11, total: 11 })), false);
    assert.equal(awaitingIndex(null), false);
    for (const state of ['applying', 'removing', 'merging', 'undoing']) {
        assert.equal(awaitingIndex(row(state, { done: 3, total: 3 })), true, state);
        assert.equal(isRunning(state), true, state);
    }
    assert.equal(isRunning('applied'), false);
});

test('X4: while waiting the surface says so and draws no determinate bar', () => {
    const waiting = jobProgress('apply', row('applying', { done: 11, total: 11 }));
    assert.equal(waiting.bar, false);
    assert.match(waiting.text, /waiting for Navidrome/);
    assert.match(waiting.text, /up to a minute/);
    assert.doesNotMatch(waiting.text, /11\/11|11 of 11/);
    const writing = jobProgress('apply', row('applying', { done: 4, total: 11 }));
    assert.equal(writing.bar, true);
    assert.equal(writing.percent, Math.round((4 / 11) * 100));
    assert.match(writing.text, /4\/11 files/);
    for (const kind of ['apply', 'remove', 'merge', 'undo'] as const) {
        assert.match(waitSentence(kind), /Navidrome/);
    }
});

// --- item 4/5: row words, tag line --------------------------------------------

test('Minor 10: panel rows word their state; running rows are running', () => {
    assert.equal(rowStatusWords('album', row('applied')), '');
    assert.equal(rowStatusWords('album', row('failed')), 'did not finish');
    assert.match(rowStatusWords('album', row('applying', { done: 2, total: 9 })), /2 of 9 files/);
    assert.match(
        rowStatusWords('album', row('applying', { done: 9, total: 9 })),
        /waiting for Navidrome/,
    );
    assert.match(rowStatusWords('album', row('removing', { done: 1, total: 4 })), /previous tags/);
    assert.match(rowStatusWords('merge', row('merging', { done: 1, total: 4 })), /1 of 4 files/);
    assert.match(rowStatusWords('merge', row('undoing', { done: 1, total: 4 })), /previous names/);
    assert.equal(rowStatusWords('merge', row('merged')), '');
    assert.doesNotMatch(rowStatusWords('album', row('mystery')), /mystery/);
});

test('item 5: a row whose release never changed is a cover change, not "set to"', () => {
    assert.equal(releaseUnchanged({ prevReleaseMbid: 'r1', releaseMbid: 'r1' }), true);
    assert.equal(releaseUnchanged({ prevReleaseMbid: 'r1', releaseMbid: 'r2' }), false);
    assert.equal(releaseUnchanged({ prevReleaseMbid: '', releaseMbid: 'r2' }), false);
    // blank is unknown, not "unchanged" (X7: non-blank)
    assert.equal(releaseUnchanged({ prevReleaseMbid: '', releaseMbid: '' }), false);
});

test('Minor 9: the tagged-release line carries the id and a link when the edition is not listed', () => {
    assert.equal(releaseUrl('abc'), 'https://musicbrainz.org/release/abc');
    assert.deepEqual(tagLineFor({ files: 3, job: false, listed: null, releaseMbid: 'r1' }), {
        files: 3,
        kind: 'id',
        releaseMbid: 'r1',
    });
    assert.deepEqual(tagLineFor({ files: 0, job: false, listed: null, releaseMbid: '' }), {
        files: 0,
        kind: 'untagged',
    });
    assert.deepEqual(
        tagLineFor({
            files: 11,
            job: false,
            listed: { country: 'GB', format: 'CD', title: 'T', trackCount: 11, year: '1996' },
            releaseMbid: 'r1',
        }),
        { files: 11, kind: 'edition', text: 'T · 1996 · GB · CD · 11 tracks' },
    );
});

test('Minor 6: after a job ended there is no "tagged as" line (it would name the old edition)', () => {
    assert.deepEqual(tagLineFor({ files: 3, job: true, listed: null, releaseMbid: 'r1' }), {
        kind: 'none',
    });
});

test('Minor 7: an apply that ended with no album id says the album is not indexed yet', () => {
    assert.match(landingNote('apply', '') ?? '', /not indexed/);
    assert.equal(landingNote('apply', 'al-2'), null);
    assert.equal(landingNote('remove', ''), null);
});

// --- item 6: the cover-only path stays reachable --------------------------------

test('item 6: picked equals current, zero changes, a cover chosen -> cover only', () => {
    assert.equal(
        albumCommit({ changing: 0, coverChosen: true, current: 'r1', picked: 'r1' }),
        'cover-only',
    );
    assert.equal(
        albumCommit({ changing: 0, coverChosen: false, current: 'r1', picked: 'r1' }),
        'nothing',
    );
    assert.equal(
        albumCommit({ changing: 3, coverChosen: true, current: 'r1', picked: 'r1' }),
        'apply',
    );
    // another release with nothing to change stays disabled (documented divergence from Worbus for Android)
    assert.equal(
        albumCommit({ changing: 0, coverChosen: true, current: 'r1', picked: 'r2' }),
        'nothing',
    );
    assert.equal(
        albumCommit({ changing: 4, coverChosen: false, current: 'r1', picked: 'r2' }),
        'apply',
    );
    // no edition picked at all: the cover alone
    assert.equal(
        albumCommit({ changing: null, coverChosen: true, current: 'r1', picked: null }),
        'cover-only',
    );
    assert.equal(
        albumCommit({ changing: null, coverChosen: false, current: 'r1', picked: null }),
        'nothing',
    );
    // preview not in yet
    assert.equal(
        albumCommit({ changing: null, coverChosen: true, current: 'r1', picked: 'r1' }),
        'nothing',
    );
});

// --- X8: covers for a release that is not a listed edition ---------------------------

test('X8: a pasted release that is not among the editions asks for covers by release_mbid alone', () => {
    const listed = new Set(['r1', 'r2']);
    assert.deepEqual(coverQuery({ current: 'r1', listed, picked: 'r9', rgid: 'rg' }), {
        releaseMbid: 'r9',
        rgid: '',
    });
    assert.deepEqual(coverQuery({ current: 'r1', listed, picked: 'r2', rgid: 'rg' }), {
        releaseMbid: 'r2',
        rgid: 'rg',
    });
    assert.deepEqual(coverQuery({ current: 'r1', listed, picked: null, rgid: 'rg' }), {
        releaseMbid: 'r1',
        rgid: 'rg',
    });
});

// --- X7: undoing a cover-only change stays ------------------------------------------

test('X7: a remove whose row kept the release stays on the album page', () => {
    assert.deepEqual(
        decideLeave({
            artistId: 'ar',
            deadAlbumId: 'al-1',
            kind: 'remove',
            newAlbumId: '',
            pathname: '/library/albums/al-1',
            releaseUnchanged: true,
        }),
        { kind: 'stay' },
    );
    // a remove that did change the release still leaves the dead page
    assert.deepEqual(
        decideLeave({
            artistId: 'ar',
            deadAlbumId: 'al-1',
            kind: 'remove',
            newAlbumId: '',
            pathname: '/library/albums/al-1',
            releaseUnchanged: false,
        }),
        { id: 'ar', kind: 'artist' },
    );
});

// --- X6 / Minor 2 / item 14: failure kinds -------------------------------------------

test('X6: Try again for every refusal except older', () => {
    assert.equal(
        canTryAgain(describeAlbumFailure({ code: 'unknown_release', error: 'x', status: 404 })),
        true,
    );
    assert.equal(
        canTryAgain(
            describeAlbumFailure({ code: 'files_unreachable', error: 'x', status: 409, total: 12 }),
        ),
        true,
    );
    assert.equal(canTryAgain(describeAlbumFailure({ error: 'x', status: 400 })), true);
    assert.equal(canTryAgain(describeAlbumFailure({ error: 'x', status: 405 })), false);
    assert.equal(canTryAgain(describeAlbumFailure({ error: 'x', status: 404 })), false);
});

test('Minor 2: a hub 503 (proxy busy) is retryable', () => {
    assert.equal(describeAlbumFailure({ error: 'busy', status: 503 }).kind, 'retry');
});

test('item 14: 409 files_unreachable carries total but is not a poor_match; lb-bot text shown as is', () => {
    const f = describeAlbumFailure({
        code: 'files_unreachable',
        error: 'lb-bot cannot read 3 of the 12 files.',
        status: 409,
        total: 12,
    });
    assert.equal(f.kind, 'answer');
    assert.equal(f.message, 'lb-bot cannot read 3 of the 12 files.');
});

test('item 14: 409 collaboration is lb-bot text', () => {
    const f = describeAlbumFailure({
        code: 'collaboration',
        error: 'These are a collaboration credit.',
        status: 409,
    });
    assert.equal(f.kind, 'answer');
    assert.equal(f.message, 'These are a collaboration credit.');
});

// --- Minor 8: preview wording -----------------------------------------------------------

test('Minor 8: no disc prefix on a single-disc album, no 00 for a missing track number', () => {
    assert.equal(slotLabel({ disc: 1, title: 'A', track: 2 }, false), '02  A');
    assert.equal(slotLabel({ disc: 2, title: 'A', track: 2 }, true), '2-02  A');
    assert.equal(slotLabel({ disc: 1, title: 'A', track: 0 }, false), 'A');
    assert.equal(slotLabel({ disc: 0, title: 'A', track: 3 }, true), '03  A');
});

test('Minor 8: counts agree in number', () => {
    assert.deepEqual(
        previewCounts({ changing: 1, matched: 1, missing: 1, noSlot: 1, total: 2, unchanged: 0 }),
        [
            '1 file changes',
            '1 file has no place on this release',
            '1 track of the release has no file',
        ],
    );
    assert.deepEqual(
        previewCounts({ changing: 2, matched: 2, missing: 0, noSlot: 0, total: 2, unchanged: 0 }),
        [
            '2 files change',
            '0 files have no place on this release',
            '0 tracks of the release have no file',
        ],
    );
});

// --- X7 when the undo ends before the first row was ever read -----------------------

const dead = { artistId: 'ar', deadAlbumId: 'al-1', pathname: '/library/albums/al-1' };

test('X7: a remove that ends with no row stays for a cover-only override (decided from the row held at the start)', () => {
    assert.deepEqual(
        decideLeaveAfterJob({
            ...dead,
            ended: { phase: 'settled', row: null },
            kind: 'remove',
            startRow: { prevReleaseMbid: 'r1', releaseMbid: 'r1' },
        }),
        { kind: 'stay' },
    );
});

test('X7: the same with no row leaves for an override that changed the release', () => {
    assert.deepEqual(
        decideLeaveAfterJob({
            ...dead,
            ended: { phase: 'settled', row: null },
            kind: 'remove',
            startRow: { prevReleaseMbid: 'r0', releaseMbid: 'r1' },
        }),
        { id: 'ar', kind: 'artist' },
    );
});

test('X7: with no start row the last polled row decides; with neither, the page is left', () => {
    assert.deepEqual(
        decideLeaveAfterJob({
            ...dead,
            ended: {
                phase: 'settled',
                row: { albumId: '', prevReleaseMbid: 'r1', releaseMbid: 'r1' },
            },
            kind: 'remove',
            startRow: null,
        }),
        { kind: 'stay' },
    );
    assert.deepEqual(
        decideLeaveAfterJob({
            ...dead,
            ended: { phase: 'settled', row: null },
            kind: 'remove',
            startRow: null,
        }),
        { id: 'ar', kind: 'artist' },
    );
});

test('decideLeaveAfterJob: only a settled end moves anyone; an apply goes to the new album', () => {
    assert.deepEqual(
        decideLeaveAfterJob({
            ...dead,
            ended: { phase: 'failed', row: null },
            kind: 'remove',
            startRow: { prevReleaseMbid: 'r0', releaseMbid: 'r1' },
        }),
        { kind: 'stay' },
    );
    assert.deepEqual(
        decideLeaveAfterJob({
            ...dead,
            ended: {
                phase: 'settled',
                row: { albumId: 'al-2', prevReleaseMbid: 'r0', releaseMbid: 'r1' },
            },
            kind: 'apply',
            startRow: null,
        }),
        { id: 'al-2', kind: 'album' },
    );
});
