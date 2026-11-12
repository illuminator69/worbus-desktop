import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { indexBarState, indexBarText } from './index-progress.ts';

/**
 * Worbus P1, lane F (F5):  node --test src/renderer/features/home/index-progress.harness.ts
 *
 * Home's index bar: shown while lb-bot is there and still has artists to index, its count text
 * (Worbus for Android's words; the keys are resolved against en.json here), and a source guard that Home's
 * route itself never reads the progress (only the bar does, so a push re-renders the bar alone).
 */

const en = JSON.parse(
    readFileSync(new URL('../../../i18n/locales/en.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const resolve = (line: { key: string; values: Record<string, string> }): string => {
    let node: unknown = en;
    for (const part of line.key.split('.')) node = (node as Record<string, unknown>)?.[part];
    assert.equal(typeof node, 'string', `en.json has no string at ${line.key}`);
    return (node as string).replace(/\{\{(\w+)\}\}/g, (_, name: string) => line.values[name] ?? '');
};

const format = new Intl.NumberFormat('en-US').format;

test('bar_shown_while_unindexed_positive', () => {
    const state = indexBarState(true, { current: 'Aebel', total: 120, unindexed: 30 });
    assert.deepEqual(state, { current: 'Aebel', fraction: 0.75, left: 30, show: true, total: 120 });
});

test('bar_hides_at_zero_and_on_absence', () => {
    assert.deepEqual(indexBarState(true, { current: '', total: 120, unindexed: 0 }), {
        show: false,
    });
    assert.deepEqual(indexBarState(true, null), { show: false });
});

test('bar_hides_when_unavailable', () => {
    // The hub keeps the last progress while lb-bot is gone: a bar for a gone lb-bot never ends.
    assert.deepEqual(indexBarState(false, { current: 'Aebel', total: 120, unindexed: 30 }), {
        show: false,
    });
});

test('bar_counts_text', () => {
    const state = indexBarState(true, { current: 'Essential Logic', total: 2479, unindexed: 1821 });
    assert.ok(state.show);
    assert.equal(
        resolve(indexBarText(state, format)),
        'Indexing your library · 1,821 of 2,479 artists left · Essential Logic',
    );
});

test('bar_text_without_current', () => {
    const state = indexBarState(true, { current: '', total: 2479, unindexed: 1821 });
    assert.ok(state.show);
    assert.equal(
        resolve(indexBarText(state, format)),
        'Indexing your library · 1,821 of 2,479 artists left',
    );
});

test('bar_fraction_total_zero', () => {
    const state = indexBarState(true, { current: '', total: 0, unindexed: 4 });
    assert.ok(state.show);
    assert.equal(state.fraction, 0);
    // More left than the total (a buggy count) clamps, never a negative bar.
    const over = indexBarState(true, { current: '', total: 10, unindexed: 14 });
    assert.ok(over.show);
    assert.equal(over.fraction, 0);
});

test('home_route_does_not_read_the_progress', () => {
    const route = readFileSync(new URL('./routes/home-route.tsx', import.meta.url), 'utf8');
    assert.ok(!route.includes('useLbBotIndexProgress('), 'home-route.tsx reads the progress');
    assert.ok(route.includes('<IndexProgressBar'), 'home-route.tsx does not mount the bar');
    const bar = readFileSync(
        new URL('./components/index-progress-bar.tsx', import.meta.url),
        'utf8',
    );
    assert.ok(bar.includes('useLbBotIndexProgress('), 'the bar does not read the progress');
});

test('a_build_that_ended_with_failed_lookups_says_so', () => {
    // B-332 (fix round 2, 2026-11-12): `unindexed == 0 && failed > 0` is not "done": the bar says
    // "Couldn't look up {failed} artists" instead of folding away. `failed` absent (an older lb-bot)
    // or 0: today's behaviour. While artists are still left, the countdown as before.
    const ended = indexBarState(true, { current: '', failed: 3, total: 120, unindexed: 0 });
    assert.ok(ended.show, 'a build with failed lookups reads as done');
    assert.equal(resolve(indexBarText(ended, format)), "Couldn't look up 3 artists");
    const one = indexBarState(true, { current: '', failed: 1, total: 120, unindexed: 0 });
    assert.ok(one.show);
    assert.equal(resolve(indexBarText(one, format)), "Couldn't look up 1 artist");
    assert.deepEqual(indexBarState(true, { current: '', failed: 0, total: 120, unindexed: 0 }), {
        show: false,
    });
    assert.deepEqual(indexBarState(true, { current: '', total: 120, unindexed: 0 }), {
        show: false,
    });
    const running = indexBarState(true, { current: '', failed: 2, total: 120, unindexed: 30 });
    assert.ok(running.show);
    assert.equal(
        resolve(indexBarText(running, format)),
        'Indexing your library · 30 of 120 artists left',
    );
    // Hidden while lb-bot is gone, as the countdown is.
    assert.deepEqual(indexBarState(false, { current: '', failed: 3, total: 120, unindexed: 0 }), {
        show: false,
    });
});
