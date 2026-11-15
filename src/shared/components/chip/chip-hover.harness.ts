import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * B-293 (owner, after the stage 2 walk): "the chips dont react on hover - this includes all of the
 * fork's chips (the side queue, home page mixes, library, etc.). see how the app handles that for
 * upstream chips and adopt it".
 *   node --test src/shared/components/chip/chip-hover.harness.ts
 *
 * Upstream's chips are the shared Button: `default` on the surface (Search's Songs / Albums /
 * Artists, the station chips) lightens its background 5% under the pointer, `filled` (the chosen
 * one) darkens 10%, both over `background-color 0.2s ease-in-out`. The fork's chips are hand-drawn
 * buttons and links on the same surface with no hover rule at all. They now all wear one shared
 * class, `chip.module.css`, which draws the Button's two hovers as an overlay: white 5% over a
 * colour is exactly `lighten(colour, 5%)` (Mantine's `color-mix(in srgb, colour, white 5%)`,
 * translucent colours included), black 10% exactly `darken(colour, 10%)`, so one rule serves the
 * surface, the cover wash's surface and the accent alike.
 */

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const SHARED = 'src/shared/components/chip/chip.module.css';
const SHARED_IMPORT = "'/@/shared/components/chip/chip.module.css'";

test('the_shared_chip_class_draws_upstreams_button_hover', () => {
    assert.ok(existsSync(path.join(ROOT, SHARED)), `${SHARED} does not exist`);
    const button = read('src/shared/components/button/button.module.css');
    const chip = read(SHARED);

    // Upstream's numbers, read from the Button so a change there fails here.
    const lightenAt =
        /&\[data-variant='default'\][\s\S]*?&:hover\s*\{\s*background: lighten\(var\(--theme-colors-surface\), (\d+)%\);/.exec(
            button,
        );
    const darkenAt =
        /&\[data-variant='filled'\][\s\S]*?&:hover,\s*&:focus-visible\s*\{\s*background: darken\(var\(--theme-colors-primary-filled\), (\d+)%\);/.exec(
            button,
        );
    const focusAt =
        /&\[data-variant='default'\][\s\S]*?&:focus-visible\s*\{\s*background: lighten\(var\(--theme-colors-surface\), (\d+)%\);/.exec(
            button,
        );
    const duration = /background-color (\d*\.?\d+s) ease-in-out/.exec(button);
    assert.ok(lightenAt && darkenAt && focusAt && duration, "the Button's hover rules moved");

    const lighten = Number(lightenAt[1]) / 100;
    const darken = Number(darkenAt[1]) / 100;
    assert.match(chip, new RegExp(`--chip-overlay: rgb\\(255 255 255 / ${lighten * 100}%\\)`));
    assert.match(chip, new RegExp(`--chip-overlay: rgb\\(0 0 0 / ${darken * 100}%\\)`));

    // Keyboard focus lightens as the default Button's does (n1: 10%, not the hover's 5%).
    const focus =
        /&:focus-visible,\s*:focus-visible \+ & \{\s*--chip-overlay: rgb\(255 255 255 \/ (\d+)%\);/.exec(
            chip,
        );
    assert.ok(focus, 'keyboard focus has no overlay of its own');
    assert.equal(Number(focus[1]), Number(focusAt[1]));
    // n2: a SegmentedControl's focus sits on Mantine's hidden radio input just before the label.
    // n4: a touch screen keeps `:hover` after a tap, so the hover is for pointers that hover.
    assert.match(chip, /@media \(hover: hover\) \{\s*&:hover \{/);
    assert.doesNotMatch(
        chip.replaceAll(/@media \(hover: hover\) \{[\s\S]*?\n {4}\}/g, ''),
        /&:hover|\):hover/,
        'a hover outside the (hover: hover) guard',
    );
    assert.match(
        chip,
        new RegExp(`transition: background-color ${duration[1].replace('.', '\\.')} ease-in-out`),
        'the overlay fades in over the Button',
    );

    // Not on a disabled or read-only chip; the chosen one (pressed, current page, active segment) darkens.
    assert.match(
        chip,
        /:not\(:disabled, \[data-disabled\], \[data-read-only\], \[aria-disabled='true'\]\)/,
    );
    for (const chosen of [
        "[aria-pressed='true']",
        "[aria-current='page']",
        "[data-active='true']",
        // A chip painted in the accent at rest (the player bar's device pill) is upstream's
        // `filled` Button, so it darkens too.
        "[data-variant='filled']",
    ]) {
        assert.ok(chip.includes(chosen), `the chosen state ${chosen} has no hover`);
    }
});

/** The top-level blocks of a stylesheet: `[prelude, body]`, nesting kept inside the body. */
const blocks = (css: string): [string, string][] => {
    const out: [string, string][] = [];
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let start = 0;
    let open = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '{') {
            if (depth === 0) open = i;
            depth += 1;
        } else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                out.push([text.slice(start, open).trim(), text.slice(open + 1, i)]);
                start = i + 1;
            }
        }
    }
    return out;
};

/** The declarations written directly in a block body (not in its nested blocks). */
const ownDeclarations = (body: string): string[] => {
    let flat = body;
    for (;;) {
        const next = flat.replace(/[^{};]*\{[^{}]*\}/g, '');
        if (next === flat) break;
        flat = next;
    }
    return flat
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean);
};

