/**
 * navi-connect F7 (Call 3): one release-kind rule for an artist's discography, used for the albums
 * the library owns (Navidrome's tags) and for the ones lb-bot lists (MusicBrainz's types) alike, so
 * a missing live album and an owned one land in the same section.
 *
 * Pure: no imports from `/@/`, so the harness runs it under plain `node --test`.
 */

export type ReleaseKind =
    | 'album'
    | 'appears-on'
    | 'compilation'
    | 'ep'
    | 'live'
    | 'other'
    | 'remix'
    | 'single'
    | 'soundtrack';

/** The display order: the filter bar's chips, and the sections of kinds Settings does not list. */
export const RELEASE_KINDS: readonly ReleaseKind[] = [
    'album',
    'ep',
    'single',
    'compilation',
    'live',
    'soundtrack',
    'remix',
    'other',
    'appears-on',
];

/**
 * The Settings item whose switch and position each kind follows (Call 2: switched off means the
 * section starts collapsed). The strings are `ArtistReleaseTypeItem`'s in `settings.store.ts`,
 * copied because this file cannot import it; `use-discography-items.ts` checks them against the
 * enum at compile time.
 */
export const KIND_SETTING_ID = {
    album: 'releaseTypeAlbum',
    'appears-on': 'appearsOn',
    compilation: 'releaseTypeCompilation',
    ep: 'releaseTypeEp',
    live: 'releaseTypeLive',
    other: 'releaseTypeOther',
    remix: 'releaseTypeRemix',
    single: 'releaseTypeSingle',
    soundtrack: 'releaseTypeSoundtrack',
} as const satisfies Record<ReleaseKind, string>;

/** MusicBrainz secondary types that make a release Other whatever its primary type. */
const OTHER_SECONDARY = new Set([
    'audiobook',
    'audio drama',
    'demo',
    'dj-mix',
    'djmix',
    'field recording',
    'interview',
    'mixtape/street',
    'spokenword',
]);

/**
 * A release's kind from its types (primary and secondary, any case) and a compilation flag.
 * Compilation beats Live, then Soundtrack, then Remix; a secondary type such as demo or DJ-mix makes
 * it Other; then the primary type (Album, EP, Single); no type at all is an Album; anything else
 * (broadcast, other) is Other. Appears on is decided by the caller, from the album artist credit.
 */
export const releaseKindOf = (
    types: readonly string[],
    compilation: boolean,
): Exclude<ReleaseKind, 'appears-on'> => {
    const set = new Set(types.map((type) => type.trim().toLowerCase()).filter(Boolean));
    if (compilation || set.has('compilation')) return 'compilation';
    if (set.has('live')) return 'live';
    if (set.has('soundtrack')) return 'soundtrack';
    if (set.has('remix')) return 'remix';
    for (const type of set) if (OTHER_SECONDARY.has(type)) return 'other';
    if (set.has('album')) return 'album';
    if (set.has('ep')) return 'ep';
    if (set.has('single')) return 'single';
    return set.size === 0 ? 'album' : 'other';
};
