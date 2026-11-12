import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintRequest } from './fingerprint-request.ts';

/**
 * The desktop half of B-359 (Android review, cross-lane; fix round 2026-11-12):
 *   node --test src/main/features/core/audiomuse/fingerprint-request.harness.ts
 *
 * The direct AudioMuse fallback sent the Navidrome user AND PASSWORD as GET query parameters, so
 * they sit in AudioMuse's access log and any proxy's. AudioMuse 3.7.1 reads the same fields from a
 * POST JSON body (`app_sonic_fingerprint.py`, `methods=['GET','POST']`; read by the Android lane in
 * the NAS container, RESULTS-phase-b-android-2026-11-10.md). No credential in any outgoing URL.
 */

const direct = { base: 'http://am:8000', token: 'am-token', viaHub: false };
const hub = { base: 'http://hub:4790', token: 'device-secret', viaHub: true };
const account = { count: 50, ndPassword: 'hunter2', ndUser: 'alice' };

test('no_password_in_the_url', () => {
    for (const ep of [direct, hub]) {
        const { url } = fingerprintRequest(ep, account);
        assert.doesNotMatch(url, /hunter2|navidrome_password/, `${ep.base}: password in the URL`);
        assert.doesNotMatch(url, /alice|navidrome_user/, `${ep.base}: user in the URL`);
    }
});

test('the_direct_route_posts_the_account_in_a_json_body', () => {
    const { init, url } = fingerprintRequest(direct, account);
    assert.equal(url, 'http://am:8000/api/sonic_fingerprint/generate');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.headers.Authorization, 'Bearer am-token');
    assert.deepEqual(JSON.parse(init.body ?? ''), {
        n: 50,
        navidrome_password: 'hunter2',
        navidrome_user: 'alice',
    });
    // An account not set is left out: the core falls back to its own.
    const bare = fingerprintRequest(direct, { count: 10, ndPassword: '', ndUser: '' });
    assert.deepEqual(JSON.parse(bare.init.body ?? ''), { n: 10 });
});

test('the_hub_route_is_unchanged_and_carries_no_account', () => {
    // The hub injects its own account and drops a client-sent one; its route stays a GET.
    const { init, url } = fingerprintRequest(hub, account);
    assert.equal(url, 'http://hub:4790/sonic/fingerprint?n=50');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.headers.Authorization, 'Bearer device-secret');
});
