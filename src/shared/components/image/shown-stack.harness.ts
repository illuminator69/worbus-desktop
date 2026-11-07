import assert from 'node:assert/strict';
import test from 'node:test';

import { dropUnder, markLoaded, nextShown, showNext } from './shown-stack.ts';

/**
 * F5 review:  node --test src/shared/components/image/shown-stack.harness.ts
 *
 * The images an <img> stack shows while its request changes: the one kept underneath is the last one
 * that loaded, so skipping twice fast (A, B, C) never leaves an empty frame while C loads.
 */

test('theFirstImageStandsAlone', () => {
    assert.deepEqual(showNext([], 'a', true), [{ fade: true, loaded: false, src: 'a' }]);
});

test('aLoadedImageStaysUnderTheNextOne', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    assert.deepEqual(showNext(a, 'b', true), [
        { fade: false, loaded: true, src: 'a' },
        { fade: true, loaded: false, src: 'b' },
    ]);
});

test('skippingTwiceKeepsTheLastLoadedOneUnder', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    const b = showNext(a, 'b', true);
    assert.deepEqual(
        showNext(b, 'c', true).map((e) => e.src),
        ['a', 'c'],
    );
});

test('theSameSourceChangesNothing', () => {
    const a = showNext([], 'a', false);
    assert.equal(showNext(a, 'a', true), a);
});

test('theOldOneGoesOnlyOnceTheNewOneHasLoaded', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    const b = showNext(a, 'b', true);
    assert.equal(dropUnder(b), b);
    assert.deepEqual(dropUnder(markLoaded(b, 'b')), [{ fade: true, loaded: true, src: 'b' }]);
});

/**
 * R12 (B-229, B-210): BaseImage runs nextShown during render and sets the result only when it is a new
 * list, so the answer must be a fixed point: fed its own result with the same inputs, it hands the same
 * list back. Measured on the VM before the fix: clearing the queue left src undefined while the native
 * image still held the last blob, and the old two branches cleared and re-added it until React's #301.
 */

test('goneWithStaleDisplaySrcSettles', () => {
    const a = markLoaded(showNext([], 'blob-a', false), 'blob-a');
    const first = nextShown(a, 'blob-a', true, false);
    assert.deepEqual(first, []);
    assert.equal(nextShown(first, 'blob-a', true, false), first);
});

test('newSrcStacksOverLast', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    const b = nextShown(a, 'b', false, true);
    assert.deepEqual(
        b.map((e) => e.src),
        ['a', 'b'],
    );
    assert.equal(b[1]?.fade, true);
    assert.equal(nextShown(b, 'b', false, true), b);
});

test('sameSrcIsNoop', () => {
    const a = showNext([], 'a', false);
    assert.equal(nextShown(a, 'a', false, true), a);
    assert.equal(nextShown(a, undefined, false, true), a);
});

test('goneClears', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    assert.deepEqual(nextShown(a, undefined, true, false), []);
    const empty: ReturnType<typeof nextShown> = [];
    assert.equal(nextShown(empty, undefined, true, false), empty);
});

test('errorThenNewSrcShowsNew', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    const errored = nextShown(a, undefined, true, false);
    const b = nextShown(errored, 'b', false, true);
    assert.deepEqual(b, [{ fade: true, loaded: false, src: 'b' }]);
    assert.equal(nextShown(b, 'b', false, true), b);
});
