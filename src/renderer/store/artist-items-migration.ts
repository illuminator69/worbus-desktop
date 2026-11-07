/**
 * Settings version 42 (R13, B-246): the artist page's Favourite songs section is gone (Popular shows
 * each song's rating and heart), and so is its switch. Its row leaves a stored order; every other row
 * keeps its place and its switch. Pure (plain string ids, no enum), for the harness.
 */
export type ArtistItemRow = { disabled: boolean; id: string };

export const REMOVED_ARTIST_ITEMS: readonly string[] = ['favoriteSongs'];

export const migrateArtistItems = (
    stored: ArtistItemRow[] | undefined,
): ArtistItemRow[] | undefined =>
    Array.isArray(stored)
        ? stored.filter((row) => !REMOVED_ARTIST_ITEMS.includes(String(row?.id)))
        : stored;
