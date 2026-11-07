import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import * as fit from './utils/fit-column-widths.ts';
import * as fullText from './utils/full-text-when-cut.ts';

/**
 * B-271:  node --test src/renderer/components/item-list/item-table-list/number-cells-at-the-floor.harness.ts
 *
 * R16 (B-267) gave the shared text container one line with an ellipsis, inside the cell's content
 * box. Text cells were its target; number cells were not: at a column's 40 px floor the content box
 * is 23 px, so "0:03", "2026" and "320 kbps" read "0:...", "2..." and "3...". Before R16 a number's
 * box kept its min-content width and ran into the cell's padding, so it read whole. Number cells
 * (the columns that keep their floor in the shrink band, `keepsItsFloor`, except the row index:
 * R16 M2) render by the base's rule again, and stop at the cell's own border; text cells keep R16's.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const block = (css: string, start: string) => {
    const at = css.indexOf(start);
    assert.ok(at >= 0, start);
    return css.slice(at, css.indexOf('\n}', at));
};

const CSS = './item-table-list-column.module.css';

// The base's (`df91334b`) `.content` rule, the shared container's before R16.
const BASE_RULE = [
    'position: relative;',
    'z-index: 2;',
    'display: -webkit-box;',
    'overflow: hidden;',
    'text-overflow: ellipsis;',
    '-webkit-line-clamp: 2;',
    'line-clamp: 2;',
    '-webkit-box-orient: vertical;',
];

const ONE_LINE = [
    'min-width: 0;',
    'max-width: 100%;',
    'white-space: nowrap;',
    '--text-text-wrap: nowrap;',
];

const container = () => {
    const source = read('./item-table-list-column.tsx');
    return source.slice(
        source.indexOf('export const TableColumnTextContainer'),
        source.indexOf('export const TableColumnContainer'),
    );
};

test('numberCellsKeepTheBaseRule', () => {
    const css = read(CSS);
    const rule = block(css, '\n.number-content {');
    for (const declaration of BASE_RULE) assert.ok(rule.includes(declaration), declaration);
    for (const declaration of ONE_LINE) assert.ok(!rule.includes(declaration), declaration);
    // The base's line clamp by row size: one line compact, three large.
    assert.match(
        block(css, '.number-content.compact {'),
        /-webkit-line-clamp: 1;\s+line-clamp: 1;/,
    );
    assert.match(block(css, '.number-content.large {'), /-webkit-line-clamp: 3;\s+line-clamp: 3;/);

    const source = container();
    assert.match(source, /isNumber \? styles\.numberContent : styles\.content/);
    assert.match(source, /\[styles\.compact\]: isNumber && props\.size === 'compact'/);
    assert.match(source, /\[styles\.large\]: isNumber && props\.size === 'large'/);
});

test('numberCellsStopAtTheirOwnBorder', () => {
    // The base let a number wider than its cell ("1:02:03", 46 px; "12,345", 41 px in a 40 px
    // column) draw over the next cell. Clipped across only, as the rating cell: a drop line above
    // or below the row still shows.
    const rule = block(read(CSS), '\n.number-cell {');
    assert.match(rule, /overflow-x: clip;/);
    assert.doesNotMatch(rule, /overflow: |overflow-y:/);
    assert.match(container(), /\[styles\.numberCell\]: isNumber,/);
});

test('textCellsStayOneLine', () => {
    const rule = block(read(CSS), '\n.content {');
    for (const declaration of ONE_LINE) assert.ok(rule.includes(declaration), declaration);
    assert.ok(!/line-clamp/.test(rule), 'the text rule clamps to lines');
    assert.ok(!/\n\.content\.(compact|large) \{/.test(read(CSS)), 'a text cell clamps by size');
});

/*
 * One list: the number cells are `KEEPS_ITS_FLOOR_IDS` (fit-column-widths.ts), read through
 * `keepsItsFloor`, so a numeric column added to the floor list renders as a number, and one left
 * out of it gives in the band and renders as text, together.
 */

