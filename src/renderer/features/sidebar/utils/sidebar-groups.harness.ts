import assert from 'node:assert/strict';
import test from 'node:test';

import type { SidebarContext, SidebarEntry, SidebarGroup } from './sidebar-groups.ts';

import { downloadsShown } from '../../../../shared/utils/lbbot-mode.ts';
import { attentionCount, sidebarGroups } from './sidebar-groups.ts';

/**
 * F3:  node --test src/renderer/features/sidebar/utils/sidebar-groups.harness.ts
 *
 * Which groups and entries the sidebar, the collapsed rail and the mobile drawer show, from the
 * gates and the persisted `sidebarItems`. Ids, order, badges and routes only: labels are
 * translated by the component.
 */

const routes = {
    activity: '/downloads',
    fresh: '/fresh',
    home: '/',
    library: '/library',
    libraryMatches: '/library-matches',
    listening: '/listening',
    savedQueues: '/saved-queues',
    settings: '/settings',
    wishlist: '/wishlist',
};

// The persisted defaults' shape: Now Playing, Search, Playlists and Settings start disabled.
const storedItems = () => [
    { disabled: true, id: 'Now Playing', label: 'Now Playing', route: '/now-playing' },
    { disabled: true, id: 'Search', label: 'Search', route: '/search/songs' },
    { disabled: false, id: 'Home', label: 'Home', route: '/' },
    { disabled: false, id: 'Favorites', label: 'Favorites', route: '/favorites' },
    { disabled: false, id: 'Albums', label: 'Albums', route: '/library/albums' },
    { disabled: false, id: 'Tracks', label: 'Tracks', route: '/library/songs' },
    { disabled: false, id: 'Artists', label: 'Album Artists', route: '/library/album-artists' },
    { disabled: false, id: 'Artists-all', label: 'Artists', route: '/library/artists' },
    { disabled: false, id: 'Genres', label: 'Genres', route: '/library/genres' },
    { disabled: false, id: 'Folders', label: 'Folders', route: '/library/folders' },
    { disabled: true, id: 'Playlists', label: 'Playlists', route: '/playlists' },
    { disabled: false, id: 'Collections', label: 'Collections', route: '' },
    { disabled: false, id: 'Radio', label: 'Radio', route: '/library/radio' },
    { disabled: true, id: 'Settings', label: 'Settings', route: '/settings' },
];

// The Library frame's list pages: the Library row is selected on every one of them.
const librarySelectedRoutes = ['/library', '/library/albums', '/library/songs', '/playlists'];

const ctx = (patch: Partial<SidebarContext> = {}): SidebarContext => ({
    attentionCount: 0,
    downloadsShown: true,
    lbBotAvailable: false,
    libraryItems: storedItems(),
    librarySelectedRoutes,
    listeningSupported: false,
    narrow: false,
    overridesSupported: false,
    routes,
    wishlistSupported: false,
    ...patch,
});

const ids = (entries: SidebarEntry[]) => entries.map((e) => e.id);
const group = (groups: SidebarGroup[], id: string) => groups.find((g) => g.id === id);
const shape = (groups: SidebarGroup[]) =>
    groups.map((g) => `${g.id}: ${ids(g.entries).join(', ')}`);
const mainIds = (groups: SidebarGroup[]) => ids(group(groups, 'main')!.entries);

const everyGate = (patch: Partial<SidebarContext> = {}) =>
    ctx({
        lbBotAvailable: true,
        listeningSupported: true,
        overridesSupported: true,
        ...patch,
    });

test('noLbBotLeavesHomeLibrarySavedQueuesAndSettings', () => {
    const { groups, more } = sidebarGroups(ctx());
    assert.deepEqual(shape(groups), [
        'main: home, library',
        'listening: savedQueues',
        'app: settings',
    ]);
    assert.deepEqual(more, []);
    const main = group(groups, 'main')!.entries;
    assert.equal(main[0].route, '/');
    assert.equal(main[1].route, '/library');
    assert.equal(group(groups, 'listening')!.entries[0].route, '/saved-queues');
    assert.equal(group(groups, 'app')!.entries[0].route, '/settings');
});

