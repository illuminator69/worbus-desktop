/**
 * B-284: how the hero's action row fits its column, as pure functions over measured widths.
 *
 * - `full`: Play, the labelled buttons, then rating, favourite and more, on one line.
 * - `icons`: the labelled buttons show only their icon (the label is the name and the tooltip).
 * - `stacked`: even the icon row does not fit; it wraps, the end group starting its line at the left.
 *
 * Each mode's natural width is measured while that mode is on screen and kept until the row's
 * contents change, so folding to icons cannot make the row "fit" and unfold it again: the full
 * width compared against is the full layout's, not the folded one's.
 */

export type HeroActionsMode = 'full' | 'icons' | 'stacked';

export interface HeroActionsWidths {
    /** The labelled row's natural width, measured in `full`. */
    full?: number;
    /** The icon row's natural width, measured in `icons` or `stacked` (the same items). */
    icons?: number;
    /** What the row holds (labels, which end controls): a change forgets both widths. */
    key: string;
}

/** The items laid side by side: their widths plus one gap between each two. */
export const naturalRowWidth = (itemWidths: readonly number[], gap: number): number =>
    itemWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, itemWidths.length - 1) * gap;

/** Records the width the current mode shows. Returns the same object when nothing changed. */
export const rememberWidth = (
    widths: HeroActionsWidths,
    key: string,
    mode: HeroActionsMode,
    measured: number,
): HeroActionsWidths => {
    const base: HeroActionsWidths = widths.key === key ? widths : { key };
    const slot = mode === 'full' ? 'full' : 'icons';
    if (base === widths && widths[slot] === measured) return widths;
    return { ...base, [slot]: measured };
};

/**
 * The mode for a column `available` px wide. A width not measured yet is tried (rendered before
 * paint, then measured) rather than guessed: the full row first, then the icon row.
 */
export const heroActionsMode = (
    available: number,
    widths: Pick<HeroActionsWidths, 'full' | 'icons'>,
): HeroActionsMode => {
    if (widths.full === undefined || widths.full <= available) return 'full';
    if (widths.icons === undefined || widths.icons <= available) return 'icons';
    return 'stacked';
};
