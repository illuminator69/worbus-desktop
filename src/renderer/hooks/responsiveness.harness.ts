import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Q-164 (comparing Psysonic, 2026-11-09; navi-connect/ASSESS-psysonic-2026-11-09.md §1):
 *   node --test src/renderer/hooks/responsiveness.harness.ts
 *
 * Three costs found by reading, measured on the VM walk before and after (RESULTS-stage2-desktop):
 * - every route change forced a full `global.gc()` and `webFrame.clearCache()` (the decoded-image
 *   cache: the covers of the page left are decoded again on Back), on top of the 5-minute timer;
 * - a compact card's caption blurred what is under it (`backdrop-filter`), a filter pass per card
 *   per frame while a grid scrolls (the owner approved removing it, 2026-11-14);
 * - the mpv engine polled mpv's position every 250 ms for an `onProgress` that does nothing, beside
 *   the player's real 500 ms poll.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a_route_change_does_not_force_a_collection', () => {
    const src = read('./use-garbage-collection.ts');
    assert.doesNotMatch(src, /useLocation/, 'a gc and a cache clear on every route change');
});

test('compact_cards_draw_no_backdrop_blur', () => {
    const css = read('../components/item-card/item-card.module.css');
    assert.doesNotMatch(css, /backdrop-filter/);
});

test('one_mpv_position_poll', () => {
    const engine = read('../features/player/audio-player/engine/mpv-player-engine.tsx');
    assert.doesNotMatch(engine, /PROGRESS_UPDATE_INTERVAL/, 'the dead 250 ms poll');
    assert.match(read('../features/player/audio-player/mpv-player.tsx'), /getCurrentTime\(\)/);
});

test('page_data_is_kept_two_minutes', () => {
    // Owner ruling 2026-11-14 (Q-164): a page left for under two minutes comes back from the cache
    // instead of re-suspending (Home's shelves did after 20 s away). Still stale after 10 s, so what
    // comes back is shown at once and refreshed behind it.
    const src = read('../lib/react-query.ts');
    assert.match(src, /gcTime: 1000 \* 60 \* 2, \/\/ 2 minutes/);
    assert.match(src, /staleTime: 1000 \* 10, \/\/ 10 seconds/);
});

test('the_infinite_lists_assembled_map_is_not_kept_two_minutes', () => {
    // m2 (review 2026-11-15): the infinite loader's assembled map (every loaded page of a list, by
    // index) is wiped and refetched when a list mounts again, random sort excepted, so the
    // 2-minute rule only held a long list in memory for nothing. It is released like the page
    // responses it is built from (15 s); a random-sort list, whose map a remount does reuse, keeps
    // the 2-minute default.
    const src = read('../components/item-list/helpers/item-list-infinite-loader.ts');
    const map = /useQuery<InfiniteLoaderCacheData>\(\{([\s\S]*?)\}\);/.exec(src);
    assert.ok(map, 'the assembled-map query moved');
    assert.match(map[1], /\.\.\.\(isRandomSort \? \{\} : \{ gcTime: 1000 \* 15 \}\)/);
    // The remount wipe this relies on is still there, and still spares random sort.
    assert.match(src, /if \(isRandomSort\) \{\s*const existingData = queryClient\.getQueryData/);
    assert.match(src, /dataMap: new Map\(\),\s*idToIndexMap: new Map\(\),\s*pagesLoaded: \{\},/);
});
