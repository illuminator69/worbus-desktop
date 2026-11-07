import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    type HeroActionsMode,
    heroActionsMode,
    type HeroActionsWidths,
    naturalRowWidth,
    rememberWidth,
} from './hero-actions-fit.ts';

/**
 * B-284:  node --test src/renderer/features/shared/components/hero-actions.harness.ts
 *
 * The hero's action row (Play, the labelled buttons, then rating, favourite and more) wrapped in a
 * column narrower than the row, leaving the rating group alone on a second line at the right, and the
 * hero's bottom alignment then hung the photo below the title and the buttons. The row now folds the
 * labelled buttons to their icons before it wraps (full, then icons, then stacked), decided from the
 * row's own natural width, measured in the full layout and kept until the row's contents change, so
 * folding can never make the row "fit" and unfold again.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const block = (css: string, start: string) => {
    const at = css.indexOf(start);
    assert.ok(at >= 0, start);
    return css.slice(at, css.indexOf('\n}', at));
};

// The artist page at the owner's size: Play 52, Shuffle 104, Artist radio 128, View all tracks 136,
// the end group 200, gaps of 10. Icons fold each labelled button to 36.
const FULL_ITEMS = [52, 104, 128, 136, 200];
const ICON_ITEMS = [52, 36, 36, 36, 200];
const GAP = 10;
const FULL = naturalRowWidth(FULL_ITEMS, GAP);
const ICONS = naturalRowWidth(ICON_ITEMS, GAP);

test('naturalRowWidth: the items side by side with a gap between each two', () => {
    assert.equal(FULL, 52 + 104 + 128 + 136 + 200 + 4 * GAP);
    assert.equal(ICONS, 52 + 36 * 3 + 200 + 4 * GAP);
    assert.equal(naturalRowWidth([], GAP), 0);
    assert.equal(naturalRowWidth([52], GAP), 52);
});

test('heroActionsCollapseBeforeTheyWrap', () => {
    const known = { full: FULL, icons: ICONS, key: 'k' };
    // The whole row fits, to the pixel: full.
    assert.equal(heroActionsMode(FULL + 200, known), 'full');
    assert.equal(heroActionsMode(FULL, known), 'full');
    // One pixel short of the labelled row: the labels go, not the line.
    assert.equal(heroActionsMode(FULL - 0.5, known), 'icons');
    assert.equal(heroActionsMode(ICONS, known), 'icons');
    // Only when even the icon row does not fit does it wrap.
    assert.equal(heroActionsMode(ICONS - 0.5, known), 'stacked');
    assert.equal(heroActionsMode(120, known), 'stacked');
});

test('aRowNotYetMeasuredStartsFullThenMeasuresTheIcons', () => {
    // Nothing measured: render the full row so it can be measured (before paint).
    assert.equal(heroActionsMode(300, { key: 'k' }), 'full');
    // Full measured and too wide, icons not yet: try icons, which measures them.
    assert.equal(heroActionsMode(300, { full: FULL, key: 'k' }), 'icons');
    assert.equal(heroActionsMode(FULL, { full: FULL, key: 'k' }), 'full');
});

test('rememberWidth: each mode measures its own width; a content change forgets both', () => {
    let widths: HeroActionsWidths = { key: 'a' };
    widths = rememberWidth(widths, 'a', 'full', FULL);
    assert.deepEqual(widths, { full: FULL, key: 'a' });
    widths = rememberWidth(widths, 'a', 'icons', ICONS);
    assert.deepEqual(widths, { full: FULL, icons: ICONS, key: 'a' });
    // A stacked row is the icon row wrapped: its items are the icon row's.
    widths = rememberWidth(widths, 'a', 'stacked', ICONS + 2);
    assert.deepEqual(widths, { full: FULL, icons: ICONS + 2, key: 'a' });
    // The labels changed (a language, a busy radio, the rating appearing): measured again.
    widths = rememberWidth(widths, 'b', 'icons', ICONS);
    assert.deepEqual(widths, { icons: ICONS, key: 'b' });
    // An unchanged measurement returns the same object, so a state update bails out.
    assert.equal(rememberWidth(widths, 'b', 'icons', ICONS), widths);
});

/**
 * The component's loop, as the ResizeObserver drives it: render the mode, measure what that mode
 * shows, decide again, until the decision stands. Returns the mode that stands at that width.
 */
const settle = (available: number, state: { mode: HeroActionsMode; widths: HeroActionsWidths }) => {
    for (let pass = 0; pass < 5; pass += 1) {
        const items = state.mode === 'full' ? FULL_ITEMS : ICON_ITEMS;
        state.widths = rememberWidth(state.widths, 'k', state.mode, naturalRowWidth(items, GAP));
        const next = heroActionsMode(available, state.widths);
        if (next === state.mode) return state.mode;
        state.mode = next;
    }
    assert.fail(`no stable mode at ${available}px`);
};

test('theCollapseDoesNotOscillate', () => {
    const state: { mode: HeroActionsMode; widths: HeroActionsWidths } = {
        mode: 'full',
        widths: { key: 'k' },
    };
    // A slow drag from wide to narrow and back, one pixel at a time.
    const widths: number[] = [];
    for (let w = 900; w >= 200; w -= 1) widths.push(w);
    for (let w = 200; w <= 900; w += 1) widths.push(w);
    const seen: HeroActionsMode[] = [];
    for (const w of widths) {
        const mode = settle(w, state);
        if (seen.at(-1) !== mode) seen.push(mode);
        // At every width the standing mode is the one the measured widths call for.
        assert.equal(mode, w >= FULL ? 'full' : w >= ICONS ? 'icons' : 'stacked', `${w}px`);
    }
    // One change per threshold crossing: down through two thresholds and back up through them.
    assert.deepEqual(seen, ['full', 'icons', 'stacked', 'icons', 'full']);
});

