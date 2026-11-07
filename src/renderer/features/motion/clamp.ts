/**
 * R13 (B-243): the About text on the album, artist and lb-bot pages folds to a few whole lines with
 * an arrow at the cut (`ClampFold`). Pure, for the harness; the component measures and moves.
 */

/** Lines an About shows while folded, on every page that has one. */
export const ABOUT_LINES = 5;

/** Under this many pixels a measure counts as on the line (subpixel layout). */
const ON_THE_LINE_PX = 1;

/** A vertical extent in pixels, from the top of the text. */
export interface LineBox {
    bottom: number;
    top: number;
}

/**
 * What a glyph run's rect lacks of its line box above and below: half of `line-height` (a computed
 * value, so pixels) less the run's height. `normal` or anything unparsed counts the run as the line.
 */
export const halfLeading = (lineHeight: string, runPx: number): number => {
    const px = Number.parseFloat(lineHeight);
    if (!lineHeight.trim().endsWith('px') || !(px > 0)) return 0;
    return Math.max(0, (px - runPx) / 2);
};

/**
 * The text's line boxes, top to bottom, from its glyph runs (each with its half-leading added):
 * runs that overlap by more than a subpixel are one line (a link or a bold word inside it), runs
 * that only touch are two. Empty runs are dropped.
 */
export const lineBoxes = (runs: LineBox[]): LineBox[] => {
    const lines: LineBox[] = [];
    const sorted = runs
        .filter((run) => run.bottom - run.top > 0)
        .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    for (const run of sorted) {
        const line = lines[lines.length - 1];
        if (line && run.top < line.bottom - ON_THE_LINE_PX) {
            line.bottom = Math.max(line.bottom, run.bottom);
        } else {
            lines.push({ bottom: run.bottom, top: run.top });
        }
    }
    return lines;
};

/**
 * The folded height: the bottom of line `lines` (never past the next line's top), when at least one
 * whole line follows it; null when the text has `lines` lines or fewer, so it shows whole with no
 * arrow. A paragraph gap after the last shown line is not shown.
 */
export const foldAt = (lines: LineBox[], count: number): null | number => {
    if (count < 1 || lines.length <= count) return null;
    return Math.min(lines[count - 1].bottom, lines[count].top);
};

/** How far under the bar's bottom a top comes to rest after the app scrolls: the shell's `--panel-gap`. */
export const PANEL_GAP_PX = 8;

/**
 * Closing (Review M3 and its follow-up): the whole scroll the close makes (negative: up), spread over
 * the fold by `foldProgress`. Zero when the arrow, rising by `shrink`, still ends at or below the
 * bar's bottom: with the arrow staying in view, the page does not move. Otherwise the About's top
 * (`aboutTop`, its label) settles `gap` under the bar, so the folded lines are what shows, never a
 * scroll down. Viewport pixels, read at the press.
 */
export const closeScroll = ({
    aboutTop,
    arrowTop,
    barBottom,
    gap = PANEL_GAP_PX,
    shrink,
}: {
    aboutTop: number;
    arrowTop: number;
    barBottom: number;
    gap?: number;
    shrink: number;
}): number => {
    if (arrowTop - shrink >= barBottom - ON_THE_LINE_PX / 2) return 0;
    return Math.min(0, Math.round(aboutTop - (barBottom + gap)));
};

/** How far a fold from `start` to `end` has got at `height`, 0 to 1 (1 when there is nothing to move). */
export const foldProgress = ({
    end,
    height,
    start,
}: {
    end: number;
    height: number;
    start: number;
}): number => {
    if (start === end) return 1;
    return Math.min(1, Math.max(0, (start - height) / (start - end)));
};
