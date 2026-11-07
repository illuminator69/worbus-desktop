/**
 * Which (history entry, list) pairs have already shown their arrivals (R4). React Router remounts a
 * page on Back, and a remounted list would open a fresh arrival window and replay every tile; a page
 * that asks this record first leaves the window closed, so a history entry arrives once. Pure and
 * bounded, for the harness: `limit` counts distinct entries, the least recently marked dropped first.
 *
 * `hold` is how several lists on one page share one list key (Home's shelves all use the empty key):
 * the first to open marks the pair, and a sibling that fills later in the same visit must still
 * arrive, so `arrives` stays true while any list that opened under that pair is mounted. Back to the
 * entry later has no holders, so nothing arrives.
 *
 * Marks follow `location.key`: a replace (the Library writing its search term into the URL, a click on
 * the page you are on) gives the same mounted page a new key, and the entry now in history is the one
 * Back will return to, so `settleVisit` marks the CURRENT entry every time the key changes, for every
 * mount that has decided (opened or skipped), and holds only for an opened window.
 */

export type ArrivedEntries = {
    /** True when a list opening now under this pair should arrive: never marked, or a holder is mounted. */
    arrives(entry: string, list: string): boolean;
    has(entry: string, list: string): boolean;
    /** Counts the caller as part of the visit that opened this pair; the returned function releases it (once). */
    hold(entry: string, list: string): () => void;
    mark(entry: string, list: string): void;
    size(): number;
};

const pairKey = (entry: string, list: string) => `${entry}\u0000${list}`;

export const createArrivedEntries = (limit: number): ArrivedEntries => {
    const marked = new Map<string, Set<string>>();
    const held = new Map<string, number>();

    const has = (entry: string, list: string) => marked.get(entry)?.has(list) ?? false;

    return {
        arrives: (entry, list) => !has(entry, list) || (held.get(pairKey(entry, list)) ?? 0) > 0,
        has,
        hold: (entry, list) => {
            const key = pairKey(entry, list);
            held.set(key, (held.get(key) ?? 0) + 1);
            let released = false;
            return () => {
                if (released) return;
                released = true;
                const left = (held.get(key) ?? 1) - 1;
                if (left > 0) held.set(key, left);
                else held.delete(key);
            };
        },
        mark: (entry, list) => {
            const lists = marked.get(entry) ?? new Set<string>();
            lists.add(list);
            // Re-inserting moves the entry to the newest end of the Map's insertion order.
            marked.delete(entry);
            marked.set(entry, lists);
            while (marked.size > Math.max(1, limit)) {
                const oldest = marked.keys().next().value;
                if (oldest === undefined) break;
                marked.delete(oldest);
            }
        },
        size: () => marked.size,
    };
};

/**
 * Whether a list opening now may arrive. A list that is not once-per-entry (a mood opened in place on
 * Home: a gesture, never a remount from history) always may.
 */
export const mayArrive = (
    record: ArrivedEntries,
    entry: string,
    list: string,
    once: boolean,
): boolean => !once || record.arrives(entry, list);

/**
 * What a decided mount does under its current entry: mark the pair, and hold it only when this mount
 * opened an arrival window. Returns the release (a no-op for a mount that only skipped). Run again for
 * every new entry, so the mark follows the page across replaces. A list that is not once-per-entry
 * leaves no mark and no hold.
 */
export const settleVisit = (
    record: ArrivedEntries,
    entry: string,
    list: string,
    opened: boolean,
    once = true,
): (() => void) => {
    if (!once) return () => {};
    record.mark(entry, list);
    return opened ? record.hold(entry, list) : () => {};
};

/** The app's record: the newest 200 history entries. */
export const arrivedEntries = createArrivedEntries(200);
