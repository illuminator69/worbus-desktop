import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-178 (Phase B, the desktop half; the hub's `reach` shipped as H4):
 *   node --test src/renderer/features/player/station/station-reach.harness.ts
 *
 * A filtered custom radio counted 22 and the station served 50: `count` is the pool at the
 * character's first ceiling, and the ladder widens past it. The hub says how far it reaches
 * (`reach`, PROTOCOL §18.1, absent from an older hub = the count). Main's count parser dropped it,
 * so the mix form's line could only ever say the first-ceiling number.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('main_keeps_the_hubs_reach', () => {
    const main = read('../../../../main/features/core/station/index.ts');
    const parser = main.slice(main.indexOf('const toCount'), main.indexOf('const toCount') + 800);
    assert.match(parser, /reach:/, 'toCount drops `reach`');
});

test('the_mix_form_counts_what_the_radio_reaches', () => {
    const form = read('../../mixes/components/mix-form.tsx');
    assert.match(form, /reachableSongs\(/, 'the line says the first-ceiling count');
});
