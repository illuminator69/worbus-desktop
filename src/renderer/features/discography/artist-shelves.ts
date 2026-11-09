import type { ReleaseKind } from './release-kind.ts';

import { type DiscographyItem, sortItems } from './discography-model.ts';
import { DEFAULT_VIEW } from './discography-view.ts';

/**
 * The artist page's short shape: a "Popular releases" line and one line per release kind, picked
 * from the discography model's items. Popular releases is Worbus for Android's rule translated to this model.
 *
 * Pure: plain data in, plain data out; nothing from `/@/`.
 */

export interface KindLine {
    items: DiscographyItem[];
    kind: ReleaseKind;
    /** True when the kind has more releases than the line shows ("See all"). */
    more: boolean;
    total: number;
}

const isOwned = (item: DiscographyItem) =>
    item.ownership === 'owned' || item.ownership === 'partly';

/** The default discography view's order, so every line agrees with the page's full list. */
const inDefaultOrder = (items: DiscographyItem[]) => sortItems(items, DEFAULT_VIEW);

/**
 * What the artist is known for here: owned and partly owned releases by plays (ties newest year
 * first, no year last), then releases still syncing newest first, then missing albums (not EPs or
 * other kinds) newest first. Distinct by key, at most `limit`.
 */
export const popularReleases = (items: DiscographyItem[], limit: number): DiscographyItem[] => {
    const ordered = inDefaultOrder(items);
    // Array.prototype.sort is stable, so the default order (newest year first) breaks plays ties.
    const owned = ordered.filter(isOwned).sort((a, b) => b.plays - a.plays);
    const syncing = ordered.filter((item) => item.ownership === 'syncing');
    const missing = ordered.filter((item) => item.ownership === 'missing' && item.kind === 'album');
    const seen = new Set<string>();
    const picked: DiscographyItem[] = [];
    for (const item of [...owned, ...syncing, ...missing]) {
        if (picked.length >= limit) break;
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        picked.push(item);
    }
    return picked;
};

/**
 * One line per kind in `order`, skipping hidden kinds and kinds with no releases. A line takes the
 * kind's releases in the default discography view's order; it may repeat a release that Popular
 * releases shows.
 */
export const kindLines = (
    items: DiscographyItem[],
    order: ReleaseKind[],
    hidden: ReadonlySet<ReleaseKind>,
    limit: number,
): KindLine[] => {
    const ordered = inDefaultOrder(items);
    const lines: KindLine[] = [];
    for (const kind of order) {
        if (hidden.has(kind)) continue;
        const ofKind = ordered.filter((item) => item.kind === kind);
        if (ofKind.length === 0) continue;
        lines.push({
            items: ofKind.slice(0, limit),
            kind,
            more: ofKind.length > limit,
            total: ofKind.length,
        });
    }
    return lines;
};

/** Album ids of the owned and partly owned releases, in the default discography view's order. */
export const ownedPlayIds = (items: DiscographyItem[]): string[] =>
    inDefaultOrder(items).flatMap((item) =>
        isOwned(item) && item.albumId !== null ? [item.albumId] : [],
    );

export interface DiscographyChip {
    kind: DiscographyChipKind;
    /**
     * The release kinds the chip shows, in Settings' order. For Popular releases, the kinds its
     * pool draws from (every kind with a chip).
     */
    kinds: ReleaseKind[];
    total: number;
}

/**
 * R10 (B-219): Spotify's Discography, one row of tiles under a row of chips. Popular releases first,
 * then one chip per release kind the artist has, in Settings' order, kinds switched off left out.
 * Singles and EPs are one chip, as Spotify groups them; Appears on is never a chip (it keeps its own
 * row below, as Spotify's "Appears On" does).
 */
export type DiscographyChipKind = 'popular' | 'singles-and-eps' | ReleaseKind;

const CHIP_OF: Partial<Record<ReleaseKind, DiscographyChipKind>> = {
    ep: 'singles-and-eps',
    single: 'singles-and-eps',
};

const onShelf = (items: DiscographyItem[]) => items.filter((item) => item.kind !== 'appears-on');

/**
 * Popular releases' pool: Worbus for Android's rule over the kinds the chips show (never Appears on, never a kind
 * switched off in Settings, so Popular holds nothing the chip row beside it leaves out); when that
 * picks nothing (an artist with only missing singles, say), those kinds in the default order.
 */
const popularPool = (
    items: DiscographyItem[],
    shown: ReadonlySet<ReleaseKind>,
): DiscographyItem[] => {
    const shelf = onShelf(items).filter((item) => shown.has(item.kind));
    const popular = popularReleases(shelf, shelf.length);
    return popular.length > 0 ? popular : inDefaultOrder(shelf);
};

export const discographyChips = (
    items: DiscographyItem[],
    order: ReleaseKind[],
    disabled: ReadonlySet<ReleaseKind>,
): DiscographyChip[] => {
    const shelf = onShelf(items);
    const kinds: DiscographyChip[] = [];
    for (const kind of order) {
        if (kind === 'appears-on' || disabled.has(kind)) continue;
        const total = shelf.filter((item) => item.kind === kind).length;
        if (total === 0) continue;
        const chipKind = CHIP_OF[kind] ?? kind;
        const chip = kinds.find((entry) => entry.kind === chipKind);
        if (chip) {
            chip.kinds.push(kind);
            chip.total += total;
        } else {
            kinds.push({ kind: chipKind, kinds: [kind], total });
        }
    }
    const shown = kinds.flatMap((chip) => chip.kinds);
    const popular = popularPool(items, new Set(shown)).length;
    return popular > 0 ? [{ kind: 'popular', kinds: shown, total: popular }, ...kinds] : kinds;
};

/**
 * What the artist page's Discography line shows: its chips and row; its header and "Show all" over
 * an empty row; or nothing. `scannable`: lb-bot answered for this artist, so the discography page
 * that "Show all" opens has its scan. B-369: the line used to need a chip, and an artist whose
 * library albums are all Appears on has none, so the only route to the scan vanished with it.
 * With no lb-bot there is nothing that page could add, and the line stays away as before.
 */
export const discographyLine = (
    chips: DiscographyChip[],
    scannable: boolean,
): 'chips' | 'empty' | 'none' => {
    if (chips.length > 0) return 'chips';
    return scannable ? 'empty' : 'none';
};

/** The one row of tiles a chip shows: at most `itemsPerRow`, in the chip's order. */
export const chipRow = (
    items: DiscographyItem[],
    chip: DiscographyChip,
    itemsPerRow: number,
): DiscographyItem[] => {
    if (chip.kind === 'popular') {
        return popularPool(items, new Set(chip.kinds)).slice(0, itemsPerRow);
    }
    const kinds = new Set(chip.kinds);
    return inDefaultOrder(items.filter((item) => kinds.has(item.kind))).slice(0, itemsPerRow);
};
