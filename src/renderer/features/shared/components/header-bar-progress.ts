/**
 * How far the album and artist pages' sticky bar has faded in, from the hero title's position (B-216,
 * B-220). Spotify's grammar: as the title scrolls under the bar the bar's background, play button and
 * name fade in together, tied to the scroll over about 64 px, no slide and no jump. All positions are
 * viewport px, as `getBoundingClientRect` gives them.
 */
export const BAR_FADE_SPAN = 64;

/** 0 while the title's bottom is more than `span` below `barBottom`, 1 at or above it, linear between. */
export const headerBarProgress = ({
    barBottom,
    span,
    titleBottom,
}: {
    barBottom: number;
    span: number;
    titleBottom: number;
}): number => {
    if (titleBottom <= barBottom) return 1;
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (barBottom + span - titleBottom) / span));
};

/**
 * The line `headerBarProgress` measures against. Normally the bar's bottom; when the title rests (at
 * scroll 0) less than `span` under it, as the artist page's does, the line rises so the page opens with
 * the bar at 0 and the fade still takes the whole span of scroll.
 */
export const headerBarLine = ({
    barBottom,
    restTitleBottom,
    span,
}: {
    barBottom: number;
    restTitleBottom: number;
    span: number;
}): number => (span <= 0 ? barBottom : Math.min(barBottom, restTitleBottom - span));