test('collapsedButtonsKeepTheirNames', () => {
    const source = read('./hero-actions.tsx');
    // Folded, a button's label is its accessible name and the app's Tooltip.
    assert.match(source, /aria-label=\{folded \? action\.label : undefined\}/);
    assert.match(source, /<Tooltip[\s\S]*?disabled=\{!folded\}[\s\S]*?label=\{action\.label\}/);
    assert.match(source, /import \{ Tooltip \} from '\/@\/shared\/components\/tooltip\/tooltip'/);
    // The label stays in the markup, hidden by the mode, so the full row is what is measured.
    assert.match(source, /<span className=\{styles\.label\}>\{action\.label\}<\/span>/);
    const css = read('./hero-actions.module.css');
    assert.match(css, /\.row\[data-mode='full'\]|\.row:not\(\[data-mode='full'\]\) \.label/);
});

test('everyLabelledHeroButtonHasAnIcon', () => {
    // A button with no icon would fold to an empty square.
    for (const path of [
        '../../artists/components/album-artist-detail-header.tsx',
        '../../albums/components/album-detail-header.tsx',
    ]) {
        const source = read(path);
        const actions = source.slice(source.indexOf('<HeroActions'));
        const list = actions.slice(actions.indexOf('actions={['), actions.indexOf(']}'));
        const entries = list.split(/\n\s{16,24}\{\n/).slice(1);
        assert.ok(entries.length >= 3, path);
        for (const entry of entries)
            assert.match(entry, /\bicon: '[a-zA-Z]+'/, `${path}: ${entry}`);
    }
    const artist = read('../../artists/components/album-artist-detail-header.tsx');
    // "A list of tracks" (R18 ruling M-7): LuListMusic, not the single note of a song.
    assert.match(artist, /icon: 'playlist',\s+key: 'tracks'/);
    const album = read('../../albums/components/album-detail-header.tsx');
    assert.match(album, /icon: 'mediaPlayNext',\s+key: 'next'/);
    assert.match(album, /icon: 'mediaPlayLast',\s+key: 'queue'/);
});

test('aStackedRowStartsItsEndGroupAtTheLeft', () => {
    const css = read('./hero-actions.module.css');
    // Full and icons keep the end group pushed right; stacked lets it start its own line at the left.
    assert.match(block(css, '\n.end {'), /margin-left: auto;/);
    assert.match(css, /\.row\[data-mode='stacked'\] \.end \{\s+margin-left: 0;/);
    // A folded button is a 36 px square, the row's own height.
    assert.match(
        css,
        /\.row:not\(\[data-mode='full'\]\) \.button \{[^}]*width: 36px;[^}]*padding: 0;/,
    );
});

test('theDecisionComesFromAMeasurementNotAThreshold', () => {
    const source = read('./hero-actions.tsx');
    assert.match(source, /new ResizeObserver/);
    assert.match(source, /heroActionsMode\(/);
    assert.match(source, /rememberWidth\(/);
    assert.match(source, /data-mode=\{mode\}/);
    // No guessed breakpoints in the row's CSS.
    assert.doesNotMatch(read('./hero-actions.module.css'), /@container|@media \(max-width/);
});

/*
 * The checks below read source text (grep-only): they pin a spelling, not a behaviour; the walk
 * shows the behaviour (console errors per crossing, labels after a late font).
 */

test('aFoldNeverChangesTheRowsHeight (grep-only)', () => {
    // The full row never wraps (it is measured, then folded, before paint): folding inside the
    // ResizeObserver callback then leaves the row's height alone, which is what keeps Chromium's
    // "ResizeObserver loop" error away. Only a folded row wraps, and it does so in layout, not in
    // the callback (R18 review M-2).
    const css = read('./hero-actions.module.css');
    assert.match(block(css, '\n.row {'), /flex-wrap: nowrap;/);
    assert.match(css, /\.row:not\(\[data-mode='full'\]\) \{\s+flex-wrap: wrap;/);
});

test('aLateFontMeasuresBothModesAgain (grep-only)', () => {
    // A web font arriving after the first measure changes the labels' width even while they are
    // hidden (icons): both widths are forgotten, so the labels come back when there is room (M-3).
    const source = read('./hero-actions.tsx');
    assert.match(source, /document\.fonts/);
    assert.match(source, /addEventListener\('loadingdone'/);
    assert.match(source, /removeEventListener\('loadingdone'/);
    assert.match(source, /const contentKey = JSON\.stringify\(\[[\s\S]*?fontsLoaded,[\s\S]*?\]\);/);
});

test('theRowIsMeasuredOnResizeNotEveryRender (grep-only)', () => {
    // A parent re-rendering (the player's progress) must not force a layout read (M-11).
    const lines = read('./hero-actions.tsx').split('\n');
    lines.forEach((line, at) => {
        const open = line.match(/^(\s*)use(?:Layout)?Effect\(\(\) => \{$/);
        if (!open) return;
        const close = lines.slice(at + 1).find((l) => l.startsWith(`${open[1]}}`));
        assert.ok(
            close?.startsWith(`${open[1]}}, [`),
            `hero-actions.tsx:${at + 1} runs every render`,
        );
    });
});
