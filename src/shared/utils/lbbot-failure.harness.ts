import assert from 'node:assert/strict';
import test from 'node:test';

import { describeFailure, isLbRefusal, refusalCode } from './lbbot-failure.ts';

/**
 * Worbus P1, lane F (F1):  node --test src/shared/utils/lbbot-failure.harness.ts
 *
 * `describeFailure` moved out of the main lb-bot client unchanged, plus lb-bot P1's two
 * refusals: downloading is off (409 `downloads_off`) and lb-bot refused this hub (401
 * `signin_required`, an older hub that sends no bearer, B-263).
 */

test('describe_downloads_off', () => {
    assert.equal(
        describeFailure(409, {
            code: 'downloads_off',
            error: 'Downloading is not set up on this server.',
        }),
        "This server isn't set up to get albums.",
    );
    // Another 409 still relays lb-bot's own sentence, as before.
    assert.equal(
        describeFailure(409, { code: 'poor_match', error: 'Only 3 of 10 files fit.' }),
        'Only 3 of 10 files fit.',
    );
});

test('describe_signin_required', () => {
    assert.equal(
        describeFailure(401, { code: 'signin_required' }),
        "lb-bot refused this hub. Update the hub, or check that its HUB_TOKEN matches lb-bot's LB_BOT_HUB_TOKEN.",
    );
    // A 401 without the code (the hub's own token check) is not lb-bot's refusal.
    assert.equal(describeFailure(401, null), 'Request failed (401)');
});

test('describe_unchanged_branches', () => {
    assert.equal(
        describeFailure(405, null),
        'This lb-bot is older than the hub and does not have that route yet.',
    );
    assert.equal(
        describeFailure(404, null),
        'This hub does not know that route — restart the hub to pick up its newer lb-bot features.',
    );
    assert.equal(
        describeFailure(404, { code: 'unknown_mbid', error: 'No such artist.' }),
        'No such artist.',
    );
    const busy =
        'lb-bot is busy or unreachable. It handles one request at a time while searching; try again in a moment.';
    assert.equal(describeFailure(502, { error: 'lb-bot unreachable' }), busy);
    assert.equal(describeFailure(504, null), busy);
    assert.equal(
        describeFailure(502, {
            error: 'MusicBrainz is down; nothing was stored.',
            retryable: true,
        }),
        'MusicBrainz is down; nothing was stored.',
    );
    assert.equal(describeFailure(0, null), 'Could not reach the hub.');
    assert.equal(describeFailure(500, { error: 'boom' }), 'boom');
    assert.equal(describeFailure(500, null), 'Request failed (500)');
});

test('refusal_code_names_only_the_two_refusals', () => {
    assert.equal(refusalCode(409, { code: 'downloads_off' }), 'downloads_off');
    assert.equal(refusalCode(401, { code: 'signin_required' }), 'signin_required');
    assert.equal(refusalCode(409, { code: 'poor_match' }), null);
    assert.equal(refusalCode(401, null), null);
    assert.equal(refusalCode(400, { code: 'downloads_off' }), null);
    assert.equal(refusalCode(403, { code: 'signin_required' }), null);
});

// F7 walk (B-263): a read that already had data and is then refused (401 signin_required behind an
// older hub, 409 downloads_off) must not reach the app-wide red error toast: the refused flag or
// the mode already says it. Anything else still does.
test('refusal_errors_are_quiet', () => {
    assert.equal(isLbRefusal('signin_required'), true);
    assert.equal(isLbRefusal('downloads_off'), true);
    assert.equal(isLbRefusal('bad_source'), false);
    assert.equal(isLbRefusal(''), false);
    assert.equal(isLbRefusal(undefined), false);
});
