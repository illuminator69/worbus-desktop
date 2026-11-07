import { KIND_SETTING_ID, RELEASE_KINDS, type ReleaseKind, releaseKindOf } from './release-kind.ts';

/**
 * navi-connect F7: an artist's discography as one list. The albums the library owns (Navidrome) and
 * the release-groups lb-bot's index knows (missing, partly owned, landed and waiting for the scan)
 * become one item each, with one kind and one ownership state, so a filter, a sort, a chip count and
 * a section heading are all read from the same list (one definition per count).
 *
 * Pure: plain data in, plain data out; nothing from `/@/`.
 */

export interface DiscographyItem {
    addedAt: null | number;
    albumId: null | string;
    fill: FillInput | null;
    gap: null | { groupId: string; present: number; total: number };
    /** The album id for an owned release, the release-group id otherwise. */
    key: string;
    kind: ReleaseKind;
    ownership: Ownership;
    plays: number;
    rgid: string;
    title: string;
    year: null | number;
}

export interface DiscographyView {
    dir: 'asc' | 'desc';
    own: 'all' | Ownership;
    sort: 'added' | 'plays' | 'title' | 'year';
    type: 'all' | ReleaseKind;
}

export interface FillInput {
    outcome: string;
    rgid: string;
    settled: boolean;
    state: string;
}

export interface OwnedAlbumInput {
    addedAt: null | number;
    /** False when the artist is only credited on tracks: the album is "Appears on". */
    creditedAsAlbumArtist: boolean;
    favorite: boolean;
    id: string;
    isCompilation: boolean;
    name: string;
    playCount: null | number;
    releaseTypes: string[];
    /** The album's MusicBrainz release-group id, '' when untagged. */
    rgid: string;
    year: null | number;
}

export type Ownership = 'missing' | 'owned' | 'partly' | 'syncing';

export interface ReleaseRowInput {
    groupId?: string;
    navidromeAlbumIds: string[];
    presentTracks?: number;
    primaryType: string;
    rgid: string;
    secondaryTypes: string[];
    status: 'complete' | 'incomplete' | 'missing' | 'untagged';
    title: string;
    totalTracks?: number;
    year: string;
}

export interface Section {
    collapsed: boolean;
    items: DiscographyItem[];
    kind: ReleaseKind;
    summary: string;
}

/**
 * Album titles compared the way a person would: case, accents, punctuation and parenthesised edition
 * suffixes all discarded, so "Kid A" and "Kid A (Remastered)" are one record. Deliberately stops
 * there: "Hail to the Thief - Live" is a different record, and hiding a real release is worse than
 * leaving a duplicate on screen. (Moved here from `withoutOwned` in use-lbbot.ts.)
 */
const titleKey = (title: string): string =>
    title
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[[({].*?[\])}]/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();

