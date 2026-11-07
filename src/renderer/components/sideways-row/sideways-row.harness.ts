import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    hiddenSides,
    LINE_PX,
    scrollStep,
    type SidewaysMetrics,
    sidewaysWheelTarget,
    type WheelInput,
} from './sideways-scroll.ts';

/**
 * B-285:  node --test src/renderer/components/sideways-row/sideways-row.harness.ts
 *
 * The Library's chip row scrolled sideways with no scrollbar and no wheel handling, so a mouse
 * wheel reached nothing past the right edge, and a fixed mask faded the right edge whether or not
 * anything was hidden there. Four rows had the pattern (the Library chips, Home's mood chips, the
 * side queue's station chips, the artist page's discography chips). One mechanism now serves all
 * four: edge fades and scroll buttons only on a side with hidden content, and, on a row in fixed
 * chrome, a vertical wheel turned sideways until the row reaches that end.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// A row 400 px wide holding 1000 px of chips.
const row = (scrollLeft: number, patch: Partial<SidewaysMetrics> = {}): SidewaysMetrics => ({
    clientWidth: 400,
    scrollLeft,
    scrollWidth: 1000,
    ...patch,
});

const wheel = (patch: Partial<WheelInput> = {}): WheelInput => ({
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 100,
    metaKey: false,
    shiftKey: false,
    ...patch,
});

test('aVerticalWheelScrollsTheRowSideways', () => {
    assert.equal(sidewaysWheelTarget(row(0), wheel(), 'chrome'), 100);
    assert.equal(sidewaysWheelTarget(row(300), wheel({ deltaY: -100 }), 'chrome'), 200);
    // A notch while the last one is still gliding adds to where that one is going.
    assert.equal(sidewaysWheelTarget(row(120), wheel(), 'chrome', 200), 300);
    // Clamped to the row's ends.
    assert.equal(sidewaysWheelTarget(row(550), wheel(), 'chrome'), 600);
    assert.equal(sidewaysWheelTarget(row(40), wheel({ deltaY: -100 }), 'chrome'), 0);
});

test('theWheelPassesToThePageAtAnEnd', () => {
    // At the end, a further wheel the same way is the page's; the other way is still the row's.
    assert.equal(sidewaysWheelTarget(row(600), wheel(), 'chrome'), null);
    assert.equal(sidewaysWheelTarget(row(600), wheel({ deltaY: -100 }), 'chrome'), 500);
    assert.equal(sidewaysWheelTarget(row(0), wheel({ deltaY: -100 }), 'chrome'), null);
    // Fractional scroll positions (a 1.2 scale) count as the end within a pixel.
    assert.equal(sidewaysWheelTarget(row(599.4), wheel(), 'chrome'), null);
    // A glide already heading to the end counts as there.
    assert.equal(sidewaysWheelTarget(row(500), wheel(), 'chrome', 600), null);
    // A row that fits never takes the wheel.
    assert.equal(sidewaysWheelTarget(row(0, { scrollWidth: 400 }), wheel(), 'chrome'), null);
});

test('aRowInsideAScrollingPageDoesNotTrapTheWheel', () => {
    assert.equal(sidewaysWheelTarget(row(0), wheel(), 'page'), null);
    assert.equal(sidewaysWheelTarget(row(300), wheel({ deltaY: -100 }), 'page'), null);
});

test('aTouchpadSidewaysSwipeAndShiftWheelAreTheBrowsers', () => {
    // A mainly sideways delta is a touchpad swipe (or a tilt wheel): the browser scrolls it.
    assert.equal(sidewaysWheelTarget(row(0), wheel({ deltaX: 30, deltaY: 4 }), 'chrome'), null);
    assert.equal(sidewaysWheelTarget(row(0), wheel({ deltaX: 30, deltaY: 30 }), 'chrome'), null);
    // Chromium already turns Shift+wheel sideways, on every row.
    assert.equal(sidewaysWheelTarget(row(0), wheel({ shiftKey: true }), 'chrome'), null);
    assert.equal(sidewaysWheelTarget(row(0), wheel({ shiftKey: true }), 'page'), null);
    // A mainly vertical swipe with a little sideways drift is still a vertical wheel.
    assert.equal(sidewaysWheelTarget(row(0), wheel({ deltaX: 3, deltaY: 40 }), 'chrome'), 40);
});

test('aCtrlOrMetaWheelIsTheBrowsersZoom', () => {
    // A Ctrl+wheel and a touchpad pinch (which arrives as a Ctrl+wheel) zoom; never the row's.
    assert.equal(sidewaysWheelTarget(row(0), wheel({ ctrlKey: true }), 'chrome'), null);
    assert.equal(
        sidewaysWheelTarget(row(300), wheel({ ctrlKey: true, deltaY: -3 }), 'chrome'),
        null,
    );
    assert.equal(sidewaysWheelTarget(row(0), wheel({ metaKey: true }), 'chrome'), null);
});

test('linesAndPagesAreConvertedToPixels', () => {
    assert.equal(
        sidewaysWheelTarget(row(0), wheel({ deltaMode: 1, deltaY: 3 }), 'chrome'),
        3 * LINE_PX,
    );
    // A page is the row's visible width.
    assert.equal(sidewaysWheelTarget(row(0), wheel({ deltaMode: 2, deltaY: 1 }), 'chrome'), 400);
});

test('fadesOnlyOnSidesWithHiddenContent', () => {
    assert.deepEqual(hiddenSides(row(0)), { end: true, start: false });
    assert.deepEqual(hiddenSides(row(250)), { end: true, start: true });
    assert.deepEqual(hiddenSides(row(600)), { end: false, start: true });
    assert.deepEqual(hiddenSides(row(599.5)), { end: false, start: true });
    assert.deepEqual(hiddenSides(row(0.4)), { end: true, start: false });
    // A row that fits shows neither.
    assert.deepEqual(hiddenSides(row(0, { scrollWidth: 400 })), { end: false, start: false });
    assert.deepEqual(hiddenSides(row(0, { scrollWidth: 400.6 })), { end: false, start: false });
});

test('aButtonScrollsByMostOfTheVisibleWidth', () => {
    assert.equal(scrollStep(row(0), 1), 320);
    assert.equal(scrollStep(row(320), 1), 600);
    assert.equal(scrollStep(row(600), -1), 280);
    assert.equal(scrollStep(row(100), -1), 0);
    // Pressed again mid-glide: from where the glide is going.
    assert.equal(scrollStep(row(100), 1, 320), 600);
});

const ROWS = [
    {
        css: '../../features/library/components/library-chips.module.css',
        rule: '\n.row {',
        tsx: '../../features/library/components/library-chips.tsx',
        wheel: 'chrome',
    },
    {
        css: '../../features/player/station/queue-station-chips.module.css',
        rule: '\n.row {',
        tsx: '../../features/player/station/queue-station-chips.tsx',
        wheel: 'chrome',
    },
    {
        css: '../../features/moods/components/mood-chips.module.css',
        rule: '\n.row {',
        tsx: '../../features/moods/components/mood-chips.tsx',
        wheel: 'page',
    },
    {
        css: '../../features/artists/components/artist-shelves.module.css',
        rule: '\n.chips {',
        tsx: '../../features/artists/components/artist-shelves.tsx',
        wheel: 'page',
    },
];

const block = (css: string, start: string) => {
    const at = css.indexOf(start);
    assert.ok(at >= 0, start);
    return css.slice(at, css.indexOf('\n}', at));
};

test('everySidewaysRowUsesTheOneMechanism', () => {
    for (const { css, rule, tsx, wheel: mode } of ROWS) {
        const source = read(tsx);
        assert.match(source, /<SidewaysRow\b/, tsx);
        assert.match(source, new RegExp(`wheel="${mode}"`), `${tsx} wheel=${mode}`);
        // No row keeps its own fixed or timeline-driven fade.
        const style = read(css);
        const own = block(style, rule);
        assert.doesNotMatch(own, /\bmask/, css);
        assert.doesNotMatch(style, /animation-timeline|@keyframes chips-fade/, css);
    }
});

test('theRowsMechanism', () => {
    const source = read('./sideways-row.tsx');
    // The wheel is taken only on a chrome row, and only through a listener that may cancel it.
    assert.match(source, /addEventListener\('wheel', [a-zA-Z]+, \{ passive: false \}\)/);
    assert.match(source, /wheel !== 'chrome'/);
    assert.match(source, /sidewaysWheelTarget\(/);
    assert.match(source, /preventDefault\(\)/);
    // Fades and buttons follow the scroll position, the row's size and its contents' size.
    assert.match(source, /hiddenSides\(/);
    assert.match(source, /addEventListener\('scroll'/);
    assert.match(source, /new ResizeObserver/);
    // Glides, unless the user asked for less motion.
    assert.match(source, /prefers-reduced-motion: reduce/);
    assert.match(source, /\? 'auto' : 'smooth'/);
    assert.match(source, /scrollTo\(\{ behavior: how, left \}\)/);
    // Named buttons, out of the tree only on a side with nothing hidden.
    assert.match(source, /aria-label=\{t\('action\.scrollLeft'\)\}/);
    assert.match(source, /aria-label=\{t\('action\.scrollRight'\)\}/);
    assert.match(source, /inert=\{!sides\.start\}/);
    assert.match(source, /inert=\{!sides\.end\}/);
    const en = read('../../../i18n/locales/en.json');
    assert.match(en, /"scrollLeft": "/);
    assert.match(en, /"scrollRight": "/);

    const css = read('./sideways-row.module.css');
    // The fade is a transition, and a hidden button takes no clicks.
    assert.match(css, /@property --sideways-fade-start/);
    assert.match(css, /transition:[^;]*--sideways-fade-start/);
    assert.match(block(css, '\n.frame > .button {'), /pointer-events: none;/);
    assert.match(block(css, '\n.frame > .button {'), /opacity: 0;/);
    assert.match(css, /\.frame:hover > \.button/);
    assert.match(css, /prefers-reduced-motion: reduce/);
});

/*
 * The checks below read source text (grep-only): they pin a spelling, not a behaviour, and the
 * walk is what shows the behaviour.
 */

