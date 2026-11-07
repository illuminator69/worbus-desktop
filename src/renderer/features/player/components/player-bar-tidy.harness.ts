import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * R14 (B-252, B-253):  node --test src/renderer/features/player/components/player-bar-tidy.harness.ts
 *
 * Pinned on the source: Play random is in the More menu and not in the transport, and the song's
 * text block has a width of its own, so the heart after it does not move from song to song.
 */

const here = new URL('./', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, here), 'utf8');

const block = (text: string, start: string) => {
    const at = text.indexOf(start);
    assert.ok(at >= 0, start);
    return text.slice(at, text.indexOf('\n}', at));
};

test('playRandomLeftTheTransportForMore', () => {
    const center = read('center-controls.tsx');
    assert.ok(!center.includes('ShuffleAllButton'));
    assert.ok(!center.includes('openShuffleAllModal'));
    const more = read('more-control.tsx');
    assert.match(more, /playRandom: 'mediaRandom'/);
    assert.match(more, /playRandom: t\('form\.shuffleAll\.title'\)/);
    assert.match(more, /case 'playRandom':\s*openShuffleAllModal\(\);/);
    // A Remix icon shows only with a fill: the row draws it as the transport did.
    assert.match(more, /new Set\(\['playRandom'\]\)/);
    assert.match(more, /fill=\{FILLED\.has\(item\.id\) \? 'default' : undefined\}/);
});

test('songTextHasAWidthOfItsOwn', () => {
    const css = read('left-controls.module.css');
    // A width in px, not the longest line's (`auto`) nor a share of the column (`%`, which moved
    // the heart with the window): no growing, shrinking only when the window is too narrow.
    assert.match(block(css, '.metadata-stack {'), /flex: 0 1 160px;/);
    assert.ok(!/flex: [^;]*%/.test(block(css, '.metadata-stack {')), 'no share of the column');
    assert.match(block(css, '.metadata-stack {'), /min-width: 0;/);
    const line = block(css, '.line-item {');
    for (const rule of ['overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;']) {
        assert.ok(line.includes(rule), rule);
    }
    // The heart never shrinks, so it keeps its x when the text is cut.
    assert.match(block(css, '.favorite {'), /flex-shrink: 0;/);
});

test('eachCutLineCarriesItsFullText', () => {
    const tsx = read('left-controls.tsx');
    assert.ok(tsx.includes('title={title}'));
    assert.ok(tsx.includes('title={currentSong?.album || undefined}'));
    assert.match(tsx, /title=\{\s*currentSong\?\.artistName \|\|/);
});
