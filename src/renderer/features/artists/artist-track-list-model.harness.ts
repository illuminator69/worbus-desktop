import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    blurKeepsRowFocus,
    hasOtherArtists,
    holdOrder,
    nextHeldRows,
    nextStarsDrawn,
    rowFocusOf,
    staticStarsMask,
    TRACK_LIST_NARROW_PX,
    TRACK_LIST_NARROWER_PX,
    trackColumns,
    trackColumnTemplate,
    visibleTracks,
} from './artist-track-list-model.ts';

/**
 * The artist page's compact track list (R10): how many rows show, and which toggle sits under them.
 *
 *     node --test src/renderer/features/artists/artist-track-list-model.harness.ts
 */

const songs = (count: number) => Array.from({ length: count }, (_, i) => `s${i + 1}`);

test('foldedShowsFive', () => {
    const view = visibleTracks({ expanded: false, initial: 5, max: 10, songs: songs(12) });
    assert.deepEqual(view.rows, ['s1', 's2', 's3', 's4', 's5']);
    assert.equal(view.toggle, 'more');
});

test('expandedShowsTen', () => {
    const view = visibleTracks({ expanded: true, initial: 5, max: 10, songs: songs(10) });
    assert.equal(view.rows.length, 10);
    assert.equal(view.toggle, 'less');
});

test('fewerThanFiveShowsAllAndNoToggle', () => {
    for (const expanded of [false, true]) {
        const view = visibleTracks({ expanded, initial: 5, max: 10, songs: songs(3) });
        assert.deepEqual(view.rows, ['s1', 's2', 's3']);
        assert.equal(view.toggle, null);
    }
    const exactlyFive = visibleTracks({ expanded: false, initial: 5, max: 10, songs: songs(5) });
    assert.equal(exactlyFive.rows.length, 5);
    assert.equal(exactlyFive.toggle, null);
});

test('moreThanMaxCapsAtMax', () => {
    const view = visibleTracks({ expanded: true, initial: 5, max: 10, songs: songs(50) });
    assert.deepEqual(view.rows, songs(10));
    assert.equal(view.toggle, 'less');

    const seven = visibleTracks({ expanded: true, initial: 5, max: 10, songs: songs(7) });
    assert.equal(seven.rows.length, 7);
    assert.equal(seven.toggle, 'less');
});

test('secondLineOnlyWithOtherArtists', () => {
    assert.equal(hasOtherArtists([{ id: 'a' }], 'a'), false);
    assert.equal(hasOtherArtists([], 'a'), false);
    assert.equal(hasOtherArtists([{ id: 'a' }, { id: 'b' }], 'a'), true);
    assert.equal(hasOtherArtists([{ id: 'b' }], 'a'), true);
    // No page artist (a list outside an artist page): any credit is worth a line.
    assert.equal(hasOtherArtists([{ id: 'a' }], undefined), true);
});

// R13 (B-245): the rating and the heart took the play count's place; narrow, the rating goes first.
const both = { favorite: true, rating: true };

test('wideShowsRatingAndHeartBeforeTheDuration', () => {
    assert.deepEqual(trackColumns(900, both), [
        'index',
        'cover',
        'title',
        'rating',
        'favorite',
        'duration',
        'menu',
    ]);
    assert.equal(
        trackColumnTemplate(trackColumns(900, both)),
        '28px 40px minmax(0, 1fr) 84px 32px 52px 32px',
    );
});

test('narrowDropsTheRatingFirstAndKeepsTheHeart', () => {
    assert.deepEqual(trackColumns(TRACK_LIST_NARROW_PX, both), trackColumns(900, both));
    assert.deepEqual(trackColumns(TRACK_LIST_NARROW_PX - 1, both), [
        'index',
        'cover',
        'title',
        'favorite',
        'duration',
        'menu',
    ]);
    assert.deepEqual(
        trackColumns(TRACK_LIST_NARROWER_PX - 1, both),
        trackColumns(TRACK_LIST_NARROW_PX - 1, both),
    );
});

test('aColumnSwitchedOffInSettingsIsNotThere', () => {
    assert.deepEqual(trackColumns(900, { favorite: false, rating: false }), [
        'index',
        'cover',
        'title',
        'duration',
        'menu',
    ]);
    assert.deepEqual(trackColumns(900, { favorite: false, rating: true }), [
        'index',
        'cover',
        'title',
        'rating',
        'duration',
        'menu',
    ]);
});

test('theStylesheetBreaksWhereTheModelDoes', () => {
    const css = readFileSync(
        new URL('./components/artist-track-list.module.css', import.meta.url),
        'utf8',
    );
    assert.match(css, new RegExp(String.raw`@container \(width < ${TRACK_LIST_NARROW_PX}px\)`));
    assert.match(css, new RegExp(String.raw`@container \(width < ${TRACK_LIST_NARROWER_PX}px\)`));
    // The play count's column is gone.
    assert.doesNotMatch(css, /\.plays\b/);
});