test('the_chip_class_never_fights_a_sites_own_rules', () => {
    // m3 (review 2026-11-15): `.chip` and a site's own class are both one class, so a property
    // both set is decided by which stylesheet loads last (dev injects, production concatenates).
    // The overlay is the chip's own `::after`; the class sets nothing a site paints with on the
    // chip itself, and the host's containing block and stacking context sit in a cascade layer,
    // which every unlayered site rule beats whatever the order.
    const chip = read(SHARED);
    const sheet = blocks(chip);
    const host = sheet.filter(([prelude]) => prelude === '.chip');
    for (const [, body] of host) {
        for (const declaration of ownDeclarations(body)) {
            assert.match(
                declaration,
                /^--chip-/,
                `.chip sets \`${declaration}\` outside a layer; a site's own rule can lose to it`,
            );
        }
    }
    const layered = sheet.find(([prelude]) => /^@layer\s+[\w-]+$/.test(prelude));
    assert.ok(layered, 'the host rules are not in a cascade layer');
    assert.match(layered[1], /\.chip\s*\{[^}]*position: relative;[^}]*isolation: isolate;/);
    const overlay = sheet.find(([prelude]) => prelude === '.chip::after');
    assert.ok(overlay, 'the overlay is not the chip’s ::after');
    const own = ownDeclarations(overlay[1]).join('; ');
    for (const needed of [
        'position: absolute',
        'inset: 0',
        'z-index: -1',
        'pointer-events: none',
        "content: ''",
        'background-color: var(--chip-overlay)',
        'border-radius: inherit',
    ]) {
        assert.ok(own.includes(needed), `the overlay lacks \`${needed}\``);
    }

    // The one thing a site could still fight over is the pseudo-element itself.
    const clashes: string[] = [];
    for (const { file, local } of SITES) {
        const module = /import styles from '\.\/([\w.-]+\.module\.css)';/.exec(read(file))?.[1];
        assert.ok(module, `${file}: no styles module`);
        const css = read(path.join(path.dirname(file), module));
        for (const name of local) {
            const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
            if (new RegExp(`\\.${kebab}\\b[^{,]*::after`).test(css))
                clashes.push(`${module} .${kebab}`);
        }
    }
    assert.deepEqual(clashes, []);
});

