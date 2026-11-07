import assert from 'node:assert/strict';
import test from 'node:test';

import {
    downloadsShown,
    isP1Peer,
    isProgressOnlyFrame,
    modeAfterRefusal,
    modeFromFrame,
    modeFromWelcome,
    parseProgress,
    rememberMode,
    stateAfterRefusal,
    stateAfterWelcome,
} from './lbbot-mode.ts';

/**
 * Worbus P1, lane F (F1):  node --test src/shared/utils/lbbot-mode.harness.ts
 *
 * What lb-bot's downloads mode and index progress mean to this client, read once from the
 * hub's `welcome.lb` / `t:"lb"` / `/lb/status` and `welcome.lbIndex` / `t:"index"`. The mode
 * rules are Worbus for Android's (lane N ruling 3): every welcome restates it, a frame without the key keeps
 * what a 409 taught, and an older peer (no key at all) behaves as today.
 */

test('older_peer_welcome_without_downloads_is_unknown', () => {
    assert.equal(modeFromWelcome({ available: true, routes: [], webUrl: '' }), 'unknown');
    assert.equal(modeFromWelcome(undefined), 'unknown');
    assert.equal(modeFromWelcome(null), 'unknown');
});

test('older_peer_unknown_shows_downloads', () => {
    assert.equal(downloadsShown('unknown'), true);
    assert.equal(downloadsShown('on'), true);
    assert.equal(downloadsShown('off'), false);
    assert.equal(isP1Peer('unknown'), false);
    assert.equal(isP1Peer('on'), true);
    assert.equal(isP1Peer('off'), true);
});

test('welcome_reads_on_and_off', () => {
    assert.equal(modeFromWelcome({ available: true, downloads: 'on' }), 'on');
    assert.equal(modeFromWelcome({ available: false, downloads: 'off' }), 'off');
});

test('welcome_with_garbage_downloads_is_unknown', () => {
    for (const downloads of ['yes', true, 1, 'ON', '', null, {}]) {
        assert.equal(modeFromWelcome({ available: true, downloads }), 'unknown', String(downloads));
    }
});

test('frame_without_downloads_keeps_current', () => {
    assert.equal(modeFromFrame('off', { available: true }), 'off');
    assert.equal(modeFromFrame('on', { available: false }), 'on');
    assert.equal(modeFromFrame('unknown', {}), 'unknown');
    assert.equal(modeFromFrame('off', null), 'off');
    assert.equal(modeFromFrame('off', { available: true, downloads: 'garbage' }), 'off');
});

test('frame_with_downloads_sets_it', () => {
    assert.equal(modeFromFrame('on', { available: true, downloads: 'off' }), 'off');
    assert.equal(modeFromFrame('off', { available: true, downloads: 'on' }), 'on');
    assert.equal(modeFromFrame('unknown', { downloads: 'on' }), 'on');
});

test('downloads_off_409_flips_mode', () => {
    assert.equal(modeAfterRefusal('on', 'downloads_off'), 'off');
    assert.equal(modeAfterRefusal('unknown', 'downloads_off'), 'off');
    assert.equal(modeAfterRefusal('unknown', 'bad_source'), 'unknown');
    assert.equal(modeAfterRefusal('on', undefined), 'on');
    assert.equal(modeAfterRefusal('on', 'signin_required'), 'on');
});

test('signin_required_marks_refused', () => {
    // B-263: lb-bot refused the hub (no bearer, or the wrong one). The mode is untouched.
    assert.deepEqual(stateAfterRefusal({ mode: 'on', refused: false }, 'signin_required'), {
        mode: 'on',
        refused: true,
    });
    assert.deepEqual(stateAfterRefusal({ mode: 'unknown', refused: true }, 'signin_required'), {
        mode: 'unknown',
        refused: true,
    });
    // downloads_off turns the mode off and leaves the refusal as it was.
    assert.deepEqual(stateAfterRefusal({ mode: 'on', refused: false }, 'downloads_off'), {
        mode: 'off',
        refused: false,
    });
    assert.deepEqual(stateAfterRefusal({ mode: 'on', refused: true }, 'downloads_off'), {
        mode: 'off',
        refused: true,
    });
    // Any other code (or none) changes nothing.
    for (const code of ['bad_source', undefined, '']) {
        assert.deepEqual(stateAfterRefusal({ mode: 'on', refused: false }, code), {
            mode: 'on',
            refused: false,
        });
    }
});

test('welcome_clears_refused', () => {
    // Every welcome ends a refusal (the hub may have been upgraded to send lb-bot its token) and
    // restates the mode - absent is an older peer.
    assert.deepEqual(stateAfterWelcome({ available: true, downloads: 'off' }), {
        mode: 'off',
        refused: false,
    });
    assert.deepEqual(stateAfterWelcome({ available: true, downloads: 'on' }), {
        mode: 'on',
        refused: false,
    });
    assert.deepEqual(stateAfterWelcome({ available: true }), { mode: 'unknown', refused: false });
    assert.deepEqual(stateAfterWelcome(undefined), { mode: 'unknown', refused: false });
});