const yearOf = (year: string): null | number => {
    const n = Number.parseInt(year, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * One item per release. An owned album joins lb-bot's row by release-group id, else by the row naming
 * its Navidrome id; it takes its kind from that row (Call 6), and is partly owned when the row is
 * incomplete with a review group to act on. Rows nothing joined become missing (lb-bot says so) or
 * syncing (lb-bot no longer says missing but Navidrome has no album yet); a row that names a
 * Navidrome album the page has not listed is owned. A missing row whose title an owned album already
 * carries is dropped: lb-bot's index lags anything that puts an album in the library but a scan or a
 * fill. Fills join by release-group id.
 */
export const buildItems = (
    owned: OwnedAlbumInput[],
    rows: ReleaseRowInput[],
    fills: FillInput[],
): DiscographyItem[] => {
    const byRgid = new Map<string, ReleaseRowInput>();
    const byAlbumId = new Map<string, ReleaseRowInput>();
    for (const row of rows) {
        if (row.rgid) byRgid.set(row.rgid, row);
        for (const id of row.navidromeAlbumIds) byAlbumId.set(id, row);
    }
    const fillOf = new Map(fills.map((fill) => [fill.rgid, fill]));
    const joined = new Set<ReleaseRowInput>();
    const items: DiscographyItem[] = [];

    for (const album of owned) {
        const row = (album.rgid && byRgid.get(album.rgid)) || byAlbumId.get(album.id);
        if (row) joined.add(row);
        const compilation =
            album.isCompilation ||
            album.releaseTypes.some((type) => type.trim().toLowerCase() === 'compilation');
        const kind: ReleaseKind = !album.creditedAsAlbumArtist
            ? 'appears-on'
            : releaseKindOf(
                  row ? [row.primaryType, ...row.secondaryTypes] : album.releaseTypes,
                  compilation,
              );
        const partly = row?.status === 'incomplete' && !!row.groupId;
        const rgid = album.rgid || row?.rgid || '';
        items.push({
            addedAt: album.addedAt,
            albumId: album.id,
            fill: (rgid && fillOf.get(rgid)) || null,
            gap: partly
                ? {
                      groupId: row!.groupId!,
                      present: row!.presentTracks ?? 0,
                      total: row!.totalTracks ?? 0,
                  }
                : null,
            key: album.id,
            kind,
            ownership: partly ? 'partly' : 'owned',
            plays: album.playCount ?? 0,
            rgid,
            title: album.name,
            year: album.year && album.year > 0 ? album.year : null,
        });
    }

    const ownedTitles = new Set(owned.map((album) => titleKey(album.name)).filter(Boolean));
    // One tile per Navidrome album: a second row naming an album already drawn is not drawn again.
    const drawnAlbums = new Set(owned.map((album) => album.id));
    for (const row of rows) {
        if (joined.has(row)) continue;
        if (row.navidromeAlbumIds.some((id) => drawnAlbums.has(id))) continue;
        const albumId = row.navidromeAlbumIds[0] ?? null;
        const key = titleKey(row.title);
        if (!albumId && key && ownedTitles.has(key)) continue;
        if (albumId) drawnAlbums.add(albumId);
        const fill = fillOf.get(row.rgid) ?? null;
        // A fill that landed (placed, or done) is waiting for the index and Navidrome, never Missing.
        const landed =
            !!fill &&
            ((fill.settled && fill.outcome === 'done') ||
                fill.state === 'placed' ||
                fill.state === 'verified');
        items.push({
            addedAt: null,
            albumId,
            fill,
            gap: null,
            key: albumId ?? row.rgid,
            kind: releaseKindOf([row.primaryType, ...row.secondaryTypes], false),
            ownership: albumId
                ? 'owned'
                : row.status === 'missing' && !landed
                  ? 'missing'
                  : 'syncing',
            plays: 0,
            rgid: row.rgid,
            title: row.title,
            year: yearOf(row.year),
        });
    }
    return items;
};

export const filterItems = (items: DiscographyItem[], view: DiscographyView): DiscographyItem[] =>
    items.filter(
        (item) =>
            (view.type === 'all' || item.kind === view.type) &&
            (view.own === 'all' || item.ownership === view.own),
    );

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const isOwned = (item: DiscographyItem) =>
    item.ownership === 'owned' || item.ownership === 'partly';

/** Year, newest first; no year last; ties by title. */
const byYearDesc = (a: DiscographyItem, b: DiscographyItem) =>
    (b.year ?? -Infinity) - (a.year ?? -Infinity) || collator.compare(a.title, b.title);

/**
 * Year and Title order every release together. Your plays and Recently added only mean something for
 * an album you own, so the owned albums come first in that order (the direction flips them) and the
 * rest follow by year, newest first, whatever the direction.
 */
export const sortItems = (items: DiscographyItem[], view: DiscographyView): DiscographyItem[] => {
    const sign = view.dir === 'asc' ? 1 : -1;
    const sorted = [...items];
    if (view.sort === 'title') {
        return sorted.sort((a, b) => sign * collator.compare(a.title, b.title) || byYearDesc(a, b));
    }
    if (view.sort === 'year') {
        return sorted.sort((a, b) => {
            if (a.year === null || b.year === null) {
                return (
                    (a.year === null ? 1 : 0) - (b.year === null ? 1 : 0) ||
                    collator.compare(a.title, b.title)
                );
            }
            return sign * (a.year - b.year) || collator.compare(a.title, b.title);
        });
    }
    const value = (item: DiscographyItem): null | number =>
        view.sort === 'plays' ? item.plays : item.addedAt;
    const owned = sorted.filter(isOwned).sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (va === null || vb === null)
            return (va === null ? 1 : 0) - (vb === null ? 1 : 0) || byYearDesc(a, b);
        return sign * (va - vb) || byYearDesc(a, b);
    });
    const rest = sorted.filter((item) => !isOwned(item)).sort(byYearDesc);
    return [...owned, ...rest];
};

