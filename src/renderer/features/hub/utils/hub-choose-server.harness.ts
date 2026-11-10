import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createChooseServer } from './hub-found-tap.ts';

/**
 * B-330 (Phase B, W7):
 *   node --test src/renderer/features/hub/utils/hub-choose-server.harness.ts
 *
 * The Server tab has two ways to choose a server while none is set: tap a found one, or "Type an
 * address". They must follow one rule. The found tap saves the address, turns Connect on and signs
 * in; the typed field's blur only wrote `hub.url`, so a fresh profile that typed its address read
 * "Connect is off." (Android's W-1 turns Connect on there).
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('typed_address_goes_through_the_found_taps_rule', () => {
    const tab = read('../../settings/components/server/worbus-server-settings.tsx');
    const field = tab.slice(tab.indexOf('aria-label="Server address"'));
    const blur = field.slice(field.indexOf('onBlur'), field.indexOf('onChange'));
    assert.doesNotMatch(
        blur,
        /setSettings\(\{ hub: \{ url \} \}\)/,
        'the typed blur writes only hub.url: Connect stays off and nothing signs in',
    );
    assert.match(blur, /chooseServer\(/, 'the typed blur goes through the one setup rule');
});

const recorder = () => {
    const calls: string[] = [];
    const choose = createChooseServer({
        edit: async (op) => {
            calls.push(`edit ${JSON.stringify(op)}`);
        },
        setHub: (patch) => calls.push(`settings ${JSON.stringify(patch)}`),
        signIn: async () => {
            calls.push('signIn');
        },
        stopLooking: () => calls.push('stopLooking'),
    });
    return { calls, choose };
};

test('typed_and_found_take_the_same_steps', async () => {
    const typed = recorder();
    await typed.choose({ kind: 'typed', raw: ' 192.168.1.20:4790 ' });
    assert.deepEqual(typed.calls, [
        'stopLooking',
        `edit ${JSON.stringify({ op: 'add', url: 'ws://192.168.1.20:4790' })}`,
        `settings ${JSON.stringify({ enabled: true, url: 'ws://192.168.1.20:4790' })}`,
        'signIn',
    ]);
    const found = recorder();
    await found.choose({
        address: 'ws://192.168.1.20:4790',
        found: { address: 'ws://192.168.1.20:4790', kind: 'olderAt' },
        kind: 'found',
    });
    // Same steps, in the same order; only what is recorded differs (typed vs found).
    assert.deepEqual(
        found.calls.map((c) => c.split(' ')[0]),
        typed.calls.map((c) => c.split(' ')[0]),
    );
    assert.equal(found.calls[2], typed.calls[2]);
});

test('an_empty_field_chooses_nothing', async () => {
    const r = recorder();
    await r.choose({ kind: 'typed', raw: '   ' });
    assert.deepEqual(r.calls, []);
});

test('the_address_is_recorded_before_the_sign_in', async () => {
    // Main's sign-in goes only to a recorded address (auth.ts requestBase): the record edit is
    // awaited before the sign-in starts.
    const order: string[] = [];
    let release: () => void = () => {};
    const choose = createChooseServer({
        edit: () =>
            new Promise<void>((resolve) => {
                release = () => {
                    order.push('recorded');
                    resolve();
                };
            }),
        setHub: () => order.push('settings'),
        signIn: async () => {
            order.push('signIn');
        },
        stopLooking: () => {},
    });
    const done = choose({ kind: 'typed', raw: 'hub.example.com' });
    await Promise.resolve();
    assert.deepEqual(order, []);
    release();
    await done;
    assert.deepEqual(order, ['recorded', 'settings', 'signIn']);
});
