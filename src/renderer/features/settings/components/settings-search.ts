/**
 * What Settings search finds (F5). Pure and import-free (`settings-search.harness.ts`).
 *
 * A row matches on its title, its description (when that is text) and the words in its `keywords`
 * (the names people use that appear in no title: "hub", "cast", "library tools"). The query is
 * lower-case. A section whose title matches shows all its rows; a section with no row to show and
 * no extra block to show is not drawn at all, so a miss leaves no headings behind.
 */
export interface SearchableRow {
    description?: unknown;
    /** Comes and goes with state: kept, folded closed, while hidden (R30) - never in a search. */
    fold?: boolean;
    isHidden?: boolean;
    keywords?: readonly string[];
    title: string;
}

const has = (text: unknown, keyword: string): boolean =>
    typeof text === 'string' && text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());

export const matchesSearch = (keyword: string, row: SearchableRow): boolean => {
    if (keyword === '') return true;
    return (
        has(row.title, keyword) ||
        has(row.description, keyword) ||
        (row.keywords ?? []).some((word) => has(word, keyword))
    );
};

/** The rows of a section to draw for `keyword`: never a hidden one. */
export const sectionRows = <T extends SearchableRow>(
    keyword: string,
    sectionTitle: string,
    rows: readonly T[],
): T[] => {
    const visible = rows.filter((row) => !row.isHidden);
    if (keyword === '' || has(sectionTitle, keyword)) return visible;
    return visible.filter((row) => matchesSearch(keyword, row));
};

/**
 * Whether a section's `extra` block (a reorder list, the custom themes folder...) is drawn: always
 * without a query, otherwise when the section's title or one of the block's own words matches.
 */
export const extraShown = (
    keyword: string,
    sectionTitle: string,
    extraKeywords?: readonly string[],
): boolean =>
    keyword === '' ||
    has(sectionTitle, keyword) ||
    (extraKeywords ?? []).some((word) => has(word, keyword));

/** A section is drawn without a query, and with one only when it has something to show. */
export const sectionDrawn = (keyword: string, rowCount: number, extra: boolean): boolean =>
    keyword === '' || rowCount > 0 || extra;

/**
 * The rows a section draws, each with whether it is open (R30: the app's transitions, no snap). With
 * no query, a hidden row marked `fold` stays, closed, so it can fold open when its state changes
 * instead of appearing in one frame (and the rows under it move with it). A search draws only
 * visible matching rows, as {@link sectionRows}.
 */
export const foldedRows = <T extends SearchableRow>(
    keyword: string,
    sectionTitle: string,
    rows: readonly T[],
): { open: boolean; row: T }[] =>
    keyword === ''
        ? rows
              .filter((row) => !row.isHidden || row.fold)
              .map((row) => ({ open: !row.isHidden, row }))
        : sectionRows(keyword, sectionTitle, rows).map((row) => ({ open: true, row }));
