import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { aboutRow } from './album-page-layout.ts';

/**
 * R3 Task 2: the owned album page's About row. Both with content is About then the tags (R13: the
 * tags under the About, no longer beside it), one is that one alone, neither is nothing, and a
 * pending About keeps its place so the tracklist does not jump when the text lands.
 *
 *     node --test src/renderer/features/albums/album-page-layout.harness.ts
 */

const none = { aboutLoading: false, hasAbout: false, linkCount: 0, tagCount: 0 };

test('emptyAboutRowRendersNothing: no About, no tags, no links', () => {
    assert.equal(aboutRow(none), 'none');
});

test('aboutOnly: About text and nothing on the side', () => {
    assert.equal(aboutRow({ ...none, hasAbout: true }), 'about-only');
});

test('sideOnly: tags without About', () => {
    assert.equal(aboutRow({ ...none, tagCount: 2 }), 'side-only');
    assert.equal(aboutRow({ ...none, linkCount: 1 }), 'side-only');
});

test('two: About and tags or links', () => {
    assert.equal(aboutRow({ ...none, hasAbout: true, tagCount: 3 }), 'two');
    assert.equal(aboutRow({ ...none, hasAbout: true, linkCount: 2 }), 'two');
});

test('loadingKeepsTheLeftColumn: a pending About holds the left column', () => {
    assert.equal(aboutRow({ ...none, aboutLoading: true, tagCount: 2 }), 'two');
    assert.equal(aboutRow({ ...none, aboutLoading: true }), 'about-only');
});

test('the tags and links sit under the About, never beside it (R13, B-243)', () => {
    // Beside a taller tags column the folded About left an empty band under its five lines.
    const css = readFileSync(
        new URL('./components/album-detail-content.module.css', import.meta.url),
        'utf8',
    );
    const rule = css.slice(css.indexOf('.about-row {'), css.indexOf('.about {'));
    assert.ok(rule.includes('flex-direction: column;'), rule);
    assert.ok(!/grid-template-columns/.test(rule), rule);
    // And the About does not stretch to fill a neighbour: no fill measure is left in the page.
    const page = readFileSync(
        new URL('./components/album-detail-content.tsx', import.meta.url),
        'utf8',
    );
    assert.ok(!page.includes('fillPx'));
});
