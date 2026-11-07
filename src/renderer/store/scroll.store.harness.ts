import assert from 'node:assert/strict';
import test from 'node:test';

import { hasEntryIdentity, useScrollStore } from './scroll.store.ts';

/**
 * R4 (B-208):  node --test src/renderer/store/scroll.store.harness.ts
 *
 * A history entry that react-router did not create has no state, so every one of them reads back
 * with the key "default" (a hash assigned from code, `location.replace`, the first entry of a
 * session). Offsets are saved per key and restored on POP, and a hash change is a POP, so all of
 * those entries would share one offset: a forward push opened mid-scroll at the place another page
 * had left under "default". A key that names no entry is never stored and never read.
 */

test('theKeyReactRouterGivesAStatelessEntryIsNoIdentity', () => {
    assert.equal(hasEntryIdentity('default'), false);
    assert.equal(hasEntryIdentity(''), false);
    assert.equal(hasEntryIdentity('x23utx9s'), true);
});

test('twoStatelessEntriesDoNotShareAnOffset', () => {
    const { getOffset, setOffset } = useScrollStore.getState();
    setOffset('default', 2145);
    assert.equal(getOffset('default'), undefined);
    setOffset('default', 400);
    assert.equal(getOffset('default'), undefined);
});

test('aRealEntryKeepsItsOffset', () => {
    const { getOffset, setOffset } = useScrollStore.getState();
    setOffset('abc123', 900);
    setOffset('def456', 100);
    assert.equal(getOffset('abc123'), 900);
    assert.equal(getOffset('def456'), 100);
});
