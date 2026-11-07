import assert from 'node:assert/strict';
import test from 'node:test';

import { queuePanelToggle } from './queue-panel-toggle.ts';

/**
 * R14 (B-250):  node --test src/renderer/features/now-playing/utils/queue-panel-toggle.harness.ts
 *
 * One toggle for the rail, the panel's hide button and the player bar's queue icon: a wide window
 * flips the saved flag, a folded one flips the overlay and never the flag.
 */

test('wideWindowFlipsTheSavedFlag', () => {
    assert.deepEqual(queuePanelToggle({ folded: false, overlayOpen: false, rightExpanded: true }), {
        open: false,
        target: 'grid',
    });
    assert.deepEqual(queuePanelToggle({ folded: false, overlayOpen: true, rightExpanded: false }), {
        open: true,
        target: 'grid',
    });
});

test('foldedWindowFlipsTheOverlayOnly', () => {
    for (const rightExpanded of [false, true]) {
        assert.deepEqual(queuePanelToggle({ folded: true, overlayOpen: false, rightExpanded }), {
            open: true,
            target: 'overlay',
        });
        assert.deepEqual(queuePanelToggle({ folded: true, overlayOpen: true, rightExpanded }), {
            open: false,
            target: 'overlay',
        });
    }
});

test('twoTogglesComeBackToTheStart', () => {
    for (const folded of [false, true]) {
        for (const open of [false, true]) {
            let state = { folded, overlayOpen: open, rightExpanded: open };
            for (let i = 0; i < 2; i++) {
                const move = queuePanelToggle(state);
                state =
                    move.target === 'overlay'
                        ? { ...state, overlayOpen: move.open }
                        : { ...state, rightExpanded: move.open };
            }
            assert.deepEqual(state, { folded, overlayOpen: open, rightExpanded: open });
        }
    }
});
