/**
 * The band's box (R13 ruling M9): measured height plus its tail. A page hero's band (tail 0) ends
 * with the hero however short it is, so the overlay's 200 px floor (upstream's, for a band not yet
 * measured) is lifted for it; the bar's band, with its 64 px tail, keeps the floor as before.
 */
export const bandBox = ({
    height,
    tail,
}: {
    height: number;
    tail: number;
}): { height: string | undefined; minHeight: 0 | undefined } => ({
    height: height ? `${height + tail}px` : undefined,
    minHeight: height && tail === 0 ? 0 : undefined,
});
