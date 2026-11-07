/**
 * The arrival grammar's timing (design brief 8): rows and tiles rise and fade once, the first few
 * one after another and the rest together, and only while their list's window is open. The window
 * opens on the first render with content and closes ARRIVAL_SETTLE_MS later, so a list that pages,
 * scrolls, refetches or re-renders afterwards never animates a tile again. Pure, for the harness.
 */

export const ARRIVAL_MS = 240;
export const ARRIVAL_STEP_MS = 30;
export const ARRIVAL_LEAD = 5;
export const ARRIVAL_REST_DELAY_MS = 150;
export const ARRIVAL_SETTLE_MS = 900;

export type ArrivalWindow = { openedAt: null | number };

/** 0, 30, 60, 90, 120 ms for the first five, then 150 ms for everything after. */
export const arrivalDelayMs = (index: number): number => {
    if (!Number.isFinite(index) || index < 0) return 0;
    const i = Math.floor(index);
    return i < ARRIVAL_LEAD ? i * ARRIVAL_STEP_MS : ARRIVAL_REST_DELAY_MS;
};

/** Opens the window the first time `ready` is true; a window never reopens. */
export const openArrival = (window: ArrivalWindow, now: number, ready: boolean): ArrivalWindow =>
    window.openedAt === null && ready ? { openedAt: now } : window;

/** The delay for an item that mounts at `now`, or null when the window is closed (or never opened). */
export const arrivalFor = (
    window: ArrivalWindow,
    now: number,
    index: number,
    settleMs: number = ARRIVAL_SETTLE_MS,
): null | { delayMs: number } => {
    if (window.openedAt === null || now - window.openedAt >= settleMs) return null;
    return { delayMs: arrivalDelayMs(index) };
};
