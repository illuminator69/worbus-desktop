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
    const duration = /background-color (\d*\.?\d+s) ease-in-out/.exec(button);
    assert.ok(lightenAt && darkenAt && duration, "the Button's hover rules moved");

    const lighten = Number(lightenAt[1]) / 100;
    const darken = Number(darkenAt[1]) / 100;
    assert.match(chip, new RegExp(`--chip-overlay: rgb\\(255 255 255 / ${lighten * 100}%\\)`));
    assert.match(chip, new RegExp(`--chip-overlay: rgb\\(0 0 0 / ${darken * 100}%\\)`));
    assert.match(
        chip,
        new RegExp(`transition: background-color ${duration[1].replace('.', '\\.')} ease-in-out`),
        'the overlay fades in over the Button',
    );

    // Not on a disabled chip; the chosen one (pressed, current page, active segment) darkens.
    assert.match(chip, /:not\(:disabled, \[data-disabled\], \[aria-disabled='true'\]\)/);
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
    assert.match(source, /label: clsx\(chipStyles\.chip, ownLabel \?\? styles\.label\)/);
});

/**
 * The guard that keeps the list whole: a CSS rule that draws a clickable thing on the surface
 * (`cursor: pointer` and the surface or the wash's surface as its background) and has no hover of
 * its own is a chip that must be in SITES, or one of the few named here that is not a chip.
 */
const NOT_CHIPS: Record<string, string> = {
    // The album page's tags: a plain one is a label; the linked one wears the class (above).
    'src/renderer/features/albums/components/album-detail-content.module.css .chip-tag': 'tags',
    // The command palette's rows: highlighted by `data-selected`, which follows the pointer.
    'src/renderer/features/search/components/command.css [cmdk-item]': 'palette rows',
    // The detail pages' hero buttons (Play's row): buttons, not chips; their outline variants draw
    // with an inset shadow, which the overlay would replace. Reported, not changed (B-293 scope).
    'src/renderer/features/shared/components/hero-actions.module.css .button': 'hero buttons',
};

const camel = (kebab: string) => kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

test('no_clickable_surface_rule_is_left_without_a_hover', () => {
    const files = execFileSync('git', ['ls-files', 'src/renderer/*.css', 'src/shared/*.css'], {
        cwd: ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter(Boolean)
        .filter((f) => f !== SHARED);
    const covered = new Set(
        SITES.flatMap(({ file, local }) => local.map((name) => `${path.dirname(file)} ${name}`)),
    );
    const unlisted: string[] = [];
    for (const file of files) {
        const css = read(file);
        for (const match of css.matchAll(/^([^\s{}@/][^{}]*?)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/gm)) {
            const [, selectorList, body] = match;
            if (!/cursor: pointer/.test(body)) continue;
            if (!/background: var\(--(theme-colors-surface|wash-surf2)\)/.test(body)) continue;
            for (const selector of selectorList.split(',').map((s) => s.trim())) {
                const key = `${file} ${selector}`;
                if (NOT_CHIPS[key]) continue;
                const cls = /^\.([a-z][a-z0-9-]*)$/.exec(selector)?.[1];
                const hasOwnHover = cls && new RegExp(`\\.${cls}[^{,]*:hover`).test(css);
                if (hasOwnHover || /&:hover/.test(body)) continue;
                if (cls && covered.has(`${path.dirname(file)} ${camel(cls)}`)) continue;
                unlisted.push(key);
            }
        }
    }
    assert.deepEqual(unlisted, []);
});
