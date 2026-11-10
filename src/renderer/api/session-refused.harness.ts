import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { whenSessionRefused } from '../../shared/utils/saved-password.ts';

/**
 * B-338 (Phase B, W7):
 *   node --test src/renderer/api/session-refused.harness.ts
 *
 * A Worbus profile copied from Feishin carries the old app's saved Navidrome session and a saved
 * password the new app's keyring cannot decrypt. The first native call answers 401; the
 * re-authentication asks main for the password, main answers `null` - the same answer as "no
 * password saved" - and the 401 path reads that as revoked credentials: `authenticationFailure`
 * removes the password and logs out, and the hub follows the logout with a sign-out. An
 * unreadable password must ask for the password again, and nothing else.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('main_tells_an_unreadable_password_from_none_saved', () => {
    const settings = read('../../main/features/core/settings/index.ts');
    assert.match(
        settings,
        /kind: 'unreadable'/,
        "main answers an unreadable password as null, the same as 'none saved'",
    );
});

test('the_401_path_asks_again_for_an_unreadable_password', () => {
    const nd = read('./navidrome/navidrome-api.ts');
    const branch = nd.slice(nd.indexOf('error.response.status === 401'));
    assert.match(
        branch,
        /whenSessionRefused\(/,
        'the 401 path reads a null password as revoked credentials and logs out',
    );
});

test('the_start_check_asks_again_for_an_unreadable_password', () => {
    const hook = read('../hooks/use-server-authenticated.ts');
    assert.match(
        hook,
        /whenSessionRefused\(/,
        'the start check reads a null password as revoked credentials and logs out',
    );
});

test('one_rule_for_a_refused_session', () => {
    assert.equal(whenSessionRefused({ kind: 'ok', password: 'pw' }), 'reauthenticate');
    assert.equal(whenSessionRefused({ kind: 'unreadable' }), 'askAgain');
    assert.equal(whenSessionRefused({ kind: 'none' }), 'expire');
});

test('asking_again_logs_nobody_out', () => {
    // The ask path must not reach the expiry path's passwordRemove + logout (which the hub
    // follows with a sign-out): in the 401 path the asked marker is rethrown before limitedFail.
    const nd = read('./navidrome/navidrome-api.ts');
    const branch = nd.slice(nd.indexOf('error.response.status === 401'));
    const caught = branch.slice(branch.indexOf('.catch((newError'));
    assert.ok(
        caught.indexOf('if (newError === PASSWORD_ASKED) throw error;') <
            caught.indexOf('limitedFail(currentServer)'),
    );
    const utils = read('./utils.ts');
    const ask = utils.slice(utils.indexOf('export const askForPasswordAgain'));
    assert.doesNotMatch(
        ask.slice(0, ask.indexOf('\n};')),
        /logout|passwordRemove|setCurrentServer/,
    );
    // The start check returns before its own passwordRemove + setCurrentServer(null).
    const hook = read('../hooks/use-server-authenticated.ts');
    const asked = hook.indexOf("if (step === 'askAgain')");
    const back = hook.indexOf('return;', asked);
    assert.ok(asked > 0 && back > asked && back < hook.indexOf('setCurrentServer(null)'));
    assert.doesNotMatch(hook.slice(asked, back), /passwordRemove|setCurrentServer/);
    // The session token is not written to the console any more.
    assert.doesNotMatch(utils, /token is expired: \$\{/);
});
