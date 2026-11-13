/**
 * Which groups and entries the sidebar shows, from the runtime gates and the persisted
 * `sidebarItems`. The expanded sidebar, the collapsed rail and the mobile drawer all render
 * this one model. Pure: no imports, no enum (the harness runs under `node --test`), so the
 * routes arrive as strings and the labels are English defaults the component re-labels by id.
 */

export interface SidebarContext {
    /**
     * Worbus P2: the signed-in user is an admin (`hub.store.user`). Absent (every caller before
     * P2, an older hub) is today's behaviour: shown. The attention badge and Library Matches are
     * admin surfaces; Activity follows `downloadsShown` (B-374).
     */
    admin?: boolean;
    /** Activity's badge: the downloads that need you (the ledger's failures and picks). */
    attentionCount: number;
    /**
     * Worbus P1: lb-bot can download (its mode is not "off"; unknown = an older peer = true).
     * While false, Activity shows only for an admin with failed ledger rows.
     */
    downloadsShown: boolean;
    lbBotAvailable: boolean;
    /** The persisted `sidebarItems`: only their opt-in Now Playing and Search entries are rows now. */
    libraryItems: { disabled: boolean; id: string; label: string; route: string }[];
    /** Every list page the Library frame wraps: the Library row is selected on each. */
    librarySelectedRoutes: readonly string[];
    listeningSupported: boolean;
    narrow: boolean;
    overridesSupported: boolean;
    routes: SidebarRoutes;
    /**
     * B-406 (the owner's ruling, 2026-11-13): Library Matches' badge, lb-bot's imports + folders to
     * file (`libraryToFixCount`). It also offers Library Matches on a hub without the override
     * routes, so the To fix list is never unreachable. Absent is 0.
     */
    toFixCount?: number;
    /** Worbus P1 (F3): the hub proxies `GET /lb/wishlist`. */
    wishlistSupported: boolean;
}

export interface SidebarEntry {
    badge?: number;
    /** B-406: what the badge counts, in words (the component's i18n; hover and screen reader). */
    badgeLabel?: string;
    id: string;
    label: string;
    route: string;
    /** What marks the entry selected when it differs from `route`; `''` means never. */
    selectedRoute?: string;
    /** Every path that marks the entry selected (the Library row's chip pages); wins over `selectedRoute`. */
    selectedRoutes?: string[];
}

export interface SidebarGroup {
    entries: SidebarEntry[];
    id: SidebarGroupId;
    label?: string;
}

export type SidebarGroupId = 'app' | 'libraryTools' | 'listening' | 'main' | 'you';

export interface SidebarRoutes {
    activity: string;
    fresh: string;
    home: string;
    library: string;
    libraryMatches: string;
    listening: string;
    savedQueues: string;
    settings: string;
    wishlist: string;
}

// F6: the Library items are the Library frame's chips; these two opt-in pages are not, and stay rows.
const EXTRA_ROWS = new Set(['Now Playing', 'Search']);

/** The enabled, routed Now Playing and Search items, in the stored order; the first occurrence decides. */
const extraRows = (ctx: SidebarContext): SidebarEntry[] => {
    const rows: SidebarEntry[] = [];
    const seen = new Set<string>();
    for (const item of ctx.libraryItems) {
        // A later duplicate is the index merge's tail: the user's own entry, first, decides.
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (!EXTRA_ROWS.has(item.id) || item.disabled || !item.route) continue;
        rows.push({ id: item.id, label: item.label, route: item.route });
    }
    return rows;
};

export const sidebarGroups = (
    ctx: SidebarContext,
): { groups: SidebarGroup[]; more: SidebarEntry[] } => {
    const { routes } = ctx;
    const lb = ctx.lbBotAvailable;

    const main: SidebarEntry[] = [
        { id: 'home', label: 'Home', route: routes.home },
        {
            id: 'library',
            label: 'Library',
            route: routes.library,
            selectedRoutes: [...ctx.librarySelectedRoutes],
        },
        ...extraRows(ctx),
    ];
    if (lb) main.push({ id: 'fresh', label: 'Fresh', route: routes.fresh });

    const you: SidebarEntry[] = [];
    // B-374: one entry for the one page (/downloads). The attention count (B-406: the downloads
    // that need you, nothing of lb-bot's own to-fix) is an admin's, so it is their badge.
    // Downloading off: nothing new is fetched, so Activity stays only for an admin while the
    // ledger holds failures from an earlier "on" period, which would otherwise be unreachable.
    const admin = ctx.admin !== false;
    const attention = admin && ctx.attentionCount > 0;
    if (lb && (ctx.downloadsShown || attention)) {
        you.push({
            id: 'activity',
            label: 'Activity',
            route: routes.activity,
            ...(attention ? { badge: ctx.attentionCount } : {}),
        });
    }
    // The Wishlist in both modes: while off it is where a missing album is kept for later.
    if (lb && ctx.wishlistSupported) {
        you.push({ id: 'wishlist', label: 'Wishlist', route: routes.wishlist });
    }

    const listening: SidebarEntry[] = [];
    if (ctx.listeningSupported) {
        listening.push({ id: 'statistics', label: 'Statistics', route: routes.listening });
    }
    listening.push({ id: 'savedQueues', label: 'Saved queues', route: routes.savedQueues });

    // B-406: Library Matches holds the To fix list too, with its own badge.
    const toFix = admin ? (ctx.toFixCount ?? 0) : 0;
    const libraryTools: SidebarEntry[] =
        lb && admin && (ctx.overridesSupported || toFix > 0)
            ? [
                  {
                      id: 'libraryMatches',
                      label: 'Library Matches',
                      route: routes.libraryMatches,
                      ...(toFix > 0 ? { badge: toFix } : {}),
                  },
              ]
            : [];

    const app: SidebarEntry[] = [{ id: 'settings', label: 'Settings', route: routes.settings }];

    const upper: SidebarGroup[] = [
        { entries: main, id: 'main' },
        { entries: you, id: 'you', label: 'You' },
    ];
    const lower: SidebarGroup[] = [
        { entries: listening, id: 'listening', label: 'Listening' },
        { entries: libraryTools, id: 'libraryTools', label: 'Library tools' },
        { entries: app, id: 'app', label: 'App' },
    ];
    const present = (groups: SidebarGroup[]) => groups.filter((g) => g.entries.length > 0);

    if (ctx.narrow) {
        return { groups: present(upper), more: lower.flatMap((g) => g.entries) };
    }
    return { groups: present([...upper, ...lower]), more: [] };
};

/** Settled fills the user has to act on: failed, or waiting for a pick. */
export const attentionCount = (rows: readonly { outcome: string; settled: boolean }[]): number =>
    rows.filter((r) => r.settled && (r.outcome === 'failed' || r.outcome === 'needsPick')).length;
