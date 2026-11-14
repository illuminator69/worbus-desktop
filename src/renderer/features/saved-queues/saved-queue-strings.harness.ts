import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-192 (the redesign audit's L5-10, 2026-10-22):
 *   node --test src/renderer/features/saved-queues/saved-queue-strings.harness.ts
 *
 * Continue Listening's card menu and the Saved queues page wrote their menu items, modal titles and
 * toasts in English in the code ("Resume", "Preview queue", "Save as playlist", "Remove from
 * history", "Rename queue", "Saved 12 tracks", ...), so no other language could show them. They read
 * the i18n strings now.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const ENGLISH = /(?:label|title|message|aria-label)\s*[:=]\s*[`'"][A-Z][a-z]/;

test('no_english_in_the_saved_queue_menus', () => {
    for (const file of [
        '../home/components/continue-listening-row.tsx',
        './routes/saved-queues-route.tsx',
    ]) {
        const hits = read(file)
            .split('\n')
            .map((line, i) => [i + 1, line.trim()] as const)
            .filter(([, line]) => ENGLISH.test(line));
        assert.deepEqual(hits, [], file);
    }
});

test('the_strings_exist_in_english', () => {
    const en = JSON.parse(read('../../../i18n/locales/en.json'));
    for (const key of [
        'couldNotAddTracks',
        'previewQueue',
        'queueActions',
        'removeFromHistory',
        'renameQueue',
        'resume',
        'saveAsPlaylist',
        'saveQueueAsPlaylist',
        'savedTracks_one',
        'savedTracks_other',
    ]) {
        assert.equal(typeof en.page.savedQueues?.[key], 'string', key);
    }
});
