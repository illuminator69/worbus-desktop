import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
