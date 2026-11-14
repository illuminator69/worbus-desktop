import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-456 (the stage 2 desktop walk, 2026-11-14):  node --test src/renderer/icon-button-names.harness.ts
 *
 * An icon-only button with no name is "button" to a screen reader. B-197 named the shared ActionIcon
 * by its tooltip, which missed two kinds: `PlayerButton` wraps its own Tooltip and never handed the
 * label to the ActionIcon inside (the player bar's buttons, the radio Stop among them), and the item
 * list's cells (the "…", the heart, the expand chevron: every table, the side queue included) have no
 * tooltip at all.
 *
 * The scan: every `<ActionIcon` and `<PlayerButton` in the renderer names itself (`aria-label=`), or
 * has a tooltip (which names it), or spreads props a caller names. The ones still unnamed when this
 * was written are counted per file below: the count may only go down (lower it when you name one),
 * and a file not listed may have none.
 */

const ROOT = new URL('./', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8');

const STILL_UNNAMED: Record<string, number> = {
    'components/feature-carousel/feature-carousel.tsx': 2,
    'components/feature-carousel/single-feature-carousel.tsx': 2,
    'components/grid-carousel/grid-carousel-v2.tsx': 4,
    'components/item-list/item-table-list/columns/playlist-reorder-column.tsx': 1,
    'components/item-list/selection-dialog.tsx': 2,
    'components/query-builder/index.tsx': 2,
    'components/query-builder/query-builder-option.tsx': 1,
    'features/action-required/routes/invalid-route.tsx': 1,
    'features/albums/components/expanded-album-list-item.tsx': 1,
    'features/albums/routes/dummy-album-detail-route.tsx': 2,
    'features/artists/components/album-artist-detail-header.tsx': 1,
    'features/item-details/components/song-path.tsx': 2,
    'features/lyrics/components/lyrics-search-form.tsx': 2,
    'features/lyrics/lyrics.tsx': 1,
    'features/mixes/routes/mixes-route.tsx': 1,
    'features/player/components/mobile-fullscreen-player-bottom-controls.tsx': 5,
    'features/player/components/mobile-fullscreen-player-metadata.tsx': 1,
    'features/player/components/mobile-fullscreen-player.tsx': 4,
    'features/player/components/mobile-playerbar.tsx': 1,
    'features/playlists/components/playlist-detail-song-list-header-filters.tsx': 2,
    'features/playlists/components/playlist-detail-song-list-header.tsx': 1,
    'features/playlists/components/playlist-query-builder.tsx': 2,
    'features/playlists/components/update-playlist-form.tsx': 1,
    'features/playlists/routes/playlist-detail-song-list-route.tsx': 1,
    'features/radio/components/edit-radio-station-form.tsx': 1,
    'features/saved-queues/routes/saved-queues-route.tsx': 1,
    'features/search/components/command-palette.tsx': 1,
    'features/search/components/library-command-item.tsx': 1,
    'features/servers/components/jellyfin-quick-connect-button.tsx': 1,
    'features/settings/components/general/draggable-item.tsx': 1,
    'features/settings/components/general/path-settings.tsx': 1,
    'features/settings/components/general/query-builder-settings.tsx': 1,
    'features/settings/components/hotkeys/hotkey-manager-settings.tsx': 2,
    'features/settings/components/playback/mpv-settings.tsx': 1,
    'features/settings/components/playback/player-filter-settings.tsx': 1,
    'features/shared/components/grid-config.tsx': 3,
    'features/shared/components/library-header.tsx': 2,
    'features/shared/components/list-filters.tsx': 2,
    'features/shared/components/search-input.tsx': 1,
    'features/shared/components/table-config.tsx': 1,
    'features/sidebar/components/sidebar-collection-list.tsx': 1,
    'features/tag-editor/components/add-field-input.tsx': 1,
    'features/tag-editor/components/artwork-panel.tsx': 1,
    'features/tag-editor/components/tag-editor-settings.tsx': 1,
    'features/visualizer/components/audiomotionanalyzer/visualizer-settings-form.tsx': 2,
    'features/visualizer/components/audiomotionanalyzer/visualizer.tsx': 2,
    'features/visualizer/components/butternchurn/visualizer.tsx': 4,
    'features/visualizer/components/visualizer.tsx': 2,
};

/** The opening tag starting at `i` (`<Name ... >`), braces respected. */
const openingTag = (src: string, i: number) => {
    let depth = 0;
    for (let j = i + 1; j < src.length; j++) {
        const c = src[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0 && src[j - 1] !== '=') return src.slice(i, j + 1);
    }
    return src.slice(i);
};

const unnamedByFile = () => {
    const out: Record<string, number> = {};
    for (const rel of readdirSync(ROOT, { recursive: true }) as string[]) {
        if (!rel.endsWith('.tsx')) continue;
        const src = read(rel);
        for (const m of src.matchAll(/<(ActionIcon|PlayerButton)\b/g)) {
            const tag = openingTag(src, m.index);
            if (!/\baria-label=|\btooltip=|\{\.\.\./.test(tag)) out[rel] = (out[rel] ?? 0) + 1;
        }
    }
    return out;
};

test('no_new_unnamed_icon_button', () => {
    const found = unnamedByFile();
    const over = Object.entries(found)
        .filter(([file, n]) => n > (STILL_UNNAMED[file] ?? 0))
        .map(([file, n]) => `${file}: ${n} unnamed (allowed ${STILL_UNNAMED[file] ?? 0})`);
    assert.deepEqual(over, [], 'an icon button with no aria-label and no tooltip');
    const under = Object.entries(STILL_UNNAMED)
        .filter(([file, n]) => (found[file] ?? 0) < n)
        .map(([file, n]) => `${file}: ${found[file] ?? 0} now, listed ${n}`);
    assert.deepEqual(under, [], 'named one: lower its count in STILL_UNNAMED');
});

test('the_player_button_is_named_by_its_tooltip', () => {
    const src = read('features/player/components/player-button.tsx');
    const body = src.slice(
        src.indexOf('export const PlayerButton'),
        src.indexOf('interface PlayButtonProps'),
    );
    assert.match(body, /aria-label=\{iconButtonName\(rest\['aria-label'\], tooltip\.label\)\}/);
});

test('the_list_cells_name_their_buttons', () => {
    for (const file of [
        'components/item-list/item-table-list/columns/actions-column.tsx',
        'components/item-list/item-detail-list/columns/actions-column.tsx',
    ]) {
        const src = read(file);
        assert.match(src, /aria-label=\{t\('action\.moreOptions'\)\}/, file);
        assert.match(src, /aria-haspopup="menu"/, file);
    }
    for (const file of [
        'components/item-list/item-table-list/columns/favorite-column.tsx',
        'components/item-list/item-detail-list/columns/favorite-column.tsx',
        'components/item-list/item-table-list/album-group-controls.tsx',
    ]) {
        const src = read(file);
        assert.match(src, /'action\.removeFromFavorites' : 'action\.addToFavorites'/, file);
        assert.match(src, /aria-pressed=/, file);
    }
    const en = JSON.parse(readFileSync(new URL('../i18n/locales/en.json', ROOT), 'utf8'));
    assert.equal(typeof en.action.moreOptions, 'string', 'a common "More options" string');
});
