/**
 * B-197, B-325: an icon-only button's accessible name. Its own `aria-label` when it has one, else its
 * tooltip's text: the tooltip already says what the button does, and a screen reader otherwise says
 * only "button". A tooltip that is an element (not text) gives no name.
 */
export const iconButtonName = (ariaLabel: string | undefined, tooltipLabel: unknown) => {
    if (ariaLabel) return ariaLabel;
    return typeof tooltipLabel === 'string' && tooltipLabel.trim() ? tooltipLabel : undefined;
};
