import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-192 (L5-10, the command palette's half; the audit AUDIT-redesign-walk-2026-10-22):
 *   node --test src/renderer/features/search/components/palette-strings.harness.ts
 *
 * The palette wrote its own group headings, the MusicBrainz sections' headings and their "in your
 * library" badges in English beside groups read from i18n. They now all come from i18n (English
 * only until translated; other languages fall back to English). The fork's sidebar entries the
 * Discover group lists (`navi-connect-items.ts`) are the sidebar's own labels, not the palette's.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const FILES = [
    './go-to-commands.tsx',
    './command-palette.tsx',
    './search-external-albums-section.tsx',
    './search-external-artists-section.tsx',
];

test('no_palette_heading_or_label_is_a_literal', () => {
    const found: string[] = [];
    for (const file of FILES) {
        const src = read(file);
        for (const m of src.matchAll(/\b(heading|label)="([^"]+)"/g))
            found.push(`${file}: ${m[0]}`);
        for (const literal of ["'In your library'", "'Added \u2014 waiting for library'"]) {
            if (src.includes(literal)) found.push(`${file}: ${literal}`);
        }
    }
    assert.deepEqual(found, []);
});

test('the_keys_exist_in_english', () => {
    const en = JSON.parse(read('../../../../i18n/locales/en.json'));
    const search = en.page.globalSearch;
    for (const key of [
        'albumsOnMusicBrainz',
        'commandMenu',
        'discover',
        'inYourLibrary',
        'notInYourLibrary',
        'waitingForLibrary',
    ]) {
        assert.equal(typeof search[key], 'string', `page.globalSearch.${key}`);
    }
});
