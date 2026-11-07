/**
 * The cover seed: one hue, how much of the cover is colourful, and how light it is, read from
 * sampled RGBA pixels. Also the light or dark choice. Pure: no app imports.
 */

import type { CoverSeed } from './cover-roles.ts';

import { rgbToOklch } from './oklch.ts';

const BINS = 36;
const BIN_WIDTH = 360 / BINS;
/** A pixel this close to the winning bin's centre joins its circular mean. */
const MEAN_WINDOW = 15;

const MIN_ALPHA = 128;
const MIN_CHROMA = 0.04;
const MIN_L = 0.1;
const MAX_L = 0.96;
/** Chromatic fraction below which the cover counts as grey, and from which chroma is full. */
const GREY_BELOW = 0.08;
const FULL_FROM = 0.25;

const LIGHT_AT = 0.74;
const DARK_AT = 0.62;

const hueDistance = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
};

/** `null` when no pixel has an alpha of 128 or more. `pixels` is RGBA, row by row. */
export const deriveCoverSeed = (
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
): CoverSeed | null => {
    const total = Math.min(width * height, Math.floor(pixels.length / 4));
    const hues: number[] = [];
    const weights: number[] = [];
    const bins = new Array<number>(BINS).fill(0);
    let counted = 0;
    let lightness = 0;

    for (let i = 0; i < total; i++) {
        const at = i * 4;
        if (pixels[at + 3] < MIN_ALPHA) continue;
        const { c, h, l } = rgbToOklch([
            pixels[at] / 255,
            pixels[at + 1] / 255,
            pixels[at + 2] / 255,
        ]);
        counted++;
        lightness += l;
        if (c < MIN_CHROMA || l < MIN_L || l > MAX_L) continue;
        const weight = c * c;
        hues.push(h);
        weights.push(weight);
        bins[Math.min(BINS - 1, Math.floor(h / BIN_WIDTH))] += weight;
    }

    if (counted === 0) return null;
    const meanL = lightness / counted;

    const fraction = hues.length / counted;
    if (fraction < GREY_BELOW) return { hue: 0, k: 0, meanL };
    const k = fraction < FULL_FROM ? 0.5 : 1;

    let best = 0;
    for (let b = 1; b < BINS; b++) if (bins[b] > bins[best]) best = b;
    const centre = best * BIN_WIDTH + BIN_WIDTH / 2;

    let x = 0;
    let y = 0;
    for (let i = 0; i < hues.length; i++) {
        if (hueDistance(hues[i], centre) > MEAN_WINDOW) continue;
        const rad = (hues[i] * Math.PI) / 180;
        x += weights[i] * Math.cos(rad);
        y += weights[i] * Math.sin(rad);
    }
    const hue = (Math.atan2(y, x) * 180) / Math.PI;
    return { hue: hue < 0 ? hue + 360 : hue, k, meanL };
};

/** Light at or above 0.74, dark at or below 0.62, and in between whichever it was. */
export const chooseLight = (meanL: number, previousLight: boolean): boolean =>
    meanL >= LIGHT_AT ? true : meanL <= DARK_AT ? false : previousLight;
