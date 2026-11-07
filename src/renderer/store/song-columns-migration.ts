/**
 * Settings version 39 (F6): the Tracks table shows Rating and Bitrate (the Library board). A stored
 * column list replaces the defaults wholesale, so a new default column reaches an existing profile only
 * through this. It switches the two on where they exist and appends them where they do not; it never
 * removes, reorders or resizes anything. A column switched off on purpose is switched on once. Pure (no
 * imports, plain string ids), for the harness.
 */

// SONG_TABLE_COLUMNS' shapes for TableColumn.BIT_RATE and TableColumn.USER_RATING, enabled.
const ADDED = [
    { align: 'center', autoSize: false, id: 'bitRate', isEnabled: true, pinned: null, width: 100 },
    {
        align: 'center',
        autoSize: false,
        id: 'userRating',
        isEnabled: true,
        pinned: null,
        width: 100,
    },
] as const;

const ADDED_IDS = new Set<string>(ADDED.map((c) => c.id));

export const migrateSongColumns = <C extends { id: string; isEnabled: boolean }>(
    columns: readonly C[] | undefined,
): C[] | undefined => {
    if (!columns) return undefined;
    const out = columns.map((c) =>
        ADDED_IDS.has(c.id) && !c.isEnabled ? { ...c, isEnabled: true } : c,
    );
    for (const column of ADDED) {
        if (!out.some((c) => c.id === column.id)) out.push({ ...column } as unknown as C);
    }
    return out;
};