/*
 * R13 review M5: a rated row draws its stars as ONE element (a mask of five stars) until it is pointed
 * at or focused, so five rated Popular rows keep the page under R10's node count. The mask has as many
 * filled stars as the rating, the rest outlined, as Mantine's Rating draws them.
 */
test('staticStarsMask: filled up to the rating, the rest outlined, clamped to 0 to 5', () => {
    const svg = (n: number) =>
        decodeURIComponent(staticStarsMask(n).replace(/^url\("data:image\/svg\+xml,|"\)$/g, ''));
    const count = (n: number, fill: string) => svg(n).split(`fill='${fill}'`).length - 1;
    assert.match(staticStarsMask(3), /^url\("data:image\/svg\+xml,.+"\)$/);
    assert.equal(count(3, '#000'), 3);
    assert.equal(count(3, 'none'), 2);
    assert.equal(count(0, '#000'), 0);
    assert.equal(count(7, '#000'), 5);
    assert.equal(count(-1, 'none'), 5);
    assert.equal(svg(2).split('<path').length - 1, 5);
    // Mantine's star (its 24-unit path), five across.
    assert.ok(svg(1).includes("viewBox='0 0 120 24'"));
});

/*
 * B-266: Popular's order and membership hold for one visit and one Everyone / Yours choice; each
 * row's fields (rating, heart, play count) come from the fresh data.
 */

interface Row {
    id: string;
    plays: number;
}
const row = (id: string, plays = 0): Row => ({ id, plays });
const rowId = (r: Row) => r.id;

test('holdOrderKeepsTheHeldOrderWithFreshFields', () => {
    const held = [row('a', 9), row('b', 8), row('c', 7)];
    const fresh = [row('a', 9), row('c', 9), row('b', 8)];
    const out = holdOrder(held, fresh, rowId);
    assert.deepEqual(
        out.map((r) => r.id),
        ['a', 'b', 'c'],
    );
    assert.equal(out[2], fresh[1], 'the row object is the fresh one');
    assert.equal(out[2].plays, 9);
});

test('holdOrderKeepsAMissingRowAsLastKnown', () => {
    const held = [row('a'), row('b'), row('c')];
    const fresh = [row('a'), row('c'), row('d')];
    const out = holdOrder(held, fresh, rowId);
    assert.deepEqual(
        out.map((r) => r.id),
        ['a', 'b', 'c'],
    );
    assert.equal(out[1], held[1]);
});

test('holdOrderWithNothingHeldTakesFresh', () => {
    const fresh = [row('c'), row('a')];
    assert.deepEqual(holdOrder([], fresh, rowId), fresh);
});

test('aVisitHoldsOnceItsFirstFetchSettles', () => {
    const cached = [row('a'), row('b'), row('c')];
    const refetched = [row('a'), row('c'), row('b')];
    // Arrival on cached data while the visit's own fetch runs: what it brings is still taken.
    let held = nextHeldRows(null, { fetching: true, fresh: cached, key: 'x:personal' }, rowId);
    assert.equal(held.settled, false);
    held = nextHeldRows(held, { fetching: false, fresh: refetched, key: 'x:personal' }, rowId);
    assert.deepEqual(
        held.rows.map((r) => r.id),
        ['a', 'c', 'b'],
    );
    assert.equal(held.settled, true);
    // A counted play refetches: the order holds, the fields are fresh.
    const later = [row('b', 5), row('a', 1), row('c', 1)];
    held = nextHeldRows(held, { fetching: true, fresh: held.rows, key: 'x:personal' }, rowId);
    held = nextHeldRows(held, { fetching: false, fresh: later, key: 'x:personal' }, rowId);
    assert.deepEqual(
        held.rows.map((r) => r.id),
        ['a', 'c', 'b'],
    );
    assert.equal(held.rows[2].plays, 5);
});

test('switchingEveryoneAndYoursShowsTheNewOrder', () => {
    let held = nextHeldRows(
        null,
        { fetching: false, fresh: [row('a'), row('b')], key: 'x:personal' },
        rowId,
    );
    held = nextHeldRows(
        held,
        { fetching: false, fresh: [row('b'), row('a')], key: 'x:community' },
        rowId,
    );
    assert.deepEqual(
        held.rows.map((r) => r.id),
        ['b', 'a'],
    );
    assert.equal(held.key, 'x:community');
});

test('aNewVisitShowsTheNewOrder', () => {
    // A new visit starts from nothing held (the page mounts again, Back included).
    const held = nextHeldRows(
        null,
        { fetching: false, fresh: [row('c'), row('a')], key: 'x:personal' },
        rowId,
    );
    assert.deepEqual(
        held.rows.map((r) => r.id),
        ['c', 'a'],
    );
});

