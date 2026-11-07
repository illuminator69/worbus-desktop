/**
 * F6: reading every album artist for the Library's Artists page, in pages, as a pure loop the hook
 * (`use-library-artists.ts`) drives and the harness can run against a real query cache.
 */

export const LIBRARY_PAGE = 500;
export const LIBRARY_MAX_ARTISTS = 20_000;
export const LIBRARY_FRESH_MS = 10 * 60 * 1000;

/**
 * The cached value has the shape every other album-artist list entry has (`items`, `startIndex`,
 * `totalRecordCount`), so the rating and favourite updaters can walk it. `partial` marks the pages
 * written while a first read is still going; `capped` a list that stopped at the row limit before the
 * server's total.
 */
export type LibraryArtistsData<T> = {
    capped?: boolean;
    items: T[];
    partial?: boolean;
    startIndex: number;
    totalRecordCount: null | number;
};

type Page<T> = null | undefined | { items?: T[]; totalRecordCount?: null | number };

/**
 * Reads pages of `LIBRARY_PAGE` until the server's total, an empty page or `max` rows. `onPage` sees
 * the list so far after every page but the last (the first read shows them as they arrive).
 */
export const readLibraryArtists = async <T>({
    fetchPage,
    max = LIBRARY_MAX_ARTISTS,
    onPage,
}: {
    fetchPage: (startIndex: number, limit: number) => Promise<Page<T>>;
    max?: number;
    onPage?: (soFar: LibraryArtistsData<T>) => void;
}): Promise<LibraryArtistsData<T>> => {
    const items: T[] = [];
    let total: null | number = null;
    for (;;) {
        const page = await fetchPage(items.length, LIBRARY_PAGE);
        const rows = page?.items ?? [];
        items.push(...rows);
        total = page?.totalRecordCount ?? total;
        const whole = rows.length === 0 || (total !== null && items.length >= total);
        if (whole || items.length >= max) {
            const capped = !whole && total !== null && total > items.length;
            return {
                items,
                startIndex: 0,
                totalRecordCount: total,
                ...(capped ? { capped: true } : {}),
            };
        }
        onPage?.({ items: [...items], partial: true, startIndex: 0, totalRecordCount: total });
    }
};

/**
 * How long a read list stays fresh. A partial one is always stale: a first read abandoned when the page
 * was left is cancelled and the cache keeps its last page as a success (the query's revert state is the
 * last manual write), so the next visit must read again rather than show it as the library for 10 minutes.
 */
export const libraryArtistsStaleTime = (data?: { partial?: boolean }): number =>
    data?.partial ? 0 : LIBRARY_FRESH_MS;
