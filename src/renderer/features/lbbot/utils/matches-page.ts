/**
 * Library Matches (I-024): the pure decisions behind the page - which sections it
 * offers, which one it opens on, and what each row shows for its cover and whether
 * it is a link. `matches-page.harness.ts` runs it without React.
 */

export type MatchSection = 'albums' | 'artists' | 'merged' | 'to-check' | 'to-fix';

/**
 * How many rows each list holds, or null when lb-bot did not send the list (an
 * older lb-bot, or one that could not work it out): absent is not empty, so a null
 * section is not offered and a 0 is.
 */
export interface SectionCounts {
    albums: null | number;
    artists: null | number;
    merges: null | number;
    toCheck: null | number;
    /**
     * B-406: lb-bot's imports + folders to file (`libraryToFixCount`); null when there is no
     * `/lb/attention` answer (an older hub or lb-bot, lb-bot away). Optional for the callers from
     * before it: absent is null.
     */
    toFix?: null | number;
}

const LABELS: Record<MatchSection, string> = {
    albums: 'Albums',
    artists: 'Artists',
    merged: 'Merged names',
    'to-check': 'To check',
    'to-fix': 'To fix',
};

const countOf = (counts: SectionCounts, id: MatchSection): null | number =>
    id === 'to-fix'
        ? (counts.toFix ?? null)
        : id === 'to-check'
          ? counts.toCheck
          : id === 'artists'
            ? counts.artists
            : id === 'albums'
              ? counts.albums
              : counts.merges;

const ORDER: readonly MatchSection[] = ['to-fix', 'to-check', 'artists', 'albums', 'merged'];

export const matchSections = (
    counts: SectionCounts,
): { count: number; id: MatchSection; label: string }[] =>
    ORDER.flatMap((id) => {
        const count = countOf(counts, id);
        return count === null ? [] : [{ count, id, label: LABELS[id] }];
    });

/** The section the page opens on: the first that has something to do - To fix (B-406), then To
 *  check, when not empty, else Artists - else whatever is offered. */
export const landingSection = (counts: SectionCounts): MatchSection | null => {
    if ((counts.toFix ?? 0) > 0) return 'to-fix';
    if ((counts.toCheck ?? 0) > 0) return 'to-check';
    if (counts.artists !== null) return 'artists';
    return matchSections(counts)[0]?.id ?? null;
};

/** The user's choice while it is still offered, else the landing section. */
export const currentSection = (
    chosen: MatchSection | null,
    counts: SectionCounts,
): MatchSection | null =>
    chosen && countOf(counts, chosen) !== null ? chosen : landingSection(counts);

/**
 * What a row's picture and link are built from. `imageId` is a Navidrome id the row
 * already carries (the image component builds the URL locally: no request per row);
 * `imageUrl` is a cover lb-bot was given; neither means the app's placeholder.
 * `linkId` is the id of the artist or album page, only while that id is alive.
 */
export interface RowLook {
    imageId: null | string;
    imageUrl: null | string;
    linkId: null | string;
}

const NONE: RowLook = { imageId: null, imageUrl: null, linkId: null };

/** An artist row. `alive` is false for a row whose artist has left the library. */
export const artistLook = (input: { alive: boolean; ndArtistId: string }): RowLook =>
    input.alive && input.ndArtistId
        ? { imageId: input.ndArtistId, imageUrl: null, linkId: input.ndArtistId }
        : NONE;

/** An album row. `albumId` is "" while Navidrome has not indexed the retagged album. */
export const albumLook = (input: { albumId: string; coverUrl: string }): RowLook =>
    input.albumId
        ? { imageId: input.albumId, imageUrl: null, linkId: input.albumId }
        : { imageId: null, imageUrl: input.coverUrl || null, linkId: null };

/** A merged-names row shows the KEPT artist: the rewritten spelling's id is gone. */
export const mergedLook = (input: { into: { name: string; ndArtistId: string } }): RowLook =>
    artistLook({ alive: !!input.into.ndArtistId, ndArtistId: input.into.ndArtistId });
