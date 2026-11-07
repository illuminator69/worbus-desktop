import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    pinnedRowBox,
    pinnedRowTops,
    SHELL_PINNED_TOP_VARS,
    shellPinnedTop,
} from './utils/shell-pinned-top.ts';

/**
 * R3 Task 3 (L5-01):  node --test src/renderer/components/item-list/item-table-list/sticky-offset.harness.ts
 *
 * The pinned table header and the pinned disc row sat at 65 / 95 px, with in-view margins of
 * -100 / -130 px: the geometry from before F3, when the page's title row was the first thing under
 * the window bar. The shell now has a top bar as well, so they must be read from the shell's own
 * variables (`--window-bar-height`, `--top-bar-height`, `--page-header-height`), never written out.
 */

const here = new URL('./', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, here), 'utf8');

const FILES = [
    'hooks/use-sticky-table-header.tsx',
    'hooks/use-sticky-table-group-rows.tsx',
    'item-table-list.module.css',
];

test('the pinned header and disc row take their top from the shell, not from literals', () => {
    for (const file of FILES) {
        const source = read(file);
        for (const literal of ['65px', '95px', '-100px', '-130px']) {
            assert.ok(!source.includes(literal), `${file} carries ${literal}`);
        }
        if (file.endsWith('.tsx')) {
            // The numeric form the hooks used (`? 95 : 65`).
            assert.ok(!/\b(?:65|95|100|130)\b/.test(source), `${file} carries a pre-F3 offset`);
            assert.ok(source.includes('useShellPinnedTop'), `${file} does not read the shell`);
        }
    }
    const helper = read('utils/shell-pinned-top.ts');
    for (const name of ['--window-bar-height', '--top-bar-height', '--page-header-height']) {
        assert.ok(helper.includes(name), `the helper does not read ${name}`);
    }
});

test('both layouts define the three heights the pin reads', () => {
    // At a window width of 768 px or less the responsive layout swaps in MobileLayout; a variable it
    // leaves unset reads as 0, and the pinned header lands at the window's top behind the title row.
    const layouts = {
        default: '../../../layouts/default-layout.module.css',
        mobile: '../../../layouts/mobile-layout/mobile-layout.module.css',
    };
    for (const [name, path] of Object.entries(layouts)) {
        const css = read(path);
        for (const variable of SHELL_PINNED_TOP_VARS) {
            assert.ok(
                new RegExp(`\\.layout\\s*\\{[^}]*${variable}\\s*:`).test(css),
                `the ${name} layout's .layout does not define ${variable}`,
            );
        }
        assert.ok(
            /\.windows,\s*\.macos\s*\{[^}]*--window-bar-height\s*:\s*30px/.test(css),
            `the ${name} layout does not set --window-bar-height under the Windows / macOS bars`,
        );
    }
});

test('the pinned top is the window bar, the top bar and the title row', () => {
    const style = (vars: Record<string, string>) => ({
        getPropertyValue: (name: string) => vars[name] ?? '',
    });
    const linux = {
        '--page-header-height': '65px',
        '--top-bar-height': '52px',
        '--window-bar-height': '0px',
    };
    assert.equal(shellPinnedTop(style(linux)), 117);
    assert.equal(shellPinnedTop(style({ ...linux, '--window-bar-height': ' 30px' })), 147);
    assert.equal(shellPinnedTop(style({ ...linux, '--top-bar-height': '0px' })), 65);
    assert.equal(shellPinnedTop(style({})), 0);
});

/**
 * Sticky headers, Task 3 (B-221): the pinned header and disc row are `position: fixed`, but the page's
 * arrival animation left a transform on `<main>` (its `both` fill; `backwards` since), which made
 * `<main>` their containing block. Their tops and left were viewport px, so on the VM they landed 82 px
 * under the bar and 248 px to the right (the panel's offset), with rows readable between and the right
 * end cut by the panel. The rule: the tops are viewport lines (the bar's bottom, then the header's
 * bottom), written relative to whatever block the rows are fixed to, and the box spans the table's own
 * left and right edges.
 */

const BAR_BOTTOM = 147; // the VM's Windows-style bar: 30 + 52 + 65
const HEADER = 40; // the table's header row; the pinned header adds a 1 px border