/** Every fork chip: the file that draws it and the local classes that make it a chip. */
const SITES: { file: string; local: string[] }[] = [
    { file: 'src/renderer/features/library/components/library-chips.tsx', local: ['chip'] },
    { file: 'src/renderer/features/moods/components/mood-chips.tsx', local: ['chip', 'clear'] },
    { file: 'src/renderer/features/artists/components/artist-shelves.tsx', local: ['chip'] },
    {
        file: 'src/renderer/features/artists/components/album-artist-detail-content.tsx',
        local: ['switchChip', 'genre'],
    },
    {
        file: 'src/renderer/features/albums/components/album-detail-content.tsx',
        local: ['chip', 'iconChip'],
    },
    {
        file: 'src/renderer/features/discography/components/filter-bar.tsx',
        local: ['chip', 'iconChip'],
    },
    { file: 'src/renderer/features/songs/components/top-rated-chip.tsx', local: ['chip'] },
    // m4 (review 2026-11-15): the player bar's device pill (an accent button) and lb-bot's Find
    // sources cards (the card's button). The pill's own transition is its fold, which the class
    // leaves alone (the test above).
    { file: 'src/renderer/features/player/components/device-control.tsx', local: ['label'] },
    { file: 'src/renderer/features/lbbot/components/source-cards.tsx', local: ['head'] },
    // Home's Continue listening cards: a surface card, so the surface Button's response.
    { file: 'src/renderer/features/home/components/continue-listening-row.tsx', local: ['card'] },
    // lb-bot's album match modal: the cover choices (the chosen one `aria-pressed`).
    { file: 'src/renderer/features/lbbot/components/album-match-modal.tsx', local: ['cover'] },
];

/** Each `className={…}` expression in a file, braces balanced. */
const classNameExpressions = (source: string): string[] => {
    const out: string[] = [];
    let from = 0;
    for (;;) {
        const at = source.indexOf('className={', from);
        if (at < 0) return out;
        let depth = 0;
        let end = at + 'className='.length;
        for (; end < source.length; end += 1) {
            if (source[end] === '{') depth += 1;
            if (source[end] === '}') depth -= 1;
            if (depth === 0) break;
        }
        out.push(source.slice(at, end + 1));
        from = end + 1;
    }
};

test('every_fork_chip_wears_the_shared_class', () => {
    const missing: string[] = [];
    for (const { file, local } of SITES) {
        const source = read(file);
        if (!source.includes(SHARED_IMPORT))
            missing.push(`${file}: does not import ${SHARED_IMPORT}`);
        for (const expression of classNameExpressions(source)) {
            const names = local.filter((name) =>
                new RegExp(`styles\\.${name}\\b`).test(expression),
            );
            if (names.length === 0 || /\bchipStyles\.chip\b/.test(expression)) continue;
            missing.push(`${file}: ${expression}`);
        }
    }
    assert.deepEqual(missing, []);
});

test('the_album_pages_tag_links_hover_and_its_plain_tags_do_not', () => {
    const source = read('src/renderer/features/albums/components/album-detail-content.tsx');
    const link = /<Link\s+className=\{([^}]*styles\.chipTag[^}]*)\}/.exec(source);
    const span = /<span className=\{([^}]*styles\.chipTag[^}]*)\}/.exec(source);
    assert.ok(link && span, 'the tag chips moved');
    assert.match(link[1], /\bchipStyles\.chip\b/, 'a tag that links has no hover');
    assert.doesNotMatch(span[1], /\bchipStyles\.chip\b/, 'a plain tag is not a control');
});

test('the_device_pill_darkens_as_upstreams_filled_button_does', () => {
    // The pill is painted in the accent at rest, like upstream's `filled` Button, which darkens
    // 10% under the pointer rather than lightening.
    const source = read('src/renderer/features/player/components/device-control.tsx');
    assert.match(
        source,
        /className=\{clsx\(\s*chipStyles\.chip,\s*styles\.label,[^}]*\}\s*(?:\/\/[^\n]*\n\s*)?data-variant="filled"/,
    );
    const css = read('src/renderer/features/player/components/device-control.module.css');
    // Its fold is its own transition, and stays so.
    assert.match(
        css,
        /\.label \{[^}]*transition:\s*max-width var\(--fold\),\s*padding var\(--fold\),\s*opacity var\(--fold\);/,
    );
});

/**
 * M1 (review 2026-11-15): "home page mixes" is also Home's "Your mixes" row and the mood-mix tiles
 * under the mood chips, poster tiles beside upstream's album carousels. Upstream's cards answer the
 * pointer with ItemCard's image container: a black shade over the cover (its `::before`, 0.7 dark /
 * 0.5 light, 0.2 s). The fork's tiles wear that same class rather than a copy of its values.
 */
const CARD_IMPORT = "'/@/renderer/components/item-card/item-card.module.css'";

