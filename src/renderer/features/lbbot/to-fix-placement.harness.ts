import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { SidebarContext } from '../sidebar/utils/sidebar-groups.ts';

import { sidebarGroups } from '../sidebar/utils/sidebar-groups.ts';
import * as pageLink from './lb-page-link.ts';
import * as matches from './utils/matches-page.ts';

/**
 * B-406, the owner's ruling (re-walk, 2026-11-13):
 *   node --test src/renderer/features/lbbot/to-fix-placement.harness.ts
 *
 * The "To fix" folders (and the imports row) belong on **Library Matches**, not on Activity.
 * Activity misreported: 41 on its sidebar badge while its All and In your library chips read 6,
 * because the badge added lb-bot's 16 imports and 25 folders to the ledger's failures and the chips
 * count downloads. Every count says what it counts:
 * - Activity's badge: the downloads that need you (the ledger's failures and picks), nothing else;
 * - Library Matches' badge and its To fix chip: lb-bot's imports + folders (the phone's units);
 * - the To fix section names both parts ("16 imports and 25 downloaded folders").
 * Nothing reachable becomes unreachable: Library Matches is offered whenever there is something to
 * fix, even on a hub without the override routes, and in the narrow sidebar its badge shows in
 * More.
 */

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const ANSWER = {
    counts: { failedGaps: 0, failedRequests: 0, folders: 25, imports: 16, picks: 0 },
    folders: [],
    foldersCut: 23,
};

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

const ctx = (patch: Record<string, unknown> = {}) =>
    ({
        attentionCount: 0,
        downloadsShown: true,
        lbBotAvailable: true,
        libraryItems: [],
        librarySelectedRoutes: [],
        listeningSupported: false,
        narrow: false,
        overridesSupported: true,
        routes,
        wishlistSupported: false,
        ...patch,
    }) as SidebarContext;

const entry = (model: ReturnType<typeof sidebarGroups>, id: string) =>
    [...model.groups.flatMap((g) => g.entries), ...model.more].find((e) => e.id === id);

test('the_library_to_fix_number_is_lbbots_imports_and_folders_alone', () => {
    const count = (pageLink as unknown as Record<string, unknown>).libraryToFixCount as
        | ((attention: unknown, downloadsOn: boolean) => number)
        | undefined;
    assert.equal(typeof count, 'function', 'no to-fix number apart from the ledger');
    assert.equal(count!(ANSWER, true), 41);
    assert.equal(count!(ANSWER, false), 16, 'downloading off: no folder is counted');
    assert.equal(count!(null, true), 0);
});

test('activity_counts_downloads_and_library_matches_counts_the_to_fix', () => {
    const model = sidebarGroups(ctx({ attentionCount: 1, toFixCount: 41 }));
    assert.equal(entry(model, 'activity')?.badge, 1, "Activity's badge adds lb-bot's to-fix");
    assert.equal(entry(model, 'libraryMatches')?.badge, 41, 'Library Matches has no badge');
    const none = sidebarGroups(ctx({ attentionCount: 0, toFixCount: 0 }));
    assert.equal('badge' in (entry(none, 'libraryMatches') ?? {}), false);
});

test('library_matches_stays_reachable_while_there_is_something_to_fix', () => {
    // A hub without the override routes: Library Matches was not offered at all.
    const older = sidebarGroups(ctx({ overridesSupported: false, toFixCount: 3 }));
    assert.ok(entry(older, 'libraryMatches'), 'the to-fix list is unreachable on this hub');
    assert.equal(entry(older, 'libraryMatches')?.badge, 3);
    const nothing = sidebarGroups(ctx({ overridesSupported: false, toFixCount: 0 }));
    assert.equal(entry(nothing, 'libraryMatches'), undefined, 'nothing to fix, nothing offered');
    const member = sidebarGroups(ctx({ admin: false, toFixCount: 3 }));
    assert.equal(entry(member, 'libraryMatches'), undefined, "an admin's page");
    // Narrow: Library tools fold into More, and the number goes with it.
    const narrow = sidebarGroups(ctx({ narrow: true, toFixCount: 41 }));
    assert.equal(narrow.more.find((e) => e.id === 'libraryMatches')?.badge, 41);
    const more = read('src/renderer/features/sidebar/components/sidebar-groups.tsx');
    const menu = more.slice(more.indexOf('export const SidebarMore'));
    assert.match(menu, /entry\.badge/, 'the More menu drops the badge');
});

test('library_matches_opens_on_to_fix_when_there_is_something', () => {
    const m = matches as unknown as {
        currentSection: (chosen: null | string, counts: Record<string, null | number>) => string;
        landingSection: (counts: Record<string, null | number>) => null | string;
        matchSections: (counts: Record<string, null | number>) => { count: number; id: string }[];
    };
    const counts = { albums: 2, artists: 4, merges: 0, toCheck: 5, toFix: 41 };
    assert.deepEqual(
        m.matchSections(counts).map((s) => s.id),
        ['to-fix', 'to-check', 'artists', 'albums', 'merged'],
    );
    assert.equal(m.landingSection(counts), 'to-fix');
    assert.equal(m.landingSection({ ...counts, toFix: 0 }), 'to-check');
    assert.equal(m.currentSection('to-fix', { ...counts, toFix: 0 }), 'to-fix', '0 is offered');
    const absent = { albums: null, artists: null, merges: null, toCheck: null, toFix: null };
    assert.deepEqual(m.matchSections(absent), [], 'no attention answer: no To fix chip');
    assert.equal(m.landingSection({ ...absent, toFix: 2 }), 'to-fix', 'a hub without overrides');
});

test('the_section_moved_and_says_what_it_counts', () => {
    const downloads = read('src/renderer/features/lbbot/routes/lbbot-downloads-route.tsx');
    assert.doesNotMatch(downloads, /<ToFixSection/, 'To fix is still on Activity');
    assert.doesNotMatch(downloads, /<ImportsRow/);
    const page = read('src/renderer/features/library-matches/routes/library-matches-route.tsx');
    assert.match(page, /<ToFixSection/, 'Library Matches has no To fix');
    const sidebar = read('src/renderer/features/sidebar/components/sidebar-groups.tsx');
    assert.match(sidebar, /attentionCount: attentionCount\(ledger\)/);
    assert.match(sidebar, /toFixCount: libraryToFixCount\(attention, downloadsOn\)/);
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    // The badge's own words, on hover and to a screen reader.
    assert.equal(en.page.sidebar.badge.activity_other, '{{count}} downloads need you');
    assert.equal(en.page.sidebar.badge.libraryMatches_other, '{{count}} to fix in lb-bot');
    // The section names its two parts; Activity says where they went.
    assert.equal(en.naviConnect.toFix.imports_other, '{{count}} imports');
    assert.equal(en.naviConnect.toFix.folders_other, '{{count}} downloaded folders to file');
    assert.ok(en.naviConnect.toFix.movedHere, "Activity's pointer to Library Matches");
    assert.match(downloads, /naviConnect\.toFix\.movedHere/);
});
