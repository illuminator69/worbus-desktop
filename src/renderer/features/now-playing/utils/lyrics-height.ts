/**
 * How tall the queue panel's lyrics/visualiser area is (R8, B-226). The area sits in a strip under the
 * queue; the user drags its top edge and the height they leave it at is a setting. This is the rule
 * that keeps that height sane in whatever panel it lands in: the queue keeps its rows first.
 *
 * All sizes are px. `panel` is the height of the panel the queue, its header and the strip share (the
 * `queue-panel` container), `wanted` the height the user chose, null until they drag.
 */

/** The strip's own row, 40 px and its 1 px top border. The area is under it. */
export const STRIP_ROW_HEIGHT = 41;
/** A queue row (the side queue's songs; group captions are 32). */
export const QUEUE_ROW_HEIGHT = 48;
/** The queue header with every line shown, as the panel draws it from 580 px of height up. */
export const QUEUE_HEADER_FULL = 236;
/** The short-window header (queue-panel-header.module.css folds its lines at 580 px of panel). */
export const QUEUE_HEADER_SHORT = 82;
export const SHORT_PANEL_HEIGHT = 580;
/** The queue always keeps this many rows. */
export const QUEUE_MIN_ROWS = 3;
/** Untouched, the area leaves the queue this many rows when the panel is tall enough for both. */
export const QUEUE_DEFAULT_ROWS = 6;
export const LYRICS_MIN_HEIGHT = 120;
/** The area was never taller than this untouched (R6's strip). */
export const LYRICS_DEFAULT_MAX_HEIGHT = 320;

const headerFor = (panel: number) =>
    panel > SHORT_PANEL_HEIGHT ? QUEUE_HEADER_FULL : QUEUE_HEADER_SHORT;

/** The queue's rows left in `panel` under an area of `height` (fractions count). */
export const queueRowsLeft = ({ height, panel }: { height: number; panel: number }): number =>
    (panel - headerFor(panel) - STRIP_ROW_HEIGHT - height) / QUEUE_ROW_HEIGHT;

/** The tallest the area may be: the panel less its header, the strip's row and the queue's three rows. */
const maxHeight = (panel: number): number =>
    Math.max(0, panel - headerFor(panel) - STRIP_ROW_HEIGHT - QUEUE_MIN_ROWS * QUEUE_ROW_HEIGHT);

/**
 * The heights the handle can reach in `panel`, for its separator's ARIA range: the minimum, unless
 * the panel is too small for it (then the maximum wins, as in clampLyricsHeight), up to the maximum.
 */
export const lyricsHeightRange = (panel: number): { max: number; min: number } => {
    const max = maxHeight(panel);
    return { max, min: Math.min(LYRICS_MIN_HEIGHT, max) };
};

/**
 * The height the area takes. Never taller than `maxHeight`, which wins over the 120 px minimum: a
 * panel too small for both gives the queue its three rows first. `wanted` null is the default, six
 * queue rows or the 120 px minimum, and no taller than the strip used to be.
 */
export const clampLyricsHeight = ({
    panel,
    wanted,
}: {
    panel: number;
    wanted: null | number;
}): number => {
    const max = maxHeight(panel);
    const target =
        wanted === null
            ? Math.min(
                  LYRICS_DEFAULT_MAX_HEIGHT,
                  panel -
                      headerFor(panel) -
                      STRIP_ROW_HEIGHT -
                      QUEUE_DEFAULT_ROWS * QUEUE_ROW_HEIGHT,
              )
            : wanted;
    return Math.min(Math.max(target, LYRICS_MIN_HEIGHT), max);
};