test('the_fork_tiles_wear_upstreams_card_hover', () => {
    const card = read('src/renderer/components/item-card/item-card.module.css');
    const shade = /\.image-container \{[\s\S]*?&::before \{([^}]*)\}[\s\S]*?&:hover \{/.exec(card);
    assert.ok(shade, "ItemCard's cover shade moved");
    const shadeZ = Number(/z-index: (\d+);/.exec(shade[1])?.[1]);
    assert.ok(shadeZ > 0, "ItemCard's shade has no z-index");

    // Every Discover / Home / lb-bot poster tile (Your mixes, Fresh, ListenBrainz, rediscovery,
    // similar artists and albums, missing albums, Listening): a clickable tile's cover sits in the
    // card's image container, isolated so the shade stays under the tile's own overlaid action.
    const tile = read('src/renderer/features/discover/components/discover-tile.tsx');
    assert.ok(tile.includes(CARD_IMPORT), 'DiscoverTile does not import the card class');
    assert.match(
        tile,
        /onClick\s*\?\s*\(\s*<div\s+className=\{clsx\(cardStyles\.imageContainer, styles\.shade,/,
        "a clickable DiscoverTile's cover is not in the card's image container",
    );
    const row = read('src/renderer/features/discover/components/discover-row.module.css');
    assert.match(row, /\.shade \{[^}]*isolation: isolate;/);

    // The mood-mix tiles: the whole face is the target, and its text and play button stay above
    // the shade, as upstream's play controls do over a shaded cover.
    const mood = read('src/renderer/features/moods/components/mood-tile.tsx');
    assert.ok(mood.includes(CARD_IMPORT), 'MoodTile does not import the card class');
    assert.match(mood, /className=\{clsx\(cardStyles\.imageContainer, styles\.face\)\}/);
    const moodCss = read('src/renderer/features/moods/components/mood-tile.module.css');
    for (const name of ['open', 'play']) {
        const z = Number(new RegExp(`\\.${name} \\{[^}]*z-index: (\\d+);`).exec(moodCss)?.[1]);
        assert.ok(z > shadeZ, `.${name} is not above ItemCard's shade (z-index ${shadeZ})`);
    }
});

test('every_segmented_control_label_wears_the_shared_class', () => {
    // The side queue's two switches (the characters, Up next / Related) and the fork pages'
    // segmented controls are the shared SegmentedControl; a caller's own label class is added to
    // the shared one, never instead of it.
    const source = read('src/shared/components/segmented-control/segmented-control.tsx');
    assert.ok(source.includes(SHARED_IMPORT), 'SegmentedControl does not import the chip class');
    // n3: a read-only one (nothing to choose) does not react.
    assert.match(
        source,
        /label: clsx\(!props\.readOnly && chipStyles\.chip, ownLabel \?\? styles\.label\)/,
    );
});

/**
 * The guard that keeps the lists whole. Widened after M1 and m4 slipped past the first one, which
 * only looked at `cursor: pointer` together with the surface as the background (the tiles paint a
 * cover or a gradient, the device pill the accent, the source cards nothing), and never at a button
 * without a pointer cursor. Two nets now:
 *  - every CSS rule in `src/renderer` and `src/shared` with `cursor: pointer`, whatever it paints;
 *  - every `<button>`, `<Link>`, `<a>` and `role="button"` whose `className` names a class of its
 *    own module, pointer cursor or not;
 * and each must answer the pointer: a `:hover` of its own (nested, compound or `@media`), an
 * ancestor's `:hover` that names it (`.row:hover .play`), the chip class (SITES), the card class
 * (TILES), or a named exception with its reason. Upstream's own rules are named too, so a new fork
 * rule anywhere fails here rather than passing as "upstream".
 */
const TILES: Record<string, string> = {
    // A clickable tile's cover sits in ItemCard's image container (the_fork_tiles_wear_…).
    'src/renderer/features/discover/components/discover-row.module.css .tile': 'DiscoverTile',
    // The face around them is ItemCard's image container.
    'src/renderer/features/moods/components/mood-tile.module.css .open': 'MoodTile',
    'src/renderer/features/moods/components/mood-tile.module.css .play': 'MoodTile',
};

const NOT_CHIPS: Record<string, string> = {
    // The album page's tags: a plain one is a label; the linked one wears the class (above).
    'src/renderer/features/albums/components/album-detail-content.module.css .chip-tag': 'tags',
    'src/renderer/features/discography/components/discography.module.css .section-toggle':
        'section heading',
    // Inside a card that wears the chip class (Continue listening).
    'src/renderer/features/home/components/continue-listening-row.module.css .main': 'in a chip',
    // Text, not a control surface: an underlined link and a folding section heading.
    'src/renderer/features/lbbot/components/gap-box.module.css .link': 'underlined link',
    // Inside a row whose own `.row:hover` lightens it (Mixes, Saved queues).
    'src/renderer/features/mixes/routes/mixes-route.module.css .row-main': 'row hover',
    // The side queue's Autoplay switch: upstream's Switch has no hover either.
    'src/renderer/features/now-playing/components/queue-panel-header.module.css .switch-track':
        'a switch',
    'src/renderer/features/saved-queues/routes/saved-queues-route.module.css .row-main':
        'row hover',
    // The detail pages' hero buttons (Play's row): buttons, not chips; B-461 waits for the owner.
    'src/renderer/features/shared/components/hero-actions.module.css .button': 'hero buttons',
    'src/renderer/features/shared/components/hero-actions.module.css .play': 'hero buttons',
    // The collapsed queue rail's 32 px next-song cover: upstream's small covers (the player bar's)
    // show no shade either. Reported for the owner, not changed.
    'src/renderer/layouts/default-layout/queue-rail.module.css .cover': 'rail thumbnail',
    // A text field (it opens the palette), not a chip.
    'src/renderer/layouts/default-layout/top-bar.module.css .search-input': 'a field',
};

/** Upstream's own clickables without a hover; the fork leaves them as upstream draws them. */
const UPSTREAM = [
    'src/renderer/components/item-list/item-detail-list/columns/genre-badge-column.module.css .group a',
    'src/renderer/components/item-list/item-table-list/columns/album-artists-column.module.css .group a',
    'src/renderer/components/item-list/item-table-list/columns/artists-column.module.css .group a',
    'src/renderer/components/item-list/item-table-list/columns/genre-badge-column.module.css .group a',
    'src/renderer/components/item-list/item-detail-list/item-detail-list.module.css .image-wrapper',
    'src/renderer/components/item-list/selection-dialog.module.css .info-icon',
    'src/renderer/components/page-header/page-header.module.css .header',
    'src/renderer/features/lyrics/karaoke-lyric-line.module.css .karaoke-line:global(.synchronized)',
    'src/renderer/features/lyrics/lyric-line.module.css .lyric-line:global(.synchronized)',
    'src/renderer/features/player/components/full-screen-player-image.module.css .metadata-container',
    'src/renderer/features/player/components/mobile-playerbar.module.css .image',
    'src/renderer/features/player/components/mobile-playerbar.module.css .line-item',
    'src/renderer/features/player/components/player-button.module.css .motion-wrapper',
    'src/renderer/features/player/components/playerbar-waveform.module.css .wavesurfer-container',
    'src/renderer/features/player/components/shared-full-screen-player-metadata.module.css .metadata-container',
    'src/renderer/features/radio/components/radio-list-items.module.css .radio-item-button',
    'src/renderer/features/search/components/command.css [cmdk-item]',
    'src/renderer/features/sidebar/components/server-selector.module.css .button-container',
    // Mantine's Accordion.Control (its own hover); the class only marks a drag over it.
    'src/renderer/features/sidebar/components/playlist-folder-tree.module.css .root-drop-target-dragged-over',
    'src/shared/components/read-only-rating/read-only-rating.module.css .root.interactive',
    'src/shared/components/spoiler/spoiler.module.css .spoiler',
    'src/shared/components/spoiler/spoiler.module.css .spoiler.can-expand',
];

const camel = (kebab: string) => kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** A rule for `.cls` that answers the pointer: its own `:hover` anywhere, or an ancestor's. */
const answersThePointer = (css: string, cls: string): boolean => {
    const c = escape(cls);
    if (new RegExp(`\\.${c}(?![\\w-])[^{,\\s]*:hover`).test(css)) return true;
    if (new RegExp(`:hover[^{},;]*\\s[^{},;]*\\.${c}(?![\\w-])`).test(css)) return true;
    for (const [prelude, body] of blocks(css)) {
        if (!new RegExp(`(^|,)\\s*\\.${c}(?![\\w-])[^,]*$`, 'm').test(prelude)) continue;
        if (/:hover/.test(body)) return true;
    }
    return false;
};

const listed = (key: string, chipCovered: Set<string>, file: string, cls: string) =>
    Boolean(
        NOT_CHIPS[key] ||
        TILES[key] ||
        UPSTREAM.includes(key) ||
        chipCovered.has(`${path.dirname(file)} ${camel(cls)}`),
    );

const chipCoverage = () =>
    new Set(SITES.flatMap(({ file, local }) => local.map((n) => `${path.dirname(file)} ${n}`)));

const lsFiles = (...patterns: string[]) =>
    execFileSync('git', ['ls-files', ...patterns], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);

test('no_clickable_rule_is_left_without_a_hover', () => {
    const covered = chipCoverage();
    const unlisted: string[] = [];
    for (const file of lsFiles('src/renderer/*.css', 'src/shared/*.css')) {
        if (file === SHARED) continue;
        const css = uncomment(read(file));
        for (const match of css.matchAll(
            /^([^\s{}@/][^{}]*?)\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/gm,
        )) {
            const [, selectorList, body] = match;
            if (!/cursor:\s*pointer/.test(body) || /:hover/.test(body)) continue;
            for (const selector of selectorList.split(',').map((s) => s.trim())) {
                const key = `${file} ${selector}`;
                // The element's own class: the last compound's.
                const cls = /\.([a-z][a-z0-9-]*)(?=[^.\s]*$)/.exec(selector)?.[1];
                if (cls && answersThePointer(css, cls)) continue;
                if (listed(key, covered, file, cls ?? '')) continue;
                unlisted.push(key);
            }
        }
    }
    assert.deepEqual(unlisted, []);
});

/** A JSX opening tag from its `<` to its `>`, braces (props) balanced. */
const openingTag = (source: string, start: number): string => {
    let depth = 0;
    for (let end = start; end < source.length; end += 1) {
        if (source[end] === '{') depth += 1;
        if (source[end] === '}') depth -= 1;
        if (source[end] === '>' && depth === 0 && source[end - 1] !== '=') {
            return source.slice(start, end + 1);
        }
    }
    return source.slice(start);
};

test('no_clickable_element_is_left_without_a_hover', () => {
    // The cursor-less half: a button, link or role="button" styled by its own module.
    const covered = chipCoverage();
    const unlisted: string[] = [];
    for (const file of lsFiles('src/renderer/*.tsx', 'src/shared/*.tsx')) {
        const source = read(file);
        const imported = /import (\w+) from '\.\/([\w.-]+\.module\.css)';/.exec(source);
        if (!imported) continue;
        const [, styles, module] = imported;
        const cssFile = path.join(path.dirname(file), module);
        const css = uncomment(read(cssFile));
        const opening = /<(button|Link|a|NavLink|UnstyledButton)\b|role="button"/g;
        for (const element of source.matchAll(opening)) {
            const start = element[1]
                ? (element.index ?? 0)
                : source.lastIndexOf('<', element.index);
            const tag = openingTag(source, start);
            const at = tag.indexOf('className={');
            if (at < 0) continue;
            const expression = classNameExpressions(tag.slice(at))[0] ?? '';
            if (/\bchipStyles\.chip\b|\bcardStyles\.imageContainer\b/.test(expression)) continue;
            const name = new RegExp(`\\b${styles}\\.(\\w+)`).exec(expression)?.[1];
            if (!name) continue;
            const cls = kebab(name);
            if (answersThePointer(css, cls)) continue;
            if (listed(`${cssFile} .${cls}`, covered, cssFile, cls)) continue;
            unlisted.push(`${file} ${element[0]} ${styles}.${name}`);
        }
    }
    assert.deepEqual([...new Set(unlisted)], []);
});
