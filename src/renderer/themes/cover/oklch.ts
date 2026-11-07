/**
 * OKLCH maths for the cover colour roles. Pure: no app imports.
 *
 * `Rgb` is gamma-encoded sRGB, each channel 0 to 1. The OKLab matrices are Bjorn Ottosson's
 * (https://bottosson.github.io/posts/oklab/).
 */

export interface Oklch {
    c: number;
    h: number;
    l: number;
}

export type Rgb = [number, number, number];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const oklchToLinear = ({ c, h, l }: Oklch): Rgb => {
    const rad = (h * Math.PI) / 180;
    const a = c * Math.cos(rad);
    const b = c * Math.sin(rad);
    const lms = [
        (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
        (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
        (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
    ];
    return [
        4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
        -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
        -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
    ];
};

const EPS = 1e-6;
const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -EPS && v <= 1 + EPS);

/** Gamut-mapped: chroma is multiplied by 0.97 until every linear channel is in range (at most 80 steps). */
export const oklchToRgb = (color: Oklch): Rgb => {
    let c = color.c;
    let linear = oklchToLinear(color);
    for (let i = 0; i < 80 && !inGamut(linear); i++) {
        c *= 0.97;
        linear = oklchToLinear({ ...color, c });
    }
    return linear.map((v) => toGamma(clamp01(v))) as Rgb;
};

export const rgbToOklch = (rgb: Rgb): Oklch => {
    const [r, g, b] = rgb.map(toLinear);
    const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
    const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
    const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
    const h = (Math.atan2(B, A) * 180) / Math.PI;
    return { c: Math.hypot(A, B), h: h < 0 ? h + 360 : h, l: L };
};

/** `fg` at `alpha` over opaque `bg`, blended in gamma-encoded sRGB the way CSS composites. */
export const composite = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
    fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb;

const luminance = (rgb: Rgb) => {
    const [r, g, b] = rgb.map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio, 1 to 21, order-independent. */
export const contrast = (a: Rgb, b: Rgb): number => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** `oklch(0.360 0.085 28)`, or `oklch(0.360 0.085 28 / 0.15)` with an alpha. */
export const oklchCss = ({ c, h, l }: Oklch, alpha?: number): string =>
    `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${Math.round(h)}${alpha === undefined ? '' : ` / ${alpha.toFixed(2)}`})`;

/** `rgb(12, 34, 56)`: the comma form the existing `rgb(` consumers parse. */
export const rgbCss = (rgb: Rgb): string =>
    `rgb(${rgb.map((v) => Math.round(clamp01(v) * 255)).join(', ')})`;