// B-374 (the owner's ruling, 2026-11-09): Needs attention and Activity were two entries for one
// page (/downloads, Needs attention its first section). One entry now, Activity, which carries
// the attention badge (admins only) and is selected on its page like any other.
test('lbBotAddsFreshAndOneActivityEntry', () => {
    const { groups } = sidebarGroups(ctx({ lbBotAvailable: true }));
    assert.deepEqual(shape(groups), [
        'main: home, library, fresh',
        'you: activity',
        'listening: savedQueues',
        'app: settings',
    ]);
    const you = group(groups, 'you')!;
    assert.equal(you.label, 'You');
    const [activity] = you.entries;
    assert.equal(activity.route, '/downloads');
    assert.equal(activity.selectedRoute, undefined, 'selected on its page, as any entry');
    assert.equal(group(groups, 'main')!.entries[2].route, '/fresh');
});

test('theBadgeAppearsOnlyAboveZero', () => {
    const none = group(sidebarGroups(ctx({ lbBotAvailable: true })).groups, 'you')!;
    assert.equal(none.entries[0].badge, undefined);
    assert.equal('badge' in none.entries[0], false);
    const two = group(
        sidebarGroups(ctx({ attentionCount: 2, lbBotAvailable: true })).groups,
        'you',
    )!;
    assert.deepEqual(ids(two.entries), ['activity']);
    assert.equal(two.entries[0].badge, 2);
    // Without lb-bot there is no row to carry it, whatever the count says.
    assert.equal(group(sidebarGroups(ctx({ attentionCount: 3 })).groups, 'you'), undefined);
});

test('listeningUnsupportedDropsStatistics', () => {
    const on = sidebarGroups(ctx({ lbBotAvailable: true, listeningSupported: true })).groups;
    assert.deepEqual(ids(group(on, 'listening')!.entries), ['statistics', 'savedQueues']);
    assert.equal(group(on, 'listening')!.entries[0].route, '/listening');
    const off = sidebarGroups(ctx({ lbBotAvailable: true, listeningSupported: false })).groups;
    assert.deepEqual(ids(group(off, 'listening')!.entries), ['savedQueues']);
});

test('libraryToolsNeedOverrides', () => {
    assert.equal(
        group(sidebarGroups(ctx({ lbBotAvailable: true })).groups, 'libraryTools'),
        undefined,
    );
    assert.equal(
        group(sidebarGroups(ctx({ overridesSupported: true })).groups, 'libraryTools'),
        undefined,
    );
    const tools = group(
        sidebarGroups(ctx({ lbBotAvailable: true, overridesSupported: true })).groups,
        'libraryTools',
    )!;
    assert.deepEqual(ids(tools.entries), ['libraryMatches']);
    assert.equal(tools.entries[0].route, '/library-matches');
    assert.equal(tools.label, 'Library tools');
});

test('groupsComeInTheBoardOrder', () => {
    assert.deepEqual(
        sidebarGroups(everyGate()).groups.map((g) => g.id),
        ['main', 'you', 'listening', 'libraryTools', 'app'],
    );
});

test('libraryIsOneRowSelectedOnEveryChipRoute', () => {
    const library = group(sidebarGroups(everyGate()).groups, 'main')!.entries[1];
    assert.equal(library.id, 'library');
    assert.equal(library.route, '/library');
    assert.equal('children' in library, false);
    assert.deepEqual(library.selectedRoutes, librarySelectedRoutes);
    // Not a shared array: a caller cannot change the context through it.
    assert.notEqual(library.selectedRoutes, librarySelectedRoutes);
});

test('theLibraryItemsNoLongerFeedTheSidebar', () => {
    // Albums, Tracks, the artists, Genres, Folders, Radio and Favorites are the frame's chips now.
    const allEnabled = storedItems().map((i) => ({ ...i, disabled: false }));
    assert.deepEqual(mainIds(sidebarGroups(ctx({ libraryItems: allEnabled })).groups), [
        'home',
        'library',
        'Now Playing',
        'Search',
    ]);
    assert.deepEqual(mainIds(sidebarGroups(ctx()).groups), ['home', 'library']);
});