const ENUM = (() => {
    const types = read('../../../../shared/types/types.ts');
    const start = types.indexOf('export enum TableColumn {');
    const body = types.slice(start, types.indexOf('\n}', start));
    return new Map([...body.matchAll(/(\w+) = '([^']+)'/g)].map((m) => [m[1], m[2]]));
})();

// The cell component each column id renders through, from the registry's non-folder switch.
const CELL_OF = (() => {
    const source = read('./item-table-list-column.tsx');
    const at = source.indexOf('if (itemType !== LibraryItem.FOLDER) {');
    const body = source.slice(at, source.indexOf('\n    switch (type) {', at));
    const cells = new Map<string, string>();
    let pending: string[] = [];
    for (const line of body.split('\n')) {
        const id = /case TableColumn\.(\w+):/.exec(line)?.[1];
        if (id) pending.push(ENUM.get(id) ?? id);
        const cell = /<(\w+Column)\b/.exec(line)?.[1];
        if (cell && pending.length > 0) {
            pending.forEach((key) => cells.set(key, cell));
            pending = [];
        }
    }
    const fallback = /default:\s*return <(\w+Column)/.exec(body)?.[1];
    assert.ok(fallback, 'the registry default');
    for (const id of ENUM.values()) if (!cells.has(id)) cells.set(id, fallback);
    return cells;
})();

const COLUMN_FILES = readdirSync(new URL('./columns/', import.meta.url))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => read(`./columns/${name}`));

