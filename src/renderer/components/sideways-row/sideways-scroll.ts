/**
 * B-285: a row that scrolls sideways with no scrollbar, as pure decisions over its scroll metrics.
 *
 * Which sides have hidden content (the fades and the buttons follow it), where a button press goes,
 * and whether a wheel event is the row's to turn sideways or the page's.
 */

export interface SidewaysMetrics {
    clientWidth: number;
    scrollLeft: number;
    scrollWidth: number;
}

/**
 * `chrome`: the row sits in fixed chrome (the Library's chips, the side queue's), where a vertical
 * wheel has nothing else to scroll, so it scrolls the row. `page`: the row sits in a page that
 * scrolls vertically, which keeps the plain wheel; Shift+wheel and the buttons serve the row.
 */
export type SidewaysWheel = 'chrome' | 'page';

export interface WheelInput {
    ctrlKey: boolean;
    deltaMode: number;
    deltaX: number;
    deltaY: number;
    metaKey: boolean;
    shiftKey: boolean;
}

/** Chromium's pixels per wheel line (`deltaMode` 1). */
export const LINE_PX = 40;

/** A fractional scroll position (a 1.2 display scale) is at an end within this much. */
const EDGE_PX = 1;

/** A button moves the row by this share of its visible width, so one chip stays in view. */
const STEP_SHARE = 0.8;

const maxScroll = (row: SidewaysMetrics) => Math.max(0, row.scrollWidth - row.clientWidth);

const clamp = (value: number, row: SidewaysMetrics) => Math.min(Math.max(value, 0), maxScroll(row));

export const hiddenSides = (row: SidewaysMetrics): { end: boolean; start: boolean } => {
    const max = maxScroll(row);
    return {
        end: max >= EDGE_PX && row.scrollLeft < max - EDGE_PX / 2,
        start: max >= EDGE_PX && row.scrollLeft > EDGE_PX / 2,
    };
};

/** Where a scroll button press goes: most of a visible width that way, from where any glide ends. */
export const scrollStep = (
    row: SidewaysMetrics,
    direction: -1 | 1,
    from: number = row.scrollLeft,
): number => clamp(from + direction * row.clientWidth * STEP_SHARE, row);

/**
 * Where a wheel event takes the row, or `null` when the event is not the row's: a `page` row, a
 * Ctrl or Meta wheel (zoom, and a touchpad pinch, which arrives as a Ctrl+wheel), a Shift+wheel
 * or a mainly sideways delta (a touchpad, a tilt wheel: the browser's own), a row that
 * fits, or a row already at the end the wheel points to (the event goes on to the page). `from` is
 * where a glide in progress is heading, so quick notches add up.
 */
export const sidewaysWheelTarget = (
    row: SidewaysMetrics,
    event: WheelInput,
    wheel: SidewaysWheel,
    from: number = row.scrollLeft,
): null | number => {
    if (wheel !== 'chrome' || event.shiftKey || event.ctrlKey || event.metaKey) return null;
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return null;
    const max = maxScroll(row);
    if (max < EDGE_PX) return null;
    const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? row.clientWidth : 1;
    const delta = event.deltaY * unit;
    if (delta > 0 && from >= max - EDGE_PX) return null;
    if (delta < 0 && from <= EDGE_PX) return null;
    return clamp(from + delta, row);
};
