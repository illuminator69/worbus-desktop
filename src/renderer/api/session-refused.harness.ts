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

test('a_failed_reauthentication_logs_no_credential', async () => {
    // Review minor (fix round 2026-11-12): the reauthentication's catch printed the whole AxiosError
    // to the DevTools console: its `config.headers['x-nd-authorization']` is the Bearer token, and a
    // failed `/auth/login` POST's `config.data` is the password. Only a safe summary is logged.
    const nd = read('./navidrome/navidrome-api.ts');
    const at = nd.indexOf("'Error when trying to reauthenticate");
    assert.ok(at > 0);
    const call = nd.slice(at, nd.indexOf(');', at) + 2);
    assert.doesNotMatch(call, /,\s*newError\s*\)/, 'the whole error object reaches the console');
    assert.match(call, /errorSummary\(newError\)/);
    const mod = (await import('../../shared/utils/error-summary.ts').catch(() => null)) as null | {
        errorSummary: (e: unknown) => unknown;
    };
    assert.ok(mod, 'no safe summary to log');
    const axiosLike = Object.assign(new Error('Request failed with status code 401'), {
        code: 'ERR_BAD_REQUEST',
        config: {
            data: '{"password":"hunter2","username":"a"}',
            headers: { 'x-nd-authorization': 'Bearer eyJsecret' },
            url: 'http://nd/auth/login',
        },
        isAxiosError: true,
        response: { data: { error: 'Invalid' }, status: 401 },
    });
    const summary = mod.errorSummary(axiosLike);
    assert.deepEqual(summary, {
        code: 'ERR_BAD_REQUEST',
        message: 'Request failed with status code 401',
        status: 401,
    });
    assert.doesNotMatch(JSON.stringify(summary), /hunter2|eyJsecret|Bearer/);
    assert.deepEqual(mod.errorSummary('plain'), { message: 'plain' });
    assert.deepEqual(mod.errorSummary(undefined), { message: 'undefined' });
});

test('after_a_cancel_one_pointer_says_where_to_sign_in', async () => {
    // Fix round 2 (2026-11-12), review nit: after Cancel every refusal of the same sign-in failed
    // silently. The first suppressed ask points to the server menu, once per sign-in.
    const { createPasswordAsk } = await import('../../shared/utils/saved-password.ts');
    const pointed: string[] = [];
    let closeForm: () => void = () => undefined;
    const ask = (createPasswordAsk as (...a: unknown[]) => (s: unknown) => boolean)(
        // Fix round 4: the form reports its close; a Cancel is modelled by calling it.
        (_s: unknown, closed: () => void) => {
            closeForm = closed;
        },
        (s: { id: string }) => pointed.push(s.id),
    );
    const server = { credential: 'c1', id: 'nd', url: 'http://nd', username: 'a' };
    ask(server); // the form
    closeForm(); // Cancel
    ask(server); // suppressed: the pointer
    ask(server); // suppressed again: nothing more
    assert.deepEqual(pointed, ['nd'], 'a suppressed ask says nothing');
    ask({ ...server, credential: 'c2' }); // a new sign-in: the form again
    closeForm(); // Cancel
    ask({ ...server, credential: 'c2' }); // and one pointer for it
    assert.deepEqual(pointed, ['nd', 'nd']);
    const utils = read('./utils.ts');
    assert.match(
        utils,
        /createPasswordAsk<ServerListItem>\(\s*\(server, closed\) => askHandler\?\.\(server, closed\),\s*\(\) =>/,
    );
});

test('a_concurrent_refusal_joins_the_open_form_instead_of_pointing', async () => {
    // Fix round 4 (2026-11-12), from the VM walk: several 401s arrive together; the first opened
    // the form and the second, the same sign-in, was counted as "suppressed after a Cancel", so
    // the pointer toast showed beside the form before any Cancel. While the form is open, a
    // refusal joins it; the pointer is for a refusal after the form was closed.
    const { createPasswordAsk } = await import('../../shared/utils/saved-password.ts');
    const pointed: string[] = [];
    let closeForm: () => void = () => undefined;
    const ask = (createPasswordAsk as (...a: unknown[]) => (s: unknown) => boolean)(
        (_s: unknown, closed?: () => void) => {
            closeForm = closed ?? (() => undefined);
        },
        (s: { id: string }) => pointed.push(s.id),
    );
    const server = { credential: 'c1', id: 'nd', url: 'http://nd', username: 'a' };
    ask(server); // the form opens
    ask(server); // a concurrent 401: joins it
    ask(server);
    assert.deepEqual(pointed, [], 'the pointer shows beside the open form');
    closeForm(); // Cancel
    ask(server); // suppressed after the Cancel: the pointer, once
    ask(server);
    assert.deepEqual(pointed, ['nd']);
    const utils = read('./utils.ts');
    assert.match(utils, /\(server, closed\) => askHandler\?\.\(server, closed\)/);
    const modal = read('../features/servers/utils/ask-for-password.tsx');
    assert.match(modal, /onClose: closed/);
});
