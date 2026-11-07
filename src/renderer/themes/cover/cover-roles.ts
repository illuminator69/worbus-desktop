/**
 * The cover colour roles: the playing cover's hue on fixed OKLCH lightness steps, chroma scaled
 * by the seed's `k`. Values are the Colour board's CSS. Pure: no app imports.
 */

import type { Rgb } from './oklch.ts';

import { composite, oklchToRgb } from './oklch.ts';

export interface CoverSeed {
    hue: number;
    k: number;
    meanL: number;
}

/** OKLCH; `a` is the alpha the role is painted at, opaque when absent. */
export interface Role {
    a?: number;
    c: number;
    h: number;
    l: number;
}

export interface Roles {
    acc: Role;
    accc: Role;
    accct: Role;
    accOn: Role;
    bad: Role;
    bar: Role;
    bot: Role;
    good: Role;
    light: boolean;
    line: Role;
    mid: Role;
    on: Role;
    on2: Role;
    surf: Role;
    surf2: Role;
    top: Role;
    warn: Role;
}

type SeededName = Exclude<keyof Roles, 'bad' | 'good' | 'light' | 'warn'>;
type StateName = 'bad' | 'good' | 'warn';

export const NEUTRAL_SEED: CoverSeed = { hue: 260, k: 0.22, meanL: 0.2 };

/** Lightness, chroma at `k = 1`, alpha. */
type Step = [l: number, c: number, a?: number];

const DARK: Record<SeededName, Step> = {
    acc: [0.88, 0.11],
    accc: [0.45, 0.09],
    accct: [0.94, 0.03],
    accOn: [0.2, 0.05],
    bar: [0.15, 0.04, 0.94],
    bot: [0.2, 0.055],
    line: [0.92, 0.03, 0.14],
    mid: [0.29, 0.07],
    on: [0.97, 0.012],
    on2: [0.91, 0.025],
    surf: [0.9, 0.03, 0.08],
    surf2: [0.9, 0.03, 0.15],
    top: [0.36, 0.085],
};

const LIGHT: Record<SeededName, Step> = {
    acc: [0.39, 0.15],
    accc: [0.8, 0.07],
    accct: [0.27, 0.05],
    accOn: [1, 0],
    bar: [0.975, 0.02, 0.97],
    bot: [0.84, 0.075],
    line: [0.3, 0.05, 0.16],
    mid: [0.92, 0.04],
    on: [0.2, 0.03],
    on2: [0.36, 0.045],
    surf: [0.3, 0.06, 0.07],
    surf2: [0.3, 0.06, 0.13],
    top: [0.95, 0.03],
};

/**
 * Error, warning and success text: constants per mode, not scaled by `k`. Converted once from the
 * board's `hsl` (`rgbToOklch`, rounded to what `oklchCss` writes; each renders within one channel
 * unit of its source). They differ from the board: the board's dark `bad`, light `warn`, `bad` and
 * `good` miss 4.5:1 on a page band, so each moved the fewest HSL lightness points that pass on all
 * three bands at every hue (F2 addendum 5.3). On the raised surface they do not all reach 4.5:1.
 *   dark:  warn hsl(40 92% 64%) as on the board; bad hsl(4 86% 75%) (board 70%); good hsl(150 55% 62%) as on the board.
 *   light: warn hsl(32 90% 25%) (board 30%); bad hsl(4 70% 36%) (board 40%); good hsl(150 60% 23%) (board 24%).
 */
const DARK_STATES: Record<StateName, Role> = {
    bad: { c: 0.125, h: 25, l: 0.759 },
    good: { c: 0.126, h: 160, l: 0.79 },
    warn: { c: 0.142, h: 82, l: 0.837 },
};

const LIGHT_STATES: Record<StateName, Role> = {
    bad: { c: 0.157, h: 29, l: 0.457 },
    good: { c: 0.09, h: 157, l: 0.429 },
    warn: { c: 0.099, h: 61, l: 0.441 },
};

export const rolesFor = (seed: CoverSeed, light: boolean): Roles => {
    const seeded = Object.fromEntries(
        Object.entries(light ? LIGHT : DARK).map(([name, [l, c, a]]) => [
            name,
            a === undefined
                ? { c: c * seed.k, h: seed.hue, l }
                : { a, c: c * seed.k, h: seed.hue, l },
        ]),
    ) as Record<SeededName, Role>;
    return { ...seeded, ...(light ? LIGHT_STATES : DARK_STATES), light };
};

/** The raised surface (`surf2` when `strong`, else `surf`) composited over a page band. */
export const surfaceOver = (roles: Roles, band: 'bot' | 'mid' | 'top', strong: boolean): Rgb => {
    const surface = strong ? roles.surf2 : roles.surf;
    return composite(oklchToRgb(surface), oklchToRgb(roles[band]), surface.a ?? 1);
};