test('nowPlayingAndSearchFollowLibraryAsPlainRows', () => {
    const items = storedItems().reverse();
    items.find((i) => i.id === 'Search')!.disabled = false;
    items.find((i) => i.id === 'Now Playing')!.disabled = false;
    const main = group(
        sidebarGroups(ctx({ lbBotAvailable: true, libraryItems: items })).groups,
        'main',
    )!.entries;
    // In the stored order, after Library and before Fresh.
    assert.deepEqual(ids(main), ['home', 'library', 'Search', 'Now Playing', 'fresh']);
    assert.equal(main[2].route, '/search/songs');
    assert.equal('children' in main[2], false);
    assert.equal(main[3].route, '/now-playing');
});

test('aRoutelessExtraIsNotARow', () => {
    const items = storedItems().map((i) =>
        i.id === 'Search' ? { ...i, disabled: false, route: '' } : i,
    );
    assert.deepEqual(mainIds(sidebarGroups(ctx({ libraryItems: items })).groups), [
        'home',
        'library',
    ]);
});

test('extrasDedupeByIdTheFirstOccurrenceDeciding', () => {
    const items = [
        ...storedItems(),
        { disabled: false, id: 'Search', label: 'Search again', route: '/search/albums' },
    ];
    // The stored Search is disabled and comes first: the tail duplicate does not show it.
    assert.deepEqual(mainIds(sidebarGroups(ctx({ libraryItems: items })).groups), [
        'home',
        'library',
    ]);
    const enabled = [
        { disabled: false, id: 'Search', label: 'Search', route: '/search/songs' },
        { disabled: false, id: 'Search', label: 'Search again', route: '/search/albums' },
    ];
    const main = group(sidebarGroups(ctx({ libraryItems: enabled })).groups, 'main')!.entries;
    assert.deepEqual(ids(main), ['home', 'library', 'Search']);
    assert.equal(main[2].route, '/search/songs');
});

test('discoverAndMixesAreNotSidebarRows', () => {
    // The chips and More carry them.
    const { groups, more } = sidebarGroups(everyGate());
    const all = [...groups.flatMap((g) => ids(g.entries)), ...ids(more)];
    assert.equal(all.includes('Discover'), false);
    assert.equal(all.includes('Mixes'), false);
});

test('narrowFoldsTheLowerGroupsIntoMore', () => {
    const { groups, more } = sidebarGroups(everyGate({ narrow: true }));
    assert.deepEqual(
        groups.map((g) => g.id),
        ['main', 'you'],
    );
    assert.deepEqual(ids(more), ['statistics', 'savedQueues', 'libraryMatches', 'settings']);
    const wide = sidebarGroups(everyGate());
    assert.deepEqual(wide.more, []);
    // Without lb-bot the fold still holds Saved queues and Settings.
    const bare = sidebarGroups(ctx({ narrow: true }));
    assert.deepEqual(
        bare.groups.map((g) => g.id),
        ['main'],
    );
    assert.deepEqual(ids(bare.more), ['savedQueues', 'settings']);
});

test('settingsIsInTheAppGroupEvenIfTheStoredItemIsDisabled', () => {
    const items = storedItems();
    assert.equal(items.find((i) => i.id === 'Settings')!.disabled, true);
    const app = group(sidebarGroups(ctx({ libraryItems: items })).groups, 'app')!;
    assert.deepEqual(ids(app.entries), ['settings']);
    assert.equal(app.label, 'App');
    // And with no stored list at all.
    assert.deepEqual(ids(group(sidebarGroups(ctx({ libraryItems: [] })).groups, 'app')!.entries), [
        'settings',
    ]);
});

test('attentionCountIgnoresGaveUpCancelledAndRunning', () => {
    assert.equal(
        attentionCount([
            { outcome: 'failed', settled: true },
            { outcome: 'needsPick', settled: true },
            { outcome: 'gaveUp', settled: true },
            { outcome: 'cancelled', settled: true },
            { outcome: 'failed', settled: false },
        ]),
        2,
    );
    assert.equal(attentionCount([{ outcome: 'running', settled: false }]), 0);
    assert.equal(attentionCount([{ outcome: 'done', settled: true }]), 0);
    assert.equal(attentionCount([]), 0);
});

