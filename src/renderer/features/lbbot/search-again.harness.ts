import assert from 'node:assert/strict';
import test from 'node:test';

import { albumSearchPress, gapSearchForce } from './search-again.ts';

/**
 * B-256 (client half):  node --test src/renderer/features/lbbot/search-again.harness.ts
 *
 * The hub forwards `refresh` on `/lb/album/sources` now, but the missing-album page's Search again
 * under an empty or failed answer re-read the query without it (VM walk 2026-11-09: two presses
 * within 60 s reached nothing upstream, the hub's cache answered; a third, after the cache expired,
 * reached lb-bot without `refresh`). Every Search again must ask lb-bot afresh: `refresh=1` on the
 * album page, `force` on a gap's search POST (lb-bot reuses a young list without it).
 */

test('searchAgainUnderAnEmptyOrFailedAnswerAsksAfresh', () => {
    assert.equal(albumSearchPress('empty'), 'refresh', 'the hub cache answered Search again');
    assert.equal(albumSearchPress('failed'), 'refresh');
    assert.equal(albumSearchPress('ready'), 'reshow', 'cards shown: no new search');
    assert.equal(albumSearchPress('waiting'), 'none');
});

test('aGapSearchAgainAlwaysForces', () => {
    assert.equal(gapSearchForce('searchAgain', 0), true, 'lb-bot reused the young list');
    assert.equal(gapSearchForce('searchAgain', 3), true);
    assert.equal(gapSearchForce('fillGaps', 0), false, 'the first turn reuses a young list');
    assert.equal(gapSearchForce('allowMp3', 3), true);
});
