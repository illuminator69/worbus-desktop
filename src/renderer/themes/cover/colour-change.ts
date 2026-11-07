/**
 * How a cover change is shown (audit A-01). The wash's backdrop is drawn on two layers that each carry
 * fixed colours, and a change cross-fades their opacity, which the compositor animates. The page's own
 * roles (text, accent, surfaces) switch once, at the fade's midpoint: easing them meant restyling every
 * element on every frame. Pure: no app imports, so node can load it for the harness.
 */

import type { Role, Roles } from './cover-roles.ts';

import { oklchCss } from './oklch.ts';

/** The backdrop's cross-fade, with `--fold-ease` (design brief 8: colour changes ease over 300 ms). */
export const COLOUR_FADE_MS = 300;

/**
 * When the page's roles switch: the backdrop is half-way (53 %) on `--fold-ease`, which is front-loaded.
 * Half the time (150 ms) would be 92 % of the way, leaving the old text over the new backdrop.
 */
export const ROLE_SWITCH_MS = 60;

export type WashMode = 'dark' | 'light' | 'neutral';

/** The first application (a cold start, Cover colours turned on) and reduced motion switch at once. */
export const switchDelayMs = ({ first, reduced }: { first: boolean; reduced: boolean }): number =>
    first || reduced ? 0 : ROLE_SWITCH_MS;

/** How much of the band's tone the veil lays over the artwork, top and middle. */
const VEIL: Record<WashMode, [string, string]> = {
    dark: ['78%', '86%'],
    light: ['50%', '60%'],
    neutral: ['100%', '100%'],
};

const css = (role: Role) => oklchCss(role, role.a);

/** One backdrop layer's own variables: fixed colours, never a `var()` that would change under it. */
export const toneVars = (roles: Roles, mode: WashMode): Record<string, string> => ({
    '--tone-bar': css(roles.bar),
    '--tone-bot': css(roles.bot),
    '--tone-mid': css(roles.mid),
    '--tone-ov1': VEIL[mode][0],
    '--tone-ov2': VEIL[mode][1],
    '--tone-top': css(roles.top),
});

/** Two layers; the front one is shown (or fading in), the other is what it fades in over. */
export interface LayerPair<T> {
    front: 0 | 1;
    items: [null | T, null | T];
}

/**
 * Puts `next` on the other slot and makes it the front. The current front item stays in its slot:
 * it is what is shown, even if it was itself still fading in. Returns `pair` when `next` is already
 * the front item.
 */
export const flipLayers = <T>(
    pair: LayerPair<T>,
    next: T,
    same: (a: T, b: T) => boolean,
): LayerPair<T> => {
    const current = pair.items[pair.front];
    if (current !== null && same(current, next)) return pair;
    const front = pair.front === 0 ? 1 : 0;
    const items: LayerPair<T>['items'] = [...pair.items];
    items[front] = next;
    return { front, items };
};

/**
 * Light or dark is the user's choice, never the cover's: with `Use system theme` the system's, else
 * the Cover colours mode setting. A pale cover used to turn the whole window light, which was straining
 * on a large screen at the wrong moment; the cover now only tints the dark or the light palette.
 */
export const windowLight = (
    settings: { followSystemTheme: boolean; mode: 'dark' | 'light' },
    systemDark: boolean,
): boolean => (settings.followSystemTheme ? !systemDark : settings.mode === 'light');

/**
 * The artwork's opacity on a dark window by the cover's mean lightness. Covers that kept the window dark
 * before (up to 0.62, where it used to switch to light) glow exactly as before; paler ones glow less,
 * so the text roles keep 4.5:1 over them and the state colours never drop below what those darker
 * covers already gave them (cover-roles.harness.ts, darkWashOverPaleArtKeepsTextPassing). Interpolated
 * linearly between these points, each about 6 % under the most that passes there.
 */
const DARK_ART: [meanL: number, opacity: number][] = [
    [0.62, 0.55],
    [0.65, 0.455],
    [0.7, 0.38],
    [0.75, 0.325],
    [0.8, 0.28],
    [0.85, 0.248],
    [0.9, 0.22],
    [0.95, 0.2],
    [1, 0.182],
];

/** Light windows lift the artwork with white instead (window-wash.module.css); nothing playing has none. */
export const artOpacity = (meanL: number, mode: WashMode): number => {
    if (mode === 'light') return 0.85;
    if (mode === 'neutral') return 0;
    if (meanL <= DARK_ART[0][0]) return DARK_ART[0][1];
    for (let i = 1; i < DARK_ART.length; i++) {
        const [l1, o1] = DARK_ART[i];
        if (meanL <= l1) {
            const [l0, o0] = DARK_ART[i - 1];
            return o0 + ((o1 - o0) * (meanL - l0)) / (l1 - l0);
        }
    }
    return DARK_ART[DARK_ART.length - 1][1];
};
