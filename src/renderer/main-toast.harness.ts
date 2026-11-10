import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-335 (Phase B):
 *   node --test src/renderer/main-toast.harness.ts
 *
 * Main says things to the person through `toast-from-main`: an mpv that failed (with its error
 * code), mpv restarted, the macOS media-keys accessibility warning. The preload exposes
 * `mainMessageListener`, but upstream's only subscriber was a commented-out effect, deleted in
 * 92d4681a2 ("fix unauthenticated flow"), so every one of those toasts reaches no one.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the_renderer_listens_for_main_toasts', () => {
    assert.match(read('./app.tsx'), /utils\?\.mainMessageListener\(/, 'nobody subscribes');
});

test('every_main_toast_is_a_type_the_toast_shows', () => {
    // The sender's types are exactly the ones `toast.show` takes.
    const main = read('../main/index.ts');
    assert.match(main, /type: 'error' \| 'info' \| 'success' \| 'warning';/);
    const keys = read('../main/features/core/player/media-keys.ts');
    assert.match(keys, /send\('toast-from-main', \{[^}]*type: 'warning'/s);
});
