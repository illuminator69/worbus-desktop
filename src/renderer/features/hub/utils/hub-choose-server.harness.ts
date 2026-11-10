import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