test('oneDiscPinsTheHeaderUnderTheBar', () => {
    const tops = pinnedRowTops({ headerHeight: HEADER, headerShown: true, pinLine: BAR_BOTTOM });
    assert.equal(tops.header, 147);
});

test('twoDiscsPinTheDiscRowDirectlyUnderTheHeader', () => {
    const tops = pinnedRowTops({ headerHeight: HEADER, headerShown: true, pinLine: BAR_BOTTOM });
    // The VM with reduced motion (no containing block): header 147..188, Disc 1 from 188.
    assert.equal(tops.group, 188);
});

test('theDiscRowTakesTheBarLineWhenTheHeaderIsNotPinned', () => {
    const tops = pinnedRowTops({ headerHeight: HEADER, headerShown: false, pinLine: BAR_BOTTOM });
    assert.equal(tops.group, 147);
});

test('aTransformedPageIsSubtracted', () => {
    // `<main>` at (248, 82) is the containing block: the row is written at (28, 65) inside it, which
    // is (276, 147) on screen, the table's left edge and the bar's bottom.
    const box = pinnedRowBox({
        blockOrigin: { x: 248, y: 82 },
        table: { left: 276, width: 1076 },
        top: BAR_BOTTOM,
    });
    assert.deepEqual(box, { left: 28, top: 65, width: 1076 });
});

test('theViewportAsBlockChangesNothing', () => {
    const box = pinnedRowBox({
        blockOrigin: { x: 0, y: 0 },
        table: { left: 276, width: 1076 },
        top: BAR_BOTTOM,
    });
    assert.deepEqual(box, { left: 276, top: 147, width: 1076 });
});

test('theQueueOpenChangesNothingVertical', () => {
    const origin = { x: 248, y: 82 };
    const closed = pinnedRowBox({
        blockOrigin: origin,
        table: { left: 276, width: 1076 },
        top: 188,
    });
    const open = pinnedRowBox({ blockOrigin: origin, table: { left: 276, width: 760 }, top: 188 });
    assert.equal(open.top, closed.top);
    assert.equal(open.width, 760);
});

test('theRowsAreNotPlacedFromTheRender', () => {
    // The hooks own top, left and width (they know the containing block); a `top` in the JSX would be
    // written in viewport px by React on the next render and put the rows back where they were.
    const source = read('item-table-list.tsx');
    for (const cls of ['styles.stickyHeader}', 'styles.stickyGroupRow}']) {
        const at = source.indexOf(`className={${cls}`);
        assert.ok(at > 0, `${cls} not found`);
        const tag = source.slice(at, source.indexOf('>', at));
        assert.ok(!/\btop:/.test(tag), `${cls} still sets top in the render`);
    }
});

/**
 * The fix agent's round (review M-2, M-3): B-221 at its cause, and the first frame of a pinned row.
 * The page arrival must not hold its last frame: a held transform, even an identity one, keeps
 * `<main>` the containing block of every fixed row for the page's life. And the rows are placed in a
 * layout effect, so a newly pinned row never paints a frame at its static spot.
 */

test('arrivalHoldsNoTransformAfterItEnds', () => {
    const css = read('../../../features/shared/components/animated-page.module.css');
    const arrivals = [...css.matchAll(/animation\s*:([^;]*);/g)].map((m) => m[1]);
    assert.ok(arrivals.length >= 4, 'the arrival rules');
    for (const value of arrivals.flatMap((a) => a.split(','))) {
        assert.ok(/\bpage-[a-z-]+\b/.test(value), value);
        assert.ok(/\bbackwards\s*$/.test(value.trim()), value);
        assert.ok(!/\b(both|forwards)\b/.test(value), value);
    }
});

test('pinnedRowsArePlacedBeforePaint', () => {
    const hook = read('hooks/use-pinned-row-placement.ts');
    assert.match(hook, /useLayoutEffect\(/);
    assert.doesNotMatch(hook, /\buseEffect\(/);
    for (const file of [
        'hooks/use-sticky-header-positioning.ts',
        'hooks/use-sticky-group-row-positioning.ts',
    ]) {
        assert.match(read(file), /usePinnedRowPlacement\(/, file);
    }
});
