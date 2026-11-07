/**
 * Settings version 38 (F5): Home's rows. The untouched old default takes the redesign's order and
 * the four new rows; a customised order keeps its order and flags and gains the new rows at the
 * end. Pure (plain string ids, no enum), for the harness.
 */
export type HomeItemRow = { disabled: boolean; id: string };

export const OLD_DEFAULT_HOME_ORDER = [
    'genres',
    'random',
    'recentlyAdded',
    'recentlyReleased',
    'recentlyPlayed',
    'mostPlayed',
    'playlists',
] as const;

export const NEW_DEFAULT_HOME_ORDER = [
    'recentlyAdded',
    'fresh',
    'mixes',
    'rediscovery',
    'recentlyPlayed',
    'mostPlayed',
    'random',
    'recentlyReleased',
    'similarArtists',
    'playlists',
    'genres',
] as const;

const NEW_ROWS = ['fresh', 'mixes', 'rediscovery', 'similarArtists'];

export const migrateHomeItems = (stored: HomeItemRow[] | undefined): HomeItemRow[] => {
    const seen = new Set<string>();
    const rows = (stored ?? []).filter((row) => !seen.has(row.id) && seen.add(row.id));

    if (rows.length === 0) {
        return NEW_DEFAULT_HOME_ORDER.map((id) => ({ disabled: false, id }));
    }

    const isOldDefault =
        rows.length === OLD_DEFAULT_HOME_ORDER.length &&
        rows.every((row, index) => row.id === OLD_DEFAULT_HOME_ORDER[index]);
    if (isOldDefault) {
        const disabled = new Set(rows.filter((row) => row.disabled).map((row) => row.id));
        return NEW_DEFAULT_HOME_ORDER.map((id) => ({ disabled: disabled.has(id), id }));
    }

    const added = NEW_ROWS.filter((id) => !seen.has(id)).map((id) => ({ disabled: false, id }));
    return [...rows.map((row) => ({ ...row })), ...added];
};

/** The feature carousel goes off for the old default pair only (on, single); `multiple` was a choice. */
export const homeFeatureShouldTurnOff = (general: {
    homeFeature?: boolean;
    homeFeatureStyle?: string;
}): boolean => general.homeFeature === true && general.homeFeatureStyle === 'single';
