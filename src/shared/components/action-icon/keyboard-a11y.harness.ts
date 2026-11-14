import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { iconButtonName } from './icon-button-name.ts';

/**
 * B-197 (VM 2026-10-23, F6 keyboard sweep) and B-325 (P2 lane F walk, 2026-11-02):
 *   node --test src/shared/components/action-icon/keyboard-a11y.harness.ts
 *
 * Keyboard focus showed nowhere: the theme's `focusRing: 'never'` and the global `* { outline: none }`
 * left Tab with no mark on the top bar, the sidebar, the list toolbars and the grids. And an icon-only
 * button had no name: the list toolbars' direction, filter, refresh, display and settings buttons
 * and the discography's MusicBrainz match menu button were "button" / "menu button" to a screen
 * reader, though each has a tooltip saying what it does. Now the keyboard's focus draws a 2 px ring
 * (Mantine's own for its controls, a global `:focus-visible` one for the rest; a pointer's focus
 * draws none), and an icon button is named by its tooltip unless it has a name of its own.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('an_icon_button_is_named_by_its_tooltip', () => {
    assert.equal(iconButtonName(undefined, 'Refresh'), 'Refresh');
    assert.equal(iconButtonName('Close', 'Refresh'), 'Close', 'its own name wins');
    assert.equal(iconButtonName(undefined, undefined), undefined);
    // A tooltip that is an element has no text to give.
    assert.equal(iconButtonName(undefined, { type: 'span' }), undefined);
    assert.equal(iconButtonName(undefined, '  '), undefined);
});

test('the_shared_action_icon_names_itself', () => {
    assert.match(read('./action-icon.tsx'), /iconButtonName\(/);
});

test('keyboard_focus_draws_a_ring', () => {
    const theme = read('../../../renderer/themes/mantine-theme.tsx');
    assert.doesNotMatch(theme, /focusRing: 'never'/, "Mantine's controls draw no focus");
    const css = read('../../styles/global.css');
    assert.match(css, /:focus-visible\)?\s*\{[^}]*outline: 2px solid/, 'no global focus ring');
});
