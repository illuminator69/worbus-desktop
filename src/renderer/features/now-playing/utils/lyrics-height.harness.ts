import assert from 'node:assert/strict';
import test from 'node:test';

import {
    clampLyricsHeight,
    LYRICS_MIN_HEIGHT,
    lyricsHeightRange,
    queueRowsLeft,
} from './lyrics-height.ts';

/**
 * R8 (B-226):  node --test src/renderer/features/now-playing/utils/lyrics-height.harness.ts
 *
 * The queue panel's lyrics area is as tall as the user last dragged it. `wanted` is that height (null
 * until they drag), `panel` the height of the panel the strip sits in. The queue keeps its rows first.
 */

test('theDefaultKeepsSixRowsAtA900pxWindow', () => {
    // 1440 x 900: the panel is the window less the title bar, top bar and player bar, about 684 px.
    const panel = 684;
    const height = clampLyricsHeight({ panel, wanted: null });
    assert.ok(height >= LYRICS_MIN_HEIGHT);
    // The default asks for six rows but never goes under the 120 px minimum: at this panel the minimum
    // wins and the queue is 1 px short of six. In a taller panel it is six rows exactly.
    assert.ok(queueRowsLeft({ height, panel }) >= 5.9);
    const tall = clampLyricsHeight({ panel: 864, wanted: null });
    assert.ok(queueRowsLeft({ height: tall, panel: 864 }) >= 6);
});

test('theDefaultNeverPassesWhatTheStripUsedToTake', () => {
    assert.equal(clampLyricsHeight({ panel: 2000, wanted: null }), 320);
});

test('belowTheMinimumClampsToTheMinimum', () => {
    assert.equal(clampLyricsHeight({ panel: 900, wanted: 10 }), LYRICS_MIN_HEIGHT);
    assert.equal(clampLyricsHeight({ panel: 900, wanted: 119 }), LYRICS_MIN_HEIGHT);
});

test('aboveTheMaximumClampsToTheMaximumAndTheQueueKeepsThreeRows', () => {
    const height = clampLyricsHeight({ panel: 900, wanted: 5000 });
    assert.ok(height < 900);
    assert.ok(queueRowsLeft({ height, panel: 900 }) >= 3);
    // And it is the largest height that does: exactly three rows are left.
    assert.equal(queueRowsLeft({ height, panel: 900 }), 3);
});

test('aWantedHeightInsideTheLimitsIsKept', () => {
    assert.equal(clampLyricsHeight({ panel: 900, wanted: 250 }), 250);
});

test('aPanelTooSmallForBothGivesTheQueueItsThreeRowsFirst', () => {
    const panel = 330;
    const height = clampLyricsHeight({ panel, wanted: 300 });
    assert.ok(height < LYRICS_MIN_HEIGHT);
    assert.ok(queueRowsLeft({ height, panel }) >= 3);
    assert.equal(clampLyricsHeight({ panel: 100, wanted: 300 }), 0);
});

test('theWindowShrinkingNeverTakesThePanel', () => {
    for (const panel of [900, 700, 560, 420, 300]) {
        const height = clampLyricsHeight({ panel, wanted: 600 });
        assert.ok(height >= 0 && height < panel, `panel ${panel}`);
        assert.ok(queueRowsLeft({ height, panel }) >= 3, `panel ${panel}`);
    }
});

test('theRangeTheHandleAnnouncesIsTheRangeItCanReach', () => {
    for (const panel of [900, 684, 420, 330, 100]) {
        const { max, min } = lyricsHeightRange(panel);
        assert.equal(clampLyricsHeight({ panel, wanted: 0 }), min, `min at panel ${panel}`);
        assert.equal(clampLyricsHeight({ panel, wanted: 1e6 }), max, `max at panel ${panel}`);
    }
});
