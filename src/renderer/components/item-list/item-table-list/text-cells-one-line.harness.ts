import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-267:  node --test src/renderer/components/item-list/item-table-list/text-cells-one-line.harness.ts
 *
 * At a column's 40 px floor the Album and Genre cells showed "Wys" / "Live", "Indi" / "Roc": the
 * text wrapped onto a second line (a two-line clamp) and a word wider than the cell was clipped
 * through, with no ellipsis, while the headers ellipsised. Every text cell is now one line ending
 * in an ellipsis, by the rule the title column's artist line already uses (`.artists` in
 * title-combined-column.module.css), and lets the pointer read the full text when it is cut.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const block = (css: string, start: string) => {
    const at = css.indexOf(start);
    assert.ok(at >= 0, start);
    return css.slice(at, css.indexOf('\n}', at));
};

const ONE_LINE = [
    'min-width: 0;',
    'max-width: 100%;',
    'overflow: hidden;',
    'text-overflow: ellipsis;',
    'white-space: nowrap;',
    '--text-text-wrap: nowrap;',
];

// Every text cell's own class: the shared text container and each column's container.
const CELLS: Array<[string, string]> = [
    ['./item-table-list-column.module.css', '\n.content {'],
    ['./columns/album-column.module.css', '.album-container {'],
    ['./columns/album-artists-column.module.css', '.artists-container {'],
    ['./columns/artists-column.module.css', '.artists-container {'],
    ['./columns/composer-column.module.css', '.composers-container {'],
    ['./columns/genre-column.module.css', '.genres-container {'],
    ['./columns/title-combined-column.module.css', '\n.artists {'],
];

test('everyTextCellIsOneLineEndingInAnEllipsis', () => {
    for (const [path, start] of CELLS) {
        const rule = block(read(path), start);
        for (const declaration of ONE_LINE) {
            assert.ok(rule.includes(declaration), `${path} ${start.trim()} ${declaration}`);
        }
    }
});

test('noTextCellWrapsOntoASecondLine', () => {
    for (const [path] of CELLS.slice(1, -1)) {
        assert.ok(!/line-clamp/.test(read(path)), `${path} still clamps to lines`);
    }
    for (const start of ['\n.content {', '.content.compact {', '.content.large {']) {
        const css = read('./item-table-list-column.module.css');
        if (css.includes(start)) assert.ok(!/line-clamp: [23]/.test(block(css, start)), start);
    }
});

test('genreBadgesStayOnOneRow', () => {
    const source = read('./columns/genre-badge-column.tsx');
    assert.match(source, /wrap="nowrap"/);
    assert.doesNotMatch(source, /wrap="wrap"/);
});

test('everyTextCellShowsItsFullTextWhenCut', () => {
    for (const path of [
        './item-table-list-column.tsx',
        './columns/album-column.tsx',
        './columns/album-artists-column.tsx',
        './columns/artists-column.tsx',
        './columns/composer-column.tsx',
        './columns/genre-column.tsx',
        './columns/genre-badge-column.tsx',
        './columns/title-column.tsx',
        './columns/title-combined-column.tsx',
        './columns/title-artist-column.tsx',
    ]) {
        assert.match(read(path), /showFullTextWhenCut/, path);
    }
});

/*
 * R16 review M1: at the Genre (badge) column's 40 px floor the badges could only shrink to their
 * own padding, so two badges showed as empty pills, the second cut through by the cell, with no
 * ellipsis. Now the cell is a size container: at a width too narrow for another readable badge
 * the badges past it are hidden whole, and the one left has tighter padding, so its label ends in
 * an ellipsis. The tooltip names every genre (it listed the first four) and shows whenever a genre
 * is not fully on screen.
 */

test('genreBadgesHideWholeInsteadOfCuttingThrough', () => {
    const css = read('./columns/genre-badge-column.module.css');
    assert.match(block(css, '.cell {'), /container-type: inline-size;/);
    // Each drawn badge keeps about 20 px of label: 1, 2, 3 badges below 80, 122, 164 px of content.
    const one = block(css, '@container (width < 80px)');
    assert.match(one, /\.group > :nth-child\(n \+ 2\)/);
    assert.match(one, /display: none;/);
    assert.match(block(css, '@container (width < 64px)'), /padding-inline:/);
    assert.match(css, /@container \(width < 122px\)[\s\S]*?\.group > :nth-child\(n \+ 3\)/);
    assert.match(css, /@container \(width < 164px\)[\s\S]*?\.group > :nth-child\(n \+ 4\)/);
    const source = read('./columns/genre-badge-column.tsx');
    assert.match(source, /className=\{styles\.cell\}/);
});

test('theGenreBadgeTooltipNamesEveryGenre', () => {
    const source = read('./columns/genre-badge-column.tsx');
    const handler = source.slice(source.indexOf('onMouseEnter'), source.indexOf('wrap="nowrap"'));
    assert.doesNotMatch(handler, /slice\(0, MAX_GENRES\)/);
    assert.match(handler, /genres\.length > MAX_GENRES/);
});

/*
 * R16 review M2: the playable row index wore a native tooltip of its own number beside its play
 * popover. A row number is not text cut mid-word; the index cell does not wire the full text.
 */

test('theRowIndexGetsNoFullTextTooltip', () => {
    const source = read('./item-table-list-column.tsx');
    const container = source.slice(
        source.indexOf('export const TableColumnTextContainer'),
        source.indexOf('export const TableColumnContainer'),
    );
    assert.match(container, /props\.type === TableColumn\.ROW_INDEX\s*\?\s*undefined/);
});

/*
 * R16 review M3: the branch deleted `.content.compact` / `.content.large`, so `styles.compact` and
 * `styles.large` were undefined and cells got a literal "undefined" class. Every class a cell
 * names must exist in its module.
 */

test('everyCellClassExistsInItsModule', () => {
    const files = [
        './item-table-list-column.tsx',
        ...readdirSync(new URL('./columns/', import.meta.url))
            .filter((name) => name.endsWith('.tsx'))
            .map((name) => `./columns/${name}`),
    ];
    for (const path of files) {
        const source = read(path);
        const module = /from '(\.\/[a-z-]+\.module\.css)'/.exec(source)?.[1];
        if (!module) continue;
        const css = read(new URL(module, new URL(path, import.meta.url)).href);
        for (const [, key] of source.matchAll(/styles\.([a-zA-Z]+)/g)) {
            const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
            assert.match(css, new RegExp(`\\.${kebab}(?![\\w-])`), `${path}: styles.${key}`);
        }
    }
});
