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
    nativeSessionExpired?: (ndCredential: string | undefined, nowMs: number) => boolean;
    signInKey?: (server: {
        credential?: string;
        ndCredential?: string;
        url: string;
        username: string;
    }) => string;
};

const b64url = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url').replace(/=+$/, '');
const jwt = (claims: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.sig`;
const NOW = Date.UTC(2026, 10, 12, 22, 25);

test('an_expired_navidrome_session_reads_as_expired', () => {
    assert.equal(typeof rule.nativeSessionExpired, 'function', 'no rule reads the native session');
    const expired = jwt({ exp: Math.floor(NOW / 1000) - 3600, sub: 'icher' });
    const live = jwt({ exp: Math.floor(NOW / 1000) + 3600, sub: 'icher' });
    assert.equal(rule.nativeSessionExpired!(expired, NOW), true);
    assert.equal(rule.nativeSessionExpired!(live, NOW), false);
    // What cannot be read is not called expired: the server decides then, as before.
    assert.equal(rule.nativeSessionExpired!(undefined, NOW), false);
    assert.equal(rule.nativeSessionExpired!('not-a-jwt', NOW), false);
    assert.equal(rule.nativeSessionExpired!(jwt({ sub: 'icher' }), NOW), false);
});

test('the_start_check_asks_about_the_session_the_library_uses', () => {
    const hook = read('./use-server-authenticated.ts');
    const valid = hook.indexOf('setReady(AuthState.VALID)');
    const asked = hook.indexOf('nativeSessionExpired(');
    assert.ok(
        asked > 0 && asked < valid,
        'the start check reads only getUserInfo (Subsonic) and declares the session valid',
    );
});

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
