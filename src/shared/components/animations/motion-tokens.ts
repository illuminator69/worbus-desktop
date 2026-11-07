/**
 * Durations and easings for the two motion/react transitions the shell keeps (the sidebar and
 * rail crossfade, the command palette's group fold). Both turn off under reduced motion; CSS
 * motion uses the tokens in global.css (the arrival grammar, design brief 8).
 */

// Material 3 duration tokens (ms).
export const DURATION = {
    long1: 450,
    long2: 500,
    medium1: 250,
    medium2: 300,
} as const;

// Emphasized easings as cubic-bezier control points (motion/react `ease` arrays).
export type Bezier = [number, number, number, number];

export const EASING: Record<
    'emphasized' | 'emphasizedAccelerate' | 'emphasizedDecelerate',
    Bezier
> = {
    emphasized: [0.2, 0, 0, 1],
    emphasizedAccelerate: [0.3, 0, 0.8, 0.15],
    emphasizedDecelerate: [0.05, 0.7, 0.1, 1],
};

/**
 * The arrival grammar's rise as numbers, for motion/react transitions that must share it
 * (`--arrive-ms`, `--arrive-ease` in global.css, `arrive-rise` in arrival.module.css).
 */
export const KIT_RISE_PX = 8;
export const KIT_MS = 240;
export const KIT_EASE: Bezier = [0.2, 0.7, 0.2, 1];

/** The shell's own tween, as `global.css` sets it (`--motion-duration`, `--motion-ease`). */
export interface MotionClock {
    ease: Bezier;
    ms: number;
}

/** The values in `global.css`, used when the variables cannot be read or parsed. */
export const FALLBACK_CLOCK: MotionClock = { ease: [0.3, 0.7, 0.2, 1], ms: 300 };

const NUMBER = String.raw`(-?\d*\.?\d+)`;
const BEZIER = new RegExp(
    String.raw`cubic-bezier\(\s*${NUMBER}\s*,\s*${NUMBER}\s*,\s*${NUMBER}\s*,\s*${NUMBER}\s*\)`,
);

/** `300ms` or `0.3s` to milliseconds; `undefined` for anything else. */
export const parseCssTime = (value: string): number | undefined => {
    const match = new RegExp(String.raw`^${NUMBER}(ms|s)$`).exec(value.trim());
    if (!match) return undefined;
    return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
};

/** `cubic-bezier(a, b, c, d)` to the control points `motion/react` takes; `undefined` for anything else. */
export const parseCssBezier = (value: string): Bezier | undefined => {
    const match = BEZIER.exec(value);
    if (!match) return undefined;
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
};

let clock: MotionClock | undefined;

/**
 * The grid tween's duration and curve, read from the CSS variables once so a motion/react
 * transition can share the clock instead of keeping a second one. Cached after the first read.
 */
export const readMotionClock = (): MotionClock => {
    if (clock) return clock;
    if (typeof document === 'undefined') return FALLBACK_CLOCK;
    const style = getComputedStyle(document.documentElement);
    clock = {
        ease: parseCssBezier(style.getPropertyValue('--motion-ease')) ?? FALLBACK_CLOCK.ease,
        ms: parseCssTime(style.getPropertyValue('--motion-duration')) ?? FALLBACK_CLOCK.ms,
    };
    return clock;
};