test('theButtonsShowOnHoverAndOnKeyboardFocusOnly (grep-only)', () => {
    // A mouse click on a chip leaves focus in the row; that must not hold the buttons up.
    const css = read('./sideways-row.module.css');
    assert.doesNotMatch(css, /:focus-within/);
    assert.match(css, /\.frame:has\(:focus-visible\) > \.button:not\(\[inert\]\)/);
});

// `top right bottom left` from a CSS `padding` / `margin` shorthand, in px.
const box = (value: string | undefined): [number, number, number, number] => {
    const parts = (value ?? '0')
        .trim()
        .split(/\s+/)
        .map((part) => parseFloat(part) || 0);
    const [top, right = top, bottom = top, left = right] = parts;
    return [top, right, bottom, left];
};

const declaration = (rule: string, property: string) =>
    rule.match(new RegExp(`\\n\\s+${property}: ([^;]+);`))?.[1];

test('theButtonsSitOnTheChipsCentre (computed from each row CSS)', () => {
    // The buttons are centred on the frame, which is the scroller's margin box: the chips' centre
    // is the frame's when what sits above the chips equals what sits below them.
    for (const { css, rule } of ROWS) {
        const own = block(read(css), rule);
        const [padTop, , padBottom] = box(declaration(own, 'padding'));
        const [marginTop, , marginBottom] = box(declaration(own, 'margin'));
        assert.equal(padTop + marginTop, padBottom + marginBottom, `${css}: above vs below`);
    }
});

