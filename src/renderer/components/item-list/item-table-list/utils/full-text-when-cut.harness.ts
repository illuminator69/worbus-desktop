import assert from 'node:assert/strict';
import test from 'node:test';

import type { CutBox, FullTextTarget } from './full-text-when-cut.ts';

import { isCut, showFullTextWhenCut } from './full-text-when-cut.ts';

/**
 * B-267:  node --test src/renderer/components/item-list/item-table-list/utils/full-text-when-cut.harness.ts
 *
 * A table cell cut to one line with an ellipsis must still let the user read the whole text. No
 * table cell offered it (the title column has neither a `title` attribute nor a tooltip), so every
 * text cell gets the native `title` attribute, set when the pointer enters and only when the text
 * is cut: a cell that shows everything gets no tooltip.
 */

const box = (clientWidth: number, scrollWidth: number, clientHeight = 20, scrollHeight = 20) =>
    ({ clientHeight, clientWidth, scrollHeight, scrollWidth }) satisfies CutBox;

const target = (
    own: CutBox,
    textContent: null | string,
    descendants: CutBox[] = [],
): FullTextTarget & { attributes: Map<string, string> } => {
    const attributes = new Map<string, string>();
    return {
        ...own,
        attributes,
        querySelectorAll: () => descendants,
        removeAttribute: (name) => {
            attributes.delete(name);
        },
        setAttribute: (name, value) => {
            attributes.set(name, value);
        },
        textContent,
    };
};

test('aBoxIsCutWhenItsTextIsWiderOrTallerThanTheBox', () => {
    assert.equal(isCut(box(40, 120)), true);
    assert.equal(isCut(box(40, 40)), false);
    // A clamped title: its lines go below the box.
    assert.equal(isCut(box(200, 200, 40, 60)), true);
    // An inline element has no box of its own to be cut by.
    assert.equal(isCut(box(0, 0)), false);
});

test('aCutCellGetsItsFullTextAsTheTitle', () => {
    const album = target(box(24, 96), 'Wysteria Lane');
    showFullTextWhenCut(album);
    assert.equal(album.attributes.get('title'), 'Wysteria Lane');
});

test('aCellThatShowsEverythingGetsNoTitle', () => {
    const album = target(box(120, 96), 'Wysteria Lane');
    album.attributes.set('title', 'stale');
    showFullTextWhenCut(album);
    assert.equal(album.attributes.has('title'), false);
});

test('severalLinksReadAsOneLine', () => {
    // Two artists: the links and the ", " between them are the cell's text, spaces collapsed.
    const artists = target(box(30, 140), '  Daft Punk,\n  Pharrell Williams ');
    showFullTextWhenCut(artists);
    assert.equal(artists.attributes.get('title'), 'Daft Punk, Pharrell Williams');
});

test('aCutInsideTheCellCounts', () => {
    // Genre badges: the row of badges fits, a badge's own label is cut.
    const badges = target(box(40, 40), 'IndieRock', [box(18, 18), box(8, 30)]);
    showFullTextWhenCut(badges, 'Indie, Rock');
    assert.equal(badges.attributes.get('title'), 'Indie, Rock');
});

test('anEmptyCellGetsNoTitle', () => {
    const empty = target(box(10, 30), '   ');
    showFullTextWhenCut(empty);
    assert.equal(empty.attributes.has('title'), false);
});

test('aHiddenPartCountsAsCut', () => {
    // R16 review M1: genre badges past the ones that fit are hidden whole (and a song can have
    // more genres than the cell draws): nothing on screen is cut, yet a genre is not shown.
    const badges = target(box(24, 24), 'Indie', [box(20, 20)]);
    showFullTextWhenCut(badges, 'Indie, Rock, Shoegaze', true);
    assert.equal(badges.attributes.get('title'), 'Indie, Rock, Shoegaze');
    const all = target(box(200, 200), 'IndieRock', [box(40, 40), box(40, 40)]);
    all.attributes.set('title', 'stale');
    showFullTextWhenCut(all, 'Indie, Rock', false);
    assert.equal(all.attributes.has('title'), false);
});
