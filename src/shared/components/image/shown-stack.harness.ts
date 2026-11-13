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

/**
 * B-412 (owner walk, 2026-11-13): in a queue of one album, some rows and the player bar showed
 * other albums' covers, two of them under a broken-image glyph: "a song's art fails to load and a
 * previous art is reused". The stack keeps the last loaded image under a new one until the new one
 * loads; nothing ended that when the new one never would. Navidrome answers a getCoverArt it cannot
 * serve with a Subsonic error, HTTP 200 and an XML body: the native image read any 200 as an image,
 * made a blob of the XML and called it loaded; the <img> could not decode it (the glyph), and its
 * error was not the stack's business, so the previous item's cover stayed beneath it for good.
 */
const stack = (await import('./shown-stack.ts')) as unknown as {
    imageGone?: (
        src: string | undefined,
        fetchFailed: boolean,
        displaySrc: string | undefined,
        undecodableSrc: null | string,
    ) => boolean;
    isImageBody?: (contentType: string) => boolean;
};

test('a_cover_that_cannot_be_decoded_leaves_no_previous_cover', () => {
    assert.equal(typeof stack.imageGone, 'function', 'an <img> that cannot decode is not the stack’s');
    const a = markLoaded(showNext([], 'blob-a', false), 'blob-a');
    const b = nextShown(a, 'blob-b', false, true);
    assert.deepEqual(
        b.map((e) => e.src),
        ['blob-a', 'blob-b'],
    );
    // The top <img> fires error: blob-b is no image.
    const gone = stack.imageGone!('url-b', false, 'blob-b', 'blob-b');
    assert.equal(gone, true);
    const after = nextShown(b, 'blob-b', gone, true);
    assert.deepEqual(after, [], 'the previous item’s cover stays under the broken one');
    assert.equal(nextShown(after, 'blob-b', gone, true), after, 'it settles');
    // The next item's cover arrives alone.
    assert.equal(stack.imageGone!('url-c', false, 'blob-c', 'blob-b'), false);
    assert.deepEqual(
        nextShown(after, 'blob-c', false, true).map((e) => e.src),
        ['blob-c'],
    );
    // Today's cases are unchanged.
    assert.equal(stack.imageGone!(undefined, false, undefined, null), true);
    assert.equal(stack.imageGone!('url-b', true, undefined, null), true);
    assert.equal(stack.imageGone!('url-b', false, 'blob-b', null), false);
});

test('a_subsonic_error_is_not_an_image', () => {
    assert.equal(typeof stack.isImageBody, 'function', 'any 200 is read as an image');
    assert.equal(stack.isImageBody!('text/xml; charset=utf-8'), false);
    assert.equal(stack.isImageBody!('application/json'), false);
    assert.equal(stack.isImageBody!('text/html'), false);
    assert.equal(stack.isImageBody!('image/jpeg'), true);
    assert.equal(stack.isImageBody!('image/webp'), true);
    // No type said: the element decides (and its error now counts).
    assert.equal(stack.isImageBody!(''), true);
    assert.equal(stack.isImageBody!('application/octet-stream'), true);
});

test('wired_the_element_and_the_fetch_say_when_there_is_no_image', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    const image = read('./image.tsx');
    assert.match(image, /imageGone\(/, 'the stack ignores an <img> that cannot decode');
    const top = image.slice(image.indexOf('<img'), image.indexOf('/>', image.indexOf('<img')));
    assert.match(top, /onError=\{top \?/, "the top <img>'s error is passed on and nothing else");
    assert.match(read('./use-native-image.ts'), /isImageBody\(/, 'a 200 with an XML body is loaded');
});