test('theLibraryHeadRuleReachesTheFrame (grep-only)', () => {
    // A short window lays the Library head out as a row: the chips' element is pushed to grow by
    // `.head > [data-library-chips]`, which only matches the head's direct child, i.e. the
    // SidewaysRow frame, not the scroller inside it (I-1, R18 review).
    const frame = read('../../features/library/components/library-frame.module.css');
    assert.match(frame, /\.head > \[data-library-chips\] \{/);
    const chips = read('../../features/library/components/library-chips.tsx');
    assert.match(chips, /frameProps=\{\{ 'data-library-chips': true \}\}/);
    assert.doesNotMatch(chips, /\n\s+data-library-chips\n/);
    const source = read('./sideways-row.tsx');
    assert.match(source, /return \(\s+<div\s+\{\.\.\.frameProps\}/);
});

/** Each `useEffect` / `useLayoutEffect` closes with a dependency list: none runs every render. */
const everyEffectHasDeps = (source: string, path: string) => {
    const lines = source.split('\n');
    lines.forEach((line, at) => {
        const open = line.match(/^(\s*)use(?:Layout)?Effect\(\(\) => \{$/);
        if (!open) return;
        const close = lines.slice(at + 1).find((l) => l.startsWith(`${open[1]}}`));
        assert.ok(close?.startsWith(`${open[1]}}, [`), `${path}:${at + 1} runs every render`);
    });
};

test('layoutIsReadOnResizeScrollAndMutationNotEveryRender (grep-only)', () => {
    const source = read('./sideways-row.tsx');
    everyEffectHasDeps(source, 'sideways-row.tsx');
    // Chips come and go: new ones observed, removed ones let go.
    assert.match(source, /new MutationObserver/);
    assert.match(source, /\.unobserve\(/);
});
