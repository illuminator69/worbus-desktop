/**
 * Where a pinned table row sits in the window: under the window bar, the top bar and the page's
 * own sticky title row (`PageHeader`). All three heights are the shell's CSS variables, set on the
 * default layout (`default-layout.module.css`): `--window-bar-height` is 30 px under the Windows
 * and macOS bars and 0 otherwise, `--top-bar-height` is 0 on the login and action-required shells.
 * Read from an element inside the layout; a variable that is not set counts as 0.
 */
export const SHELL_PINNED_TOP_VARS = [
    '--window-bar-height',
    '--top-bar-height',
    '--page-header-height',
] as const;

export const shellPinnedTop = (style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): number =>
    SHELL_PINNED_TOP_VARS.reduce(
        (sum, name) => sum + (Number.parseFloat(style.getPropertyValue(name)) || 0),
        0,
    );

/** The pinned header's bottom border: the disc row starts below it. */
const PINNED_HEADER_BORDER = 1;

/**
 * The viewport lines the pinned rows sit under (B-221): the header under `pinLine` (the bar's bottom,
 * `shellPinnedTop`), the disc row directly under the header when the header is pinned, else under
 * `pinLine` itself.
 */
export const pinnedRowTops = ({
    headerHeight,
    headerShown,
    pinLine,
}: {
    headerHeight: number;
    headerShown: boolean;
    pinLine: number;
}): { group: number; header: number } => ({
    group: headerShown ? pinLine + headerHeight + PINNED_HEADER_BORDER : pinLine,
    header: pinLine,
});

/**
 * Where to write a pinned row, a `position: fixed` element, so it sits at viewport `top` across the
 * table. `blockOrigin` is the viewport position of the block it is fixed to: (0, 0) for the viewport,
 * the page's own corner while an ancestor carries a transform (`<main>` during its 220 ms arrival),
 * which turns that ancestor into the containing block.
 */
export const pinnedRowBox = ({
    blockOrigin,
    table,
    top,
}: {
    blockOrigin: { x: number; y: number };
    table: { left: number; width: number };
    top: number;
}): { left: number; top: number; width: number } => ({
    left: table.left - blockOrigin.x,
    top: top - blockOrigin.y,
    width: table.width,
});
