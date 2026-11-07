import assert from 'node:assert/strict';
import test from 'node:test';

import { washVars } from './apply-wash-vars.ts';
import { rolesFor } from './cover-roles.ts';

/**
 * F2 Task 4:  node --test src/renderer/themes/cover/apply-wash-vars.harness.ts
 *
 * The role-to-token map the window wash writes on `<html>` (plan, "Role to token map"; the warning
 * token is `state-warning`, F2 addendum 5.2).
 */

const MAP_KEYS = [
    '--theme-colors-background',
    '--mantine-color-body',
    '--theme-colors-background-alternate',
    '--theme-colors-surface',
    '--theme-colors-surface-foreground',
    '--theme-colors-foreground',
    '--mantine-color-text',
    '--theme-colors-foreground-muted',
    '--mantine-color-dimmed',
    '--theme-colors-primary',
    '--theme-colors-primary-filled',
    '--mantine-primary-color-filled',
    '--theme-colors-primary-contrast',
    '--mantine-primary-color-contrast',
    '--theme-colors-border',
    '--mantine-color-default-border',
    '--theme-colors-state-error',
    '--theme-colors-state-warning',
    '--theme-colors-state-success',
    '--wash-top',
    '--wash-mid',
    '--wash-bot',
    '--wash-bar',
    '--wash-surf',
    '--wash-surf2',
    '--wash-acc',
    '--wash-accc',
    '--wash-accct',
    // Task 7's sweep: Mantine's derived primary colours (the `c="primary"` text, links, light and
    // outline variants), which still wore the theme's accent.
    '--mantine-color-anchor',
    '--mantine-color-primary-filled',
    '--mantine-color-primary-filled-hover',
    '--mantine-color-primary-light',
    '--mantine-color-primary-light-color',
    '--mantine-color-primary-light-hover',
    '--mantine-color-primary-outline',
    '--mantine-color-primary-outline-hover',
    '--mantine-color-primary-text',
    '--mantine-primary-color-filled-hover',
    '--mantine-primary-color-light',
    '--mantine-primary-color-light-color',
    '--mantine-primary-color-light-hover',
];

/** Error, warning and success are constants per mode, not the seed's: they keep their chroma. */
const STATE_KEYS = new Set([
    '--theme-colors-state-error',
    '--theme-colors-state-success',
    '--theme-colors-state-warning',
]);

const seeds = [
    { hue: 40, k: 1, meanL: 0.5 },
    { hue: 250, k: 0.5, meanL: 0.8 },
    { hue: 260, k: 0.22, meanL: 0.2 },
];

test('everyKeyInTheMapIsProduced', () => {
    for (const seed of seeds) {
        for (const light of [false, true]) {
            const vars = washVars(rolesFor(seed, light));
            assert.deepEqual(Object.keys(vars).sort(), [...MAP_KEYS].sort());
            for (const [key, value] of Object.entries(vars)) {
                assert.ok(value.length > 0, `${key} is empty`);
            }
        }
    }
});

test('anAchromaticSeedProducesNoChromaInAnyOklch', () => {
    for (const light of [false, true]) {
        const vars = washVars(rolesFor({ hue: 123, k: 0, meanL: 0.5 }, light));
        let checked = 0;
        for (const [key, value] of Object.entries(vars)) {
            if (STATE_KEYS.has(key)) continue;
            const match = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
            if (!match) continue;
            checked++;
            assert.equal(Number(match[2]), 0, `${key}: ${value}`);
        }
        assert.ok(checked >= 13, `only ${checked} oklch values`);
        const [r, g, b] = vars['--theme-colors-primary'].match(/\d+/g)!.map(Number);
        assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 1, vars['--theme-colors-primary']);
    }
});

test('primaryAlsoComesAsRgb', () => {
    for (const seed of seeds) {
        for (const light of [false, true]) {
            const vars = washVars(rolesFor(seed, light));
            assert.match(vars['--theme-colors-primary'], /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
            assert.match(vars['--theme-colors-primary-filled'], /^oklch\(/);
            assert.equal(vars['--wash-acc'], vars['--theme-colors-primary-filled']);
        }
    }
});
