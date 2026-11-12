import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { whenSessionRefused } from '../../shared/utils/saved-password.ts';

/**
 * B-338 (Phase B, W7):
 *   node --test src/renderer/api/session-refused.harness.ts
 *
 * A Worbus profile copied at the move from the old app carries the old app's saved Navidrome session and a saved
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

test('a_cancelled_ask_does_not_come_back_until_the_sign_in_changes', async () => {
    // Review minor (fix round 2026-11-12): Mantine's OPEN is a no-op only while a modal with the
    // same id is still open. After Cancel the next refused request opened the form again, and
    // nothing short of typing the password ended the loop.
    const { createPasswordAsk } = await import('../../shared/utils/saved-password.ts');
    const opened: string[] = [];
    const ask = createPasswordAsk((s: { id: string }) => opened.push(s.id));
    const server = { credential: 'u=a&s=1&t=2', id: 'nd', url: 'http://nd', username: 'a' };
    ask(server);
    ask(server); // the next 401 after Cancel
    ask({ ...server }); // the same entry, read again from the store
    assert.deepEqual(opened, ['nd'], 'the form reopens on every refusal after a Cancel');
    // A sign-in that worked wrote new credentials: a later refusal is a new one, and asks.
    ask({ ...server, credential: 'u=a&s=3&t=4', ndCredential: 'new' });
    assert.deepEqual(opened, ['nd', 'nd']);
    // Another server, or this one at another address or user, asks for itself.
    ask({ ...server, id: 'other' });
    ask({ ...server, credential: 'u=a&s=3&t=4', ndCredential: 'new', url: 'http://nd2' });
    assert.deepEqual(opened, ['nd', 'nd', 'other', 'nd']);
});

test('the_asked_form_closes_only_itself_on_success', () => {
    // Review nit (fix round 2026-11-12): on success the edit form called closeAllModals(), which
    // also closed whatever modal the asked form had opened over.
    const form = read('../features/servers/components/edit-server-form.tsx');
    assert.match(form, /onDone\?: \(\) => void/);
    assert.match(form, /if \(isUpdate\) \(onDone \?\? closeAllModals\)\(\);/);
    const ask = read('../features/servers/utils/ask-for-password.tsx');
    assert.match(ask, /onDone=\{\(\) => closeModal\(ASK_FOR_PASSWORD_MODAL\)\}/);
});
