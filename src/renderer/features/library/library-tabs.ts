/**
 * F6: the Library frame's chips (design brief 7.2): Artists, Albums, Tracks; a divider; Mixes,
 * Playlists, Genres, Folders, Radio stations; and More for what the board does not draw (the album
 * artist table, all artists, Favorites, Discover). Each chip is a route; no path moves. The old sidebar
 * items' switches keep their meaning and now gate the chips they used to gate. Pure (routes as strings,
 * English default labels the component re-labels by id), for the harness.
 */

export type LibraryTab = { id: LibraryTabId; label: string; route: string };

export type LibraryTabId =
    | 'albumArtists'
    | 'albums'
    | 'allArtists'
    | 'artists'
    | 'discover'
    | 'favorites'
    | 'folders'
    | 'genres'
    | 'mixes'
    | 'playlists'
    | 'radio'
    | 'tracks';

export type LibraryTabs = { more: LibraryTab[]; primary: LibraryTab[]; secondary: LibraryTab[] };

export type LibraryTabsContext = {
    /** The persisted sidebar items switched off, by their old ids ('Genres', 'Radio', ...). */
    disabledIds: readonly string[];
    hasDiscoverSources: boolean;
    /** The hub setting is configured (not only connected): the Mixes chip does not come and go. */
    hubConfigured: boolean;
    routes: Record<LibraryTabId, string>;
};

const LABELS: Record<LibraryTabId, string> = {
    albumArtists: 'Album artists',
    albums: 'Albums',
    allArtists: 'All artists',
    artists: 'Artists',
    discover: 'Discover',
    favorites: 'Favorites',
    folders: 'Folders',
    genres: 'Genres',
    mixes: 'Mixes',
    playlists: 'Playlists',
    radio: 'Radio stations',
    tracks: 'Tracks',
};

// The old sidebar item that switches a chip off. Album artists, Albums, Tracks, Playlists and Artists
// have none: they are always there.
const SWITCHED_BY: Partial<Record<LibraryTabId, string>> = {
    allArtists: 'Artists-all',
    favorites: 'Favorites',
    folders: 'Folders',
    genres: 'Genres',
    radio: 'Radio',
};

export const libraryTabs = (ctx: LibraryTabsContext): LibraryTabs => {
    const disabled = new Set(ctx.disabledIds);
    const tab = (id: LibraryTabId): LibraryTab => ({
        id,
        label: LABELS[id],
        route: ctx.routes[id],
    });
    const shown = (id: LibraryTabId) => {
        const by = SWITCHED_BY[id];
        return !by || !disabled.has(by);
    };
    const pick = (ids: LibraryTabId[]) => ids.filter(shown).map(tab);

    const secondary: LibraryTabId[] = ['playlists', 'genres', 'folders', 'radio'];
    if (ctx.hubConfigured) secondary.unshift('mixes');
    const more: LibraryTabId[] = ['albumArtists', 'allArtists', 'favorites'];
    if (ctx.hasDiscoverSources) more.push('discover');

    return {
        more: pick(more),
        primary: pick(['artists', 'albums', 'tracks']),
        secondary: pick(secondary),
    };
};

/** The ids of the stored sidebar items that are switched off; the first occurrence of an id decides. */
export const disabledSidebarIds = (
    items: readonly { disabled: boolean; id: string }[] | undefined,
): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (item.disabled) out.push(item.id);
    }
    return out;
};

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** The chip a path selects: only a list page itself, never a detail page under it. */
export const libraryTabForPath = (pathname: string, tabs: LibraryTabs): LibraryTabId | null => {
    const path = trimSlash(pathname);
    for (const tab of [...tabs.primary, ...tabs.secondary, ...tabs.more]) {
        if (trimSlash(tab.route) === path) return tab.id;
    }
    return null;
};
