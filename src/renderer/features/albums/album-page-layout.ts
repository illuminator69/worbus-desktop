/**
 * The owned album page's About row: About, then the genres, tags, record label and links under it
 * (R13, B-243: the artist page's order; the board's `.two` put them side by side). Pure, so the
 * harness pins it.
 *
 * - `two`: both have something; About, then the tags and links.
 * - `about-only` / `side-only`: one has something; only that one.
 * - `none`: neither; the row is not rendered and the toolbar moves up.
 *
 * A pending About (the album's notes not read yet, or lb-bot's prose on its way with nothing
 * else to fill the slot) counts as About: its skeleton holds the left column, so the decision
 * is not made twice and the tracklist does not jump when the text lands.
 */
export type AboutRow = 'about-only' | 'none' | 'side-only' | 'two';

export const aboutRow = ({
    aboutLoading,
    hasAbout,
    linkCount,
    tagCount,
}: {
    aboutLoading: boolean;
    hasAbout: boolean;
    linkCount: number;
    tagCount: number;
}): AboutRow => {
    const left = hasAbout || aboutLoading;
    const right = tagCount > 0 || linkCount > 0;
    if (left && right) return 'two';
    if (left) return 'about-only';
    if (right) return 'side-only';
    return 'none';
};
