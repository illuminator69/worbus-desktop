import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as savedPassword from '../../shared/utils/saved-password.ts';

/**
 * B-400 (owner walk, 2026-11-13):
 *   node --test src/renderer/hooks/start-check-native-session.harness.ts
 *
 * At a first start whose saved password is unreadable, an error page "Failed to get album list"
 * (getAlbumList, fetchPage) sat behind the sign-in form, and stayed after the sign-in until
 * Refresh. The dev profile's log (2026-11-12 22:25): "Server authentication successful"
 * (method getUserInfo), then 2 s later "Saved password unreadable". The start check asks the
 * Subsonic API (getUserInfo), whose salted token the copied profile still carries; the library
 * pages ask Navidrome's own API, whose session (ndCredential, a JWT) had long expired. So the
 * start check said VALID, the library mounted, its first native query was refused, the 401 path
 * asked for the password and the query's error reached the root error boundary, which nothing
 * resets.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const rule = savedPassword as unknown as {
    signInKey?: (server: {
        credential?: string;
        ndCredential?: string;
        url: string;
        username: string;
    }) => string;
};

// Review M3 (2026-11-13): the token's `exp` against the local clock was replaced by asking Navidrome
// (`the_start_check_asks_navidrome_not_the_clock` below); the two clock tests that stood here went
// with `nativeSessionExpired`.

test('asking_for_the_password_keeps_the_library_unmounted', () => {
    const hook = read('./use-server-authenticated.ts');
    const asked = hook.indexOf("if (step === 'askAgain')");
    const back = hook.indexOf('return;', asked);
    assert.match(
        hook.slice(asked, back),
        /setReady\(AuthState\.PASSWORD_NEEDED\)/,
        'an ask reads INVALID, which mounts the library under a refused session',
    );
    const outlet = read('../layouts/authentication-outlet.tsx');
    const held = outlet.indexOf('AuthState.PASSWORD_NEEDED');
    assert.ok(
        held > 0 && held < outlet.indexOf('<Outlet />'),
        'the outlet renders the library for every state but LOADING',
    );
});

test('a_sign_in_that_worked_checks_again_and_clears_the_error_page', () => {
    assert.equal(typeof rule.signInKey, 'function');
    const a = { credential: 'u=a&t=1', ndCredential: 'x', url: 'http://nd', username: 'a' };
    assert.notEqual(rule.signInKey!(a), rule.signInKey!({ ...a, ndCredential: 'y' }));
    assert.equal(rule.signInKey!(a), rule.signInKey!({ ...a }));
    const hook = read('./use-server-authenticated.ts');
    assert.match(hook, /signInKey\(/, 'nothing checks again once the form signed in');
    const boundary = read('../features/shared/components/router-error-boundary.tsx');
    assert.match(
        boundary,
        /resetKeys=/,
        'the root error page stays mounted after the sign-in that removed its cause',
    );
});

/**
 * B-400 review M2: the sign-in form wrote the new sign-in (updateServer, setCurrentServer), which
 * resets the root error boundary, and only after awaiting the password save removed the cached
 * queries. The boundary remounted the page with the failed query still cached, and TanStack Query
 * rethrows a cached error on remount without a QueryErrorResetBoundary: the error page came back,
 * and nothing reset it again.
 */
test('the_form_drops_the_failed_queries_before_the_sign_in_resets_the_page', () => {
    const form = read('../features/servers/components/edit-server-form.tsx');
    const submit = form.slice(form.indexOf('const handleSubmit'));
    const removed = submit.indexOf('queryClient.removeQueries()');
    const written = submit.indexOf('updateServer(server.id, serverItem)');
    assert.ok(removed > 0 && written > 0);
    assert.ok(
        removed < written,
        'the cached errors are removed after the sign-in that resets the error page',
    );
});

/**
 * B-400 review M3: "expired" was decided from the token's `exp` against this computer's clock. A
 * clock off by more than Navidrome's session timeout read a good session as expired (with no saved
 * password: logged out at every start), and a token refused for any other reason (a rotated
 * secret, a restored database) still passed. Ask Navidrome: one cheap native request at the start
 * check, and act on its answer.
 */
test('the_start_check_asks_navidrome_not_the_clock', () => {
    const verdict = (
        savedPassword as unknown as {
            nativeProbeVerdict?: (status: number | undefined) => 'ok' | 'refused' | 'unknown';
        }
    ).nativeProbeVerdict;
    assert.equal(typeof verdict, 'function', 'the start check reads the clock');
    assert.equal(verdict!(200), 'ok');
    assert.equal(verdict!(401), 'refused');
    assert.equal(verdict!(403), 'refused');
    // No answer, or the server failing: not a refusal; the start goes on as before.
    assert.equal(verdict!(500), 'unknown');
    assert.equal(verdict!(undefined), 'unknown');
    const hook = read('./use-server-authenticated.ts');
    assert.doesNotMatch(hook, /nativeSessionExpired\(/, 'the token is judged by the local clock');
    const probe = hook.indexOf('probeNativeSession(');
    assert.ok(probe > 0 && probe < hook.indexOf('setReady(AuthState.VALID)'));
    assert.match(read('../api/navidrome/navidrome-api.ts'), /export const probeNativeSession/);
});
