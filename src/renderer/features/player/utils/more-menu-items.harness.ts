import assert from 'node:assert/strict';
import test from 'node:test';

import { moreMenuItems } from './more-menu-items.ts';

/**
 * F1:  node --test src/renderer/features/player/utils/more-menu-items.harness.ts
 *
 * The rows of the player bar's More menu, in order.
 */

const ids = (ctx: { isElectron: boolean; isRadioActive: boolean }) =>
    moreMenuItems(ctx).map((item) => item.id);

test('thePlainOrder', () => {
    assert.deepEqual(ids({ isElectron: false, isRadioActive: false }), [
        'playRandom',
        'sleepTimer',
        'equaliser',
        'lyrics',
        'playbackOptions',
        'autoDj',
        'stop',
    ]);
});

test('dlnaOnlyInElectron', () => {
    assert.deepEqual(ids({ isElectron: true, isRadioActive: false }), [
        'playRandom',
        'sleepTimer',
        'equaliser',
        'lyrics',
        'dlna',
        'playbackOptions',
        'autoDj',
        'stop',
    ]);
});

test('stopIsLastAndSeparated', () => {
    for (const isElectron of [false, true]) {
        const items = moreMenuItems({ isElectron, isRadioActive: false });
        const last = items[items.length - 1];
        assert.equal(last.id, 'stop');
        assert.equal(last.separatorBefore, true);
        assert.equal(items.filter((item) => item.separatorBefore).length, 1);
    }
});

test('panelsAndActions', () => {
    const kinds = Object.fromEntries(
        moreMenuItems({ isElectron: true, isRadioActive: false }).map((i) => [i.id, i.kind]),
    );
    assert.deepEqual(kinds, {
        autoDj: 'panel',
        dlna: 'panel',
        equaliser: 'action',
        lyrics: 'action',
        playbackOptions: 'panel',
        playRandom: 'action',
        sleepTimer: 'panel',
        stop: 'action',
    });
});

test('radioActiveKeepsTheSameRowsButPlayRandom', () => {
    for (const isElectron of [false, true]) {
        assert.deepEqual(
            moreMenuItems({ isElectron, isRadioActive: true }),
            moreMenuItems({ isElectron, isRadioActive: false }).filter(
                (item) => item.id !== 'playRandom',
            ),
        );
    }
});

// R14 (B-252): Play random left the transport for this menu, and appears in it once whatever the
// window or the build (the menu has no width-dependent rows; this pins that it stays so).
test('playRandomOnceAndFirst', () => {
    for (const isElectron of [false, true]) {
        const list = ids({ isElectron, isRadioActive: false });
        assert.equal(list.filter((id) => id === 'playRandom').length, 1);
        assert.equal(list[0], 'playRandom');
        assert.equal(new Set(list).size, list.length);
    }
});