// Worbus P1 (F2): lb-bot's downloads mode. Off: no Activity, and Needs attention only while the
// ledger holds failures from an earlier "on" period. On and unknown (an older peer): as before.

test('sidebar_off_has_no_activity', () => {
    const { groups } = sidebarGroups(
        ctx({ downloadsShown: downloadsShown('off'), lbBotAvailable: true }),
    );
    assert.deepEqual(shape(groups), [
        'main: home, library, fresh',
        'listening: savedQueues',
        'app: settings',
    ]);
});

test('sidebar_off_keeps_attention_only_with_failures', () => {
    const { groups } = sidebarGroups(
        ctx({ attentionCount: 2, downloadsShown: downloadsShown('off'), lbBotAvailable: true }),
    );
    const you = group(groups, 'you')!;
    assert.deepEqual(ids(you.entries), ['activity'], 'the failures stay reachable');
    assert.equal(you.entries[0].badge, 2);
    assert.equal(you.entries[0].route, '/downloads');
});

test('sidebar_on_unchanged', () => {
    for (const attentionCount of [0, 3]) {
        const on = sidebarGroups(
            ctx({ attentionCount, downloadsShown: downloadsShown('on'), lbBotAvailable: true }),
        );
        const before = sidebarGroups(ctx({ attentionCount, lbBotAvailable: true }));
        assert.deepEqual(on, before);
        assert.deepEqual(ids(group(on.groups, 'you')!.entries), ['activity']);
    }
});

test('sidebar_unknown_unchanged', () => {
    const unknown = sidebarGroups(
        ctx({ downloadsShown: downloadsShown('unknown'), lbBotAvailable: true }),
    );
    assert.deepEqual(shape(unknown.groups), [
        'main: home, library, fresh',
        'you: activity',
        'listening: savedQueues',
        'app: settings',
    ]);
});

// Worbus P1 (F3): the Wishlist is a page of its own in the You group, in both modes, while lb-bot is
// there and the hub proxies the wishlist.

test('wishlist_in_sidebar_both_modes', () => {
    for (const shown of [true, false]) {
        const { groups } = sidebarGroups(
            ctx({ downloadsShown: shown, lbBotAvailable: true, wishlistSupported: true }),
        );
        const you = group(groups, 'you')!;
        assert.ok(ids(you.entries).includes('wishlist'), `downloadsShown ${shown}`);
        const wishlist = you.entries.find((entry) => entry.id === 'wishlist')!;
        assert.equal(wishlist.route, '/wishlist');
        assert.equal(wishlist.label, 'Wishlist');
    }
    // On: after Needs attention and Activity.
    const on = sidebarGroups(ctx({ lbBotAvailable: true, wishlistSupported: true })).groups;
    assert.deepEqual(ids(group(on, 'you')!.entries), ['activity', 'wishlist']);
    // Off with no failures: the Wishlist alone.
    const off = sidebarGroups(
        ctx({ downloadsShown: false, lbBotAvailable: true, wishlistSupported: true }),
    ).groups;
    assert.deepEqual(ids(group(off, 'you')!.entries), ['wishlist']);
});

test('wishlist_absent_when_route_unsupported', () => {
    const unsupported = sidebarGroups(ctx({ lbBotAvailable: true, wishlistSupported: false }));
    assert.ok(!ids(group(unsupported.groups, 'you')!.entries).includes('wishlist'));
    // And without lb-bot, whatever the hub advertises.
    const down = sidebarGroups(ctx({ wishlistSupported: true }));
    assert.equal(group(down.groups, 'you'), undefined);
});

test('the attention badge is an admin one; Activity itself follows downloads', () => {
    const member = (patch: Partial<SidebarContext>) =>
        group(
            sidebarGroups(ctx({ admin: false, attentionCount: 2, lbBotAvailable: true, ...patch }))
                .groups,
            'you',
        );
    const on = member({ downloadsShown: true })!;
    assert.deepEqual(ids(on.entries), ['activity']);
    assert.equal('badge' in on.entries[0], false, 'no admin badge for a member');
    assert.equal(
        member({ downloadsShown: false }),
        undefined,
        'off: the failures are an admin matter',
    );
});
