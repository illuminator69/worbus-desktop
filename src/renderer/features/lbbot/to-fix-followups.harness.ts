import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import * as sidebar from '../sidebar/utils/sidebar-groups.ts';
import * as matches from './utils/matches-page.ts';

/**
 * B-406, review L2-L5 of the re-walk round (2026-11-13):
 *   node --test src/renderer/features/lbbot/to-fix-followups.harness.ts
 *
 * The move of To fix to Library Matches left four ends loose:
 * - L2: Activity's badge (settled failed + waiting for a pick) matched no chip: "Didn't land" also
 *   counts cancelled and stopped-tracking rows, so 3 on the badge read against 5 on the page.
 * - L3: "the result will show on Library Matches" (StillWorking, after an override job) landed on
 *   To fix, which now opens first, not on the result.
 * - L4: the command palette offered Library Matches on the override routes alone; the page said
 *   "does not offer library matches yet" above a working To fix; the collapsed rail read the bare
 *   number to a screen reader.
 * - L5: Activity's pointer line read a cached attention answer for a non-admin, linking to a page
 *   that sends them Home.
 */

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

type Row = { outcome: string; settled: boolean };
const LEDGER: Row[] = [
    { outcome: 'failed', settled: true },
    { outcome: 'failed', settled: true },
    { outcome: 'needsPick', settled: true },
    { outcome: 'cancelled', settled: true },
    { outcome: 'gaveUp', settled: true },
    { outcome: 'done', settled: true },
    { outcome: 'running', settled: false },
];

test('activity_has_a_chip_that_counts_what_its_badge_counts', async () => {
    const filters = (await import('./utils/activity-filters.ts').catch(() => null)) as null | {
        FILTER_LABEL: Record<string, string>;
        FILTER_ORDER: string[];
        LEDGER_MATCHES: Record<string, (row: Row) => boolean>;
    };
    assert.ok(filters, "the chips live in the route alone: none is the badge's set");
    const badge = sidebar.attentionCount(LEDGER);
    assert.equal(badge, 3);
    const same = filters.FILTER_ORDER.filter(
        (id) => LEDGER.filter(filters.LEDGER_MATCHES[id]).length === badge,
    );
    assert.ok(same.length > 0, `no chip reads ${badge}, the badge's number`);
    assert.match(filters.FILTER_LABEL[same[0]], /need you/i, 'the chip says what the badge says');
    const route = read('src/renderer/features/lbbot/routes/lbbot-downloads-route.tsx');
    assert.match(route, /activity-filters/, 'the page uses the shared chips');
});

test('still_working_links_to_the_result_not_to_fix', () => {
    const fromSearch = (matches as unknown as Record<string, unknown>).sectionFromSearch as
        | ((search: string) => matches.MatchSection | null)
        | undefined;
    assert.equal(typeof fromSearch, 'function', 'the page cannot be linked to a section');
    const counts = { albums: 2, artists: 4, merges: 1, toCheck: 3, toFix: 41 };
    assert.equal(matches.currentSection(fromSearch!('?section=albums'), counts), 'albums');
    assert.equal(matches.currentSection(fromSearch!('?section=merged'), counts), 'merged');
    assert.equal(fromSearch!('?section=nonsense'), null);
    assert.equal(matches.currentSection(fromSearch!(''), counts), 'to-fix');
    const still = read('src/renderer/features/lbbot/components/job-failures.tsx');
    assert.match(still, /section=/, 'StillWorking links to the bare page');
    assert.match(
        read('src/renderer/features/lbbot/components/album-match-modal.tsx'),
        /<StillWorking section="albums"/,
    );
    assert.match(
        read('src/renderer/features/lbbot/components/artist-merge-block.tsx'),
        /<StillWorking section="merged"/,
    );
    assert.match(
        read('src/renderer/features/library-matches/routes/library-matches-route.tsx'),
        /sectionFromSearch\(/,
    );
});

test('the_palette_offers_library_matches_whenever_the_sidebar_does', () => {
    const offered = (sidebar as unknown as Record<string, unknown>).libraryMatchesOffered as
        | ((ctx: {
              admin?: boolean;
              lbBotAvailable: boolean;
              overridesSupported: boolean;
              toFixCount?: number;
          }) => boolean)
        | undefined;
    assert.equal(typeof offered, 'function', 'the palette and the sidebar decide apart');
    const base = { admin: true, lbBotAvailable: true, overridesSupported: false, toFixCount: 41 };
    assert.equal(offered!(base), true, 'something to fix on a hub without the override routes');
    assert.equal(offered!({ ...base, toFixCount: 0 }), false);
    assert.equal(offered!({ ...base, overridesSupported: true, toFixCount: 0 }), true);
    assert.equal(offered!({ ...base, admin: false }), false, "an admin's page");
    const items = read('src/renderer/features/sidebar/components/navi-connect-items.ts');
    assert.match(items, /libraryMatchesOffered\(/, 'Go-to gates on the override routes alone');
});

test('the_page_does_not_say_no_matches_above_a_working_to_fix', () => {
    const line = (matches as unknown as Record<string, unknown>).hubMatchesLine as
        | ((overridesSupported: boolean, toFixOffered: boolean) => null | string)
        | undefined;
    assert.equal(typeof line, 'function', 'one line for every case');
    assert.match(line!(false, false)!, /does not offer library matches yet/);
    assert.doesNotMatch(line!(false, true)!, /does not offer library matches/);
    assert.match(line!(false, true)!, /artist and album matches/);
    assert.equal(line!(true, true), null);
    assert.match(
        read('src/renderer/features/library-matches/routes/library-matches-route.tsx'),
        /hubMatchesLine\(/,
    );
});

test('the_collapsed_rail_says_what_each_badge_counts', () => {
    const rail = read('src/renderer/features/sidebar/components/collapsed-sidebar.tsx');
    assert.match(
        rail,
        /entry\.badgeLabel \?\? entry\.badge/,
        'a screen reader hears a bare number',
    );
});

test('the_activity_pointer_is_shown_to_an_admin_only', () => {
    const route = read('src/renderer/features/lbbot/routes/lbbot-downloads-route.tsx');
    assert.match(
        route,
        /allows\([^)]*'needsAttention'\)/,
        'a cached answer shows a non-admin the line',
    );
});