test('remember_keeps_four_hubs_drops_oldest', () => {
    let state = { map: {} as Record<string, 'off' | 'on'>, order: [] as string[] };
    for (const [url, mode] of [
        ['ws://a', 'on'],
        ['ws://b', 'off'],
        ['ws://c', 'on'],
        ['ws://d', 'off'],
    ] as const) {
        state = rememberMode(state.map, state.order, url, mode);
    }
    assert.deepEqual(state.order, ['ws://a', 'ws://b', 'ws://c', 'ws://d']);
    // Restating a known hub moves it to the newest end without growing the list.
    state = rememberMode(state.map, state.order, 'ws://a', 'off');
    assert.deepEqual(state.order, ['ws://b', 'ws://c', 'ws://d', 'ws://a']);
    assert.equal(state.map['ws://a'], 'off');
    state = rememberMode(state.map, state.order, 'ws://e', 'on');
    assert.deepEqual(state.order, ['ws://c', 'ws://d', 'ws://a', 'ws://e']);
    assert.equal('ws://b' in state.map, false);
    assert.equal(Object.keys(state.map).length, 4);
});

test('remember_never_stores_unknown', () => {
    const start = { map: { 'ws://a': 'on' as const }, order: ['ws://a'] };
    const after = rememberMode(start.map, start.order, 'ws://a', 'unknown');
    assert.deepEqual(after, start);
    const fresh = rememberMode({}, [], 'ws://b', 'unknown');
    assert.deepEqual(fresh, { map: {}, order: [] });
    // An empty hub URL (no hub configured) is never a key either.
    assert.deepEqual(rememberMode({}, [], '', 'on'), { map: {}, order: [] });
});

test('older_peer_no_progress_is_null', () => {
    assert.equal(parseProgress(undefined), null);
    assert.equal(parseProgress(null), null);
    assert.equal(parseProgress('progress'), null);
    assert.equal(parseProgress({}), null);
});

test('progress_rejects_bools_negatives_and_floats', () => {
    assert.equal(parseProgress({ current: '', total: 10, unindexed: true }), null);
    assert.equal(parseProgress({ current: '', total: false, unindexed: 1 }), null);
    assert.equal(parseProgress({ current: '', total: 10, unindexed: -1 }), null);
    assert.equal(parseProgress({ current: '', total: -10, unindexed: 1 }), null);
    assert.equal(parseProgress({ current: '', total: 10, unindexed: 1.5 }), null);
    assert.equal(parseProgress({ current: '', total: 10.2, unindexed: 1 }), null);
    assert.equal(parseProgress({ current: '', total: '10', unindexed: 1 }), null);
    assert.equal(parseProgress({ current: 3, total: 10, unindexed: 1 }), null);
    assert.equal(parseProgress({ current: '', total: Number.NaN, unindexed: 1 }), null);
    assert.deepEqual(parseProgress({ current: 'Aebel', total: 10, unindexed: 4 }), {
        current: 'Aebel',
        total: 10,
        unindexed: 4,
    });
});

test('progress_cuts_current_at_200', () => {
    const long = 'x'.repeat(250);
    const parsed = parseProgress({ current: long, total: 10, unindexed: 4 });
    assert.equal(parsed?.current.length, 200);
    // A missing or null `current` is an empty one (the hub writes "" for both).
    assert.equal(parseProgress({ total: 10, unindexed: 4 })?.current, '');
    assert.equal(parseProgress({ current: null, total: 10, unindexed: 4 })?.current, '');
});

test('progress_cut_keeps_surrogate_pairs_whole', () => {
    // 199 characters then an astral one (two UTF-16 units): a cut by code units would keep half
    // of it. Cut by code points, the 200th is whole and nothing past it survives.
    const name = 'x'.repeat(199) + '\u{1F3B5}' + 'tail';
    const current = parseProgress({ current: name, total: 10, unindexed: 4 })?.current ?? '';
    assert.equal(Array.from(current).length, 200);
    assert.equal(current.endsWith('\u{1F3B5}'), true);
    assert.equal(/[\uD800-\uDBFF]$/.test(current), false);
    // Astral characters count as one each.
    const astral = '\u{1F3B5}'.repeat(250);
    assert.equal(
        Array.from(parseProgress({ current: astral, total: 1, unindexed: 1 })?.current ?? '')
            .length,
        200,
    );
});

test('progress_zero_is_kept', () => {
    assert.deepEqual(parseProgress({ current: '', total: 10, unindexed: 0 }), {
        current: '',
        total: 10,
        unindexed: 0,
    });
});

test('progress_only_frame_detected', () => {
    const cursor = { epoch: 'e1', seq: 40 };
    assert.equal(isProgressOnlyFrame({ epoch: 'e1', seq: 40 }, cursor), true);
    assert.equal(isProgressOnlyFrame({ epoch: 'e1', seq: 12 }, cursor), true);
    assert.equal(isProgressOnlyFrame({ epoch: 'e2', seq: 40 }, cursor), false);
    assert.equal(isProgressOnlyFrame({ epoch: 'e1', seq: 41 }, cursor), false);
    // No mirror cursor yet: every frame is a reason to pull.
    assert.equal(isProgressOnlyFrame({ epoch: 'e1', seq: 40 }, null), false);
});
