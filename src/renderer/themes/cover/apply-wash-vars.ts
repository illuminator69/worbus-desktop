/**
 * The cover roles as CSS variables on `<html>`: the plan's role-to-token map. `washVars` is pure (no
 * app imports, nothing from a store or React); `applyWashVars` touches `document` only when called,
 * so node can import this file for the harness.
 */

import type { Role, Roles } from './cover-roles.ts';

import { oklchCss, oklchToRgb, rgbCss } from './oklch.ts';

const css = (role: Role) => oklchCss(role, role.a);

export const washVars = (roles: Roles): Record<string, string> => ({
    // Mantine's derived primary colours: text and links in the accent, fills in the filled accent,
    // the light variant on the accent container with its own text colour.
    '--mantine-color-anchor': 'var(--theme-colors-primary)',
    // Mantine's names point at the registered `--theme-colors-*` ones, so they ease with them.
    '--mantine-color-body': 'var(--theme-colors-background)',
    '--mantine-color-default-border': 'var(--theme-colors-border)',
    '--mantine-color-dimmed': 'var(--theme-colors-foreground-muted)',
    '--mantine-color-primary-filled': 'var(--theme-colors-primary-filled)',
    '--mantine-color-primary-filled-hover': 'var(--theme-colors-primary-filled)',
    '--mantine-color-primary-light': 'var(--wash-accc)',
    '--mantine-color-primary-light-color': 'var(--wash-accct)',
    '--mantine-color-primary-light-hover': 'var(--wash-accc)',
    '--mantine-color-primary-outline': 'var(--theme-colors-primary)',
    '--mantine-color-primary-outline-hover':
        'color-mix(in oklch, var(--theme-colors-primary-filled) 5%, transparent)',
    '--mantine-color-primary-text': 'var(--theme-colors-primary)',
    '--mantine-color-text': 'var(--theme-colors-foreground)',
    '--mantine-primary-color-contrast': 'var(--theme-colors-primary-contrast)',
    '--mantine-primary-color-filled': 'var(--theme-colors-primary-filled)',
    '--mantine-primary-color-filled-hover': 'var(--theme-colors-primary-filled)',
    '--mantine-primary-color-light': 'var(--wash-accc)',
    '--mantine-primary-color-light-color': 'var(--wash-accct)',
    '--mantine-primary-color-light-hover': 'var(--wash-accc)',
    '--theme-colors-background': css(roles.mid),
    '--theme-colors-background-alternate': css(roles.surf),
    '--theme-colors-border': css(roles.line),
    '--theme-colors-foreground': css(roles.on),
    '--theme-colors-foreground-muted': css(roles.on2),
    // As `rgb(r, g, b)` too: `generateColors` (chroma-js) and the `rgb(` parsers cannot read oklch.
    '--theme-colors-primary': rgbCss(oklchToRgb(roles.acc)),
    '--theme-colors-primary-contrast': css(roles.accOn),
    '--theme-colors-primary-filled': css(roles.acc),
    '--theme-colors-state-error': css(roles.bad),
    '--theme-colors-state-success': css(roles.good),
    '--theme-colors-state-warning': css(roles.warn),
    '--theme-colors-surface': css(roles.surf2),
    '--theme-colors-surface-foreground': css(roles.on),
    '--wash-acc': css(roles.acc),
    '--wash-accc': css(roles.accc),
    '--wash-accct': css(roles.accct),
    '--wash-bar': css(roles.bar),
    '--wash-bot': css(roles.bot),
    '--wash-mid': css(roles.mid),
    '--wash-surf': css(roles.surf),
    '--wash-surf2': css(roles.surf2),
    '--wash-top': css(roles.top),
});

const applied = new Set<string>();

/** Sets each variable on `<html>`; `null` removes every key this ever set. */
export const applyWashVars = (vars: null | Record<string, string>): void => {
    const style = document.documentElement.style;
    if (!vars) {
        for (const key of applied) style.removeProperty(key);
        applied.clear();
        return;
    }
    for (const [key, value] of Object.entries(vars)) {
        style.setProperty(key, value);
        applied.add(key);
    }
};