/** A chip's count: the releases of that kind before any filter. Kinds with none are absent. */
export const chipCounts = (
    items: DiscographyItem[],
): { all: number; byKind: Partial<Record<ReleaseKind, number>> } => {
    const byKind: Partial<Record<ReleaseKind, number>> = {};
    for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
    return { all: items.length, byKind };
};

const OWNERSHIP_WORDS: [Ownership, string][] = [
    ['owned', 'owned'],
    ['partly', 'partly'],
    ['missing', 'missing'],
    ['syncing', 'syncing'],
];

/** "4 releases · 2 owned, 1 partly, 1 missing"; the breakdown only when more than one state is there. */
export const summaryOf = (items: DiscographyItem[]): string => {
    const head = `${items.length} ${items.length === 1 ? 'release' : 'releases'}`;
    const parts = OWNERSHIP_WORDS.flatMap(([state, word]) => {
        const n = items.filter((item) => item.ownership === state).length;
        return n > 0 ? [`${n} ${word}`] : [];
    });
    return parts.length > 1 ? `${head} · ${parts.join(', ')}` : head;
};

/**
 * Each kind's place and switch, read from Settings' release-type list through `KIND_SETTING_ID`:
 * the kinds it lists in its order, the kinds it does not list after them in display order, and the
 * kinds whose item is switched off. The discography collapses those; the artist page leaves them out.
 */
export const kindSettings = (
    settings: { disabled: boolean; id: string }[],
): { disabled: Set<ReleaseKind>; order: ReleaseKind[] } => {
    const position = new Map(settings.map((item, index) => [item.id, index]));
    const off = new Set(settings.filter((item) => item.disabled).map((item) => item.id));
    const rank = (kind: ReleaseKind) =>
        position.get(KIND_SETTING_ID[kind]) ?? settings.length + RELEASE_KINDS.indexOf(kind);
    return {
        disabled: new Set(RELEASE_KINDS.filter((kind) => off.has(KIND_SETTING_ID[kind]))),
        order: [...RELEASE_KINDS].sort((a, b) => rank(a) - rank(b)),
    };
};

/**
 * The sections of the (already filtered and sorted) items: one per kind present, in the order of each
 * kind's Settings item, kinds Settings does not list after them in display order. A kind switched
 * off in Settings starts collapsed (Call 2) unless the view asks for exactly that kind.
 */
export const sectionsOf = (
    items: DiscographyItem[],
    view: DiscographyView,
    settings: { disabled: boolean; id: string }[],
): Section[] => {
    const { disabled, order } = kindSettings(settings);
    const groups = new Map<ReleaseKind, DiscographyItem[]>();
    for (const item of items) {
        const list = groups.get(item.kind);
        if (list) list.push(item);
        else groups.set(item.kind, [item]);
    }
    const rank = (kind: ReleaseKind) => order.indexOf(kind);
    return [...groups.entries()]
        .sort(([a], [b]) => rank(a) - rank(b))
        .map(([kind, list]) => ({
            collapsed: disabled.has(kind) && view.type !== kind,
            items: list,
            kind,
            summary: summaryOf(list),
        }));
};
