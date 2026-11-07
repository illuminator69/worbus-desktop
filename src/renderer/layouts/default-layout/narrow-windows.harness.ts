import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * R6 lane review (B-207, B-198):  node --test src/renderer/layouts/default-layout/narrow-windows.harness.ts
 *
 * Rules the lane review found missing, pinned on the source: a short window keeps the queue's rows,
 * the overlaid queue survives the player bar and a drag from the page, and what reads the fold
 * (title bar padding, menus, the sidebar's handle) reads the fold and not the saved flags.
 */

const src = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, src), 'utf8');

const block = (text: string, start: string) => {
    const at = text.indexOf(start);
    assert.ok(at >= 0, start);
    return text.slice(at, text.indexOf('\n}', at));
};

test('shortWindowFoldsTheQueueHeader', () => {
    const header = read('renderer/features/now-playing/components/queue-panel-header.module.css');
    const short = block(header, '@container queue-panel (max-height: 580px)');
    for (const hidden of ['.from-caption', '.sentence', '.status', '.characters']) {
        assert.ok(short.includes(hidden), hidden);
    }
    assert.match(short, /display: none/);
    // One row of tabs and count there, and the wrapper is invisible to the layout everywhere else.
    assert.match(short, /\.tabs-row \{\s*display: flex;/);
    assert.match(header, /\.tabs-row \{\s*display: contents;\s*\}/);

    const tsx = read('renderer/features/now-playing/components/queue-panel-header.tsx');
    for (const hook of [
        'styles.fromCaption',
        'styles.sentence',
        'styles.characters',
        'styles.tabsRow',
    ]) {
        assert.ok(tsx.includes(hook), hook);
    }
});

test('bothQueueBranchesAreTheSizeContainer', () => {
    const css = read('renderer/features/now-playing/components/sidebar-play-queue.module.css');
    for (const rule of ['.queue-only {', '.panels-with-strip {']) {
        assert.match(block(css, rule), /container: queue-panel \/ size;/, rule);
    }
    // The open strip leaves the queue three rows in a short panel.
    assert.match(
        block(css, '.strip-area {'),
        /height: min\(320px, 40cqh, calc\(100cqh - 280px\)\);/,
    );
});

test('stripFoldsTall', () => {
    const tsx = read('renderer/features/now-playing/components/sidebar-play-queue.tsx');
    assert.match(tsx, /<Fold name="queue-lyrics" open=\{shown\} tall>/);
    assert.ok(tsx.includes('setMounted(false), GROW_MS_TALL + 50)'));
});

test('overlaySurvivesTheBarAndADrag', () => {
    const tsx = read('renderer/layouts/default-layout/right-sidebar.tsx');
    const keepers = tsx.slice(
        tsx.indexOf('const OVERLAY_KEEPERS'),
        tsx.indexOf(';', tsx.indexOf('const OVERLAY_KEEPERS')),
    );
    assert.ok(keepers.includes('#player-bar'));
    // A native drag ends with no click; a pointerdown would close the overlay as the drag starts.
    assert.ok(tsx.includes("document.addEventListener('click', onClick, true)"));
    assert.ok(!tsx.includes("'pointerdown'"));
});

test('foldReadersReadTheFold', () => {
    const titlebar = read('renderer/hooks/use-should-pad-titlebar.tsx');
    assert.ok(titlebar.includes('useRightSidebarVisible()'));
    assert.ok(!titlebar.includes('useSidebarRightExpanded'));

    for (const path of [
        'renderer/features/titlebar/components/app-menu.tsx',
        'renderer/hooks/use-native-menu-sync.tsx',
    ]) {
        assert.ok(read(path).includes('useSidebarFolded()'), path);
    }
    assert.match(read('renderer/features/titlebar/components/app-menu.tsx'), /disabled: folded/);
    assert.match(read('main/menu.ts'), /enabled = !sidebarFolded/);

    assert.match(
        read('renderer/layouts/default-layout/left-sidebar.tsx'),
        /\{!folded && \(\s*<ResizeHandle/,
    );
});