// Whether a cell component renders through the shared text container, itself or one level down
// (Track number renders the numeric cell or the row play control cell).
const usesTheTextContainer = (cell: string): boolean => {
    const file = COLUMN_FILES.find((source) => new RegExp(`export const ${cell}\\b`).test(source));
    if (!file) return false;
    if (/<TableColumnTextContainer\b/.test(file)) return true;
    return [...file.matchAll(/item-table-list\/columns\/([a-z-]+)'/g)].some(([, name]) =>
        /<TableColumnTextContainer\b/.test(read(`./columns/${name}.tsx`)),
    );
};

test('numberCellsAndTheFloorListAgree', () => {
    assert.equal(typeof fit.keepsItsFloor, 'function', 'keepsItsFloor is exported');
    const source = container();
    assert.match(
        source,
        /const isNumber = props\.type !== TableColumn\.ROW_INDEX && keepsItsFloor\(props\.type\);/,
    );
    assert.match(
        read('./item-table-list-column.tsx'),
        /import \{ keepsItsFloor \} from '\/@\/renderer\/components\/item-list\/item-table-list\/utils\/fit-column-widths';/,
    );

    const numberCells = [...CELL_OF]
        .filter(([id, cell]) => usesTheTextContainer(cell) && id !== 'rowIndex')
        .filter(([id]) => fit.keepsItsFloor(id))
        .map(([id]) => id)
        .sort();
    // The owner's list (Duration, Year, Release year, Bitrate, Play count, Size, Date added, Last
    // played, Track number, Disc number, BPM, the counts), the dates and the other numbers.
    assert.deepEqual(numberCells, [
        'albumCount',
        'bitDepth',
        'bitRate',
        'bpm',
        'channels',
        'container',
        'createdAt',
        'date',
        'discNumber',
        'duration',
        'lastPlayedAt',
        'playCount',
        'releaseDate',
        'releaseYear',
        'sampleRate',
        'size',
        'songCount',
        'trackNumber',
        'year',
    ]);

    // The reverse: every text-container column outside the floor list is a text cell.
    const textCells = [...CELL_OF]
        .filter(([id, cell]) => usesTheTextContainer(cell) && !fit.keepsItsFloor(id))
        .map(([id]) => id);
    for (const id of ['biography', 'comment', 'path', 'username', 'id']) {
        assert.ok(textCells.includes(id), id);
    }
    for (const id of ['name', 'album', 'artists', 'albumArtists', 'composer', 'genres']) {
        assert.ok(!fit.keepsItsFloor(id), id);
    }
});

/*
 * R16's tooltip rule: a number still cut after using its padding gets its full text. It ends in an
 * ellipsis inside its own box (below), so the box measure shows it; `runsPastItsCell` stays as the
 * guard for a box that would still run past the cell, measured with rects (R17 review M-2: the
 * box's offsets are from its offsetParent, and they leave out the shift that keeps it inside).
 */

test('aNumberPastItsCellShowsItsFullText', () => {
    assert.equal(typeof fullText.runsPastItsCell, 'function', 'runsPastItsCell is exported');
    const past = fullText.runsPastItsCell;
    // A padding box from x = 100, 39 px wide.
    assert.equal(past({ left: 96, right: 142 }, 100, 39), true);
    assert.equal(past({ left: 108, right: 149 }, 100, 39), true);
    assert.equal(past({ left: 105, right: 134 }, 100, 39), false);
    assert.equal(past({ left: 100, right: 139 }, 100, 39), false);
    // Under half a px is rounding, not a cut.
    assert.equal(past({ left: 99.6, right: 139.4 }, 100, 39), false);
    const source = container();
    assert.match(source, /runsPastItsCell\(\s*content\.getBoundingClientRect\(\),/);
    assert.match(
        source,
        /cell\.getBoundingClientRect\(\)\.left \+ cell\.clientLeft,\s+cell\.clientWidth,/,
    );
    assert.doesNotMatch(source, /offsetLeft/);
});

/*
 * R17 review I-1 and I-2, one mechanism. A number cell is a size container whose padding is named
 * by `--number-cell-padding`. Its box may be as wide as the cell's padding box; a number wider than
 * that ends in an ellipsis inside it, the start readable. A start or end aligned box that does not
 * fit on its aligned side shifts into the other side's padding, by exactly what it lacks: the
 * shift is 0 for a number that fits its side, so it keeps its alignment. No guessed threshold: the
 * only edge is the cell's own padding box (`100cqw` is the content box, plus the padding).
 */

const rules = (css: string, selector: string) => block(css, `\n${selector} {`);

test('aNumberWiderThanItsCellEndsInAnEllipsisInsideIt', () => {
    const css = read(CSS);
    assert.match(rules(css, '.number-cell'), /container-type: inline-size;/);
    assert.match(
        rules(css, '.number-cell > .number-content'),
        /max-width: calc\(100% \+ 2 \* var\(--number-cell-padding\)\);/,
    );
    // The base rule's own ellipsis does the cutting, at the box's edge.
    const base = rules(css, '.number-content');
    assert.match(base, /overflow: hidden;/);
    assert.match(base, /text-overflow: ellipsis;/);
});

test('aNumberUsesTheOtherSidesPaddingBeforeItIsCut', () => {
    const css = read(CSS);
    // The table's data cells reach their start alignment as the module's `left` class.
    assert.match(
        container(),
        /\[styles\.left\]: props\.columns\[props\.columnIndex\]\.align === 'start',/,
    );
    const start = rules(css, '.number-cell.left > .number-content');
    assert.match(start, /align-self: flex-start;/);
    assert.match(start, /translate: min\(0px, 100cqw \+ var\(--number-cell-padding\) - 100%\);/);
    assert.match(
        rules(css, '.number-cell.right > .number-content'),
        /translate: max\(0px, 100% - 100cqw - var\(--number-cell-padding\)\);/,
    );
    // Centred, a box no wider than the padding box already stays inside it: no shift.
    assert.ok(!/\n\.number-cell\.center > \.number-content \{/.test(css));
});

test('theNumberCellPaddingIsTheCellsOwn', () => {
    const css = read(CSS);
    assert.match(rules(css, '.number-cell'), /--number-cell-padding: 0px;/);
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl']) {
        const padding = /padding: (\S+) (\S+);|padding: (\S+);/.exec(
            rules(css, `.container.padding-${size}`),
        );
        assert.ok(padding, size);
        const horizontal = padding[2] ?? padding[3];
        assert.match(
            rules(css, `.number-cell.padding-${size}`),
            new RegExp(`--number-cell-padding: ${horizontal.replace(/[()]/g, '\\$&')};`),
            size,
        );
    }
    // Last, so it wins over a padding size on the same cell.
    const none = css.indexOf('\n.number-cell.no-horizontal-padding {');
    assert.ok(none > css.indexOf('\n.number-cell.padding-xl {'), 'no horizontal padding last');
    assert.match(rules(css, '.number-cell.no-horizontal-padding'), /--number-cell-padding: 0px;/);
});

// R17 review M-3: a new number cell component's column left off the floor list.
const NUMBER_CELLS = [
    'AbsoluteDateColumn',
    'BitRateColumn',
    'CountColumn',
    'DateColumn',
    'DurationColumn',
    'NumericColumn',
    'RelativeDateColumn',
    'ReleaseYearColumn',
    'SizeColumn',
    'TrackDateColumn',
    'TrackNumberColumn',
    'YearColumn',
];

test('everyNumberCellComponentsColumnKeepsItsFloor', () => {
    const ids = [...CELL_OF].filter(([, cell]) => NUMBER_CELLS.includes(cell)).map(([id]) => id);
    assert.ok(ids.length >= 18, `${ids.length} number ids`);
    for (const id of ids) assert.ok(fit.keepsItsFloor(id), `${id} renders a number cell`);
    for (const cell of NUMBER_CELLS) {
        assert.ok([...CELL_OF.values()].includes(cell), `${cell} is in the registry`);
    }
});

// R17 review M-4: the playable track number's own display wins over the number rule by
// specificity, not by which module's CSS the bundle puts last.
test('thePlayableTrackNumberDoesNotDependOnCssOrder', () => {
    const css = read('./columns/row-index-column.module.css');
    assert.ok(!/(^|\n)\.full-size-content \{/.test(css), 'a single-class .full-size-content rule');
    const rule = block(css, '.full-size-content.full-size-content {');
    assert.match(rule, /display: flex;/);
    assert.match(rule, /overflow: visible;/);
});