test('anEmptyHeldListTakesTheFirstRows', () => {
    // "Yours" empty on arrival, then a play is counted: nothing to jump under, the rows show.
    let held = nextHeldRows(null, { fetching: false, fresh: [], key: 'x:personal' }, rowId);
    held = nextHeldRows(held, { fetching: false, fresh: [row('a')], key: 'x:personal' }, rowId);
    assert.deepEqual(
        held.rows.map((r) => r.id),
        ['a'],
    );
});

/*
 * B-265: a row draws the full Rating while pointed at or focused, and keeps it while a rating save
 * is in flight (the keyboard focus must not drop mid-save); otherwise its stars are one element.
 */

// How the row holds the focus, as the stars care about it.
const NONE = { inStars: false, visible: false };
const KEYBOARD = { inStars: false, visible: true };
const IN_STARS = { inStars: true, visible: false };
// A click focuses the row itself (the `<li>` is the nearest focusable): not from the keyboard,
// not inside the stars.
const CLICKED = { inStars: false, visible: false };

test('starsDrawOnPointerOrFocus', () => {
    assert.equal(nextStarsDrawn({ busy: false, drawn: false, focus: NONE, pointer: true }), true);
    assert.equal(
        nextStarsDrawn({ busy: false, drawn: false, focus: KEYBOARD, pointer: false }),
        true,
    );
    assert.equal(
        nextStarsDrawn({ busy: false, drawn: false, focus: IN_STARS, pointer: false }),
        true,
    );
    assert.equal(nextStarsDrawn({ busy: false, drawn: false, focus: NONE, pointer: false }), false);
});

test('starsReturnToOneElementWhenPointerAndFocusLeave', () => {
    // Pointer left, keyboard focus still in the row: drawn.
    assert.equal(
        nextStarsDrawn({ busy: false, drawn: true, focus: KEYBOARD, pointer: false }),
        true,
    );
    // Focus left, pointer still on it: drawn.
    assert.equal(nextStarsDrawn({ busy: false, drawn: true, focus: NONE, pointer: true }), true);
    // Both left, nothing saving: one element again.
    assert.equal(nextStarsDrawn({ busy: false, drawn: true, focus: NONE, pointer: false }), false);
});

test('aSaveInFlightKeepsADrawnRowDrawn', () => {
    assert.equal(nextStarsDrawn({ busy: true, drawn: true, focus: NONE, pointer: false }), true);
    // A row never drawn does not draw because another row is saving.
    assert.equal(nextStarsDrawn({ busy: true, drawn: false, focus: NONE, pointer: false }), false);
    // The save settles: back to one element.
    assert.equal(nextStarsDrawn({ busy: false, drawn: true, focus: NONE, pointer: false }), false);
});

/*
 * R15 review I3: a mouse click (a star, or the double-click that plays the row) focuses the `<li>`,
 * so a row edited with the mouse kept its full Rating after the pointer left. Focus counts only
 * when reached from the keyboard or inside the stars, where the swap would drop it.
 */
test('aMouseFocusedRowReturnsToOneElement', () => {
    // Rated with the mouse: drawn while pointed at.
    assert.equal(nextStarsDrawn({ busy: false, drawn: true, focus: CLICKED, pointer: true }), true);
    // The pointer leaves, the row keeps the click's focus: one element again.
    assert.equal(
        nextStarsDrawn({ busy: false, drawn: true, focus: CLICKED, pointer: false }),
        false,
    );
    // A star that does hold the focus is kept drawn, however it was reached.
    assert.equal(
        nextStarsDrawn({ busy: false, drawn: true, focus: IN_STARS, pointer: false }),
        true,
    );
    assert.deepEqual(rowFocusOf({ focusVisible: false, inStars: false }), CLICKED);
    assert.deepEqual(rowFocusOf({ focusVisible: true, inStars: false }), KEYBOARD);
    assert.deepEqual(rowFocusOf({ focusVisible: false, inStars: true }), IN_STARS);
});

/*
 * R15 review I4: switching windows (Alt-Tab, another app) blurs the focused star with no related
 * target. That is not a leave: the star is still the page's active element and gets the focus back
 * on return, so the Rating must not unmount under it.
 */
test('aWindowSwitchKeepsTheStarsFocus', () => {
    // The window lost the focus: kept.
    assert.equal(blurKeepsRowFocus({ toInsideRow: false, windowFocused: false }), true);
    // Star to star, star to heart: kept.
    assert.equal(blurKeepsRowFocus({ toInsideRow: true, windowFocused: true }), true);
    // Focus went elsewhere on the page (another row, the page itself): a leave.
    assert.equal(blurKeepsRowFocus({ toInsideRow: false, windowFocused: true }), false);
});
