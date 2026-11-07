import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIEW, parseView, viewIsDefault, writeView } from './discography-view.ts';

/**
 * F7 Call 1: the discography's filters are the page's, kept in the URL with the defaults left out.
 *
 *     node --test src/renderer/features/discography/discography-view.harness.ts
 */

test('the default view writes nothing', () => {
    assert.equal(writeView(DEFAULT_VIEW, new URLSearchParams()).toString(), '');
    assert.deepEqual(parseView(new URLSearchParams()), DEFAULT_VIEW);
    assert.equal(viewIsDefault(DEFAULT_VIEW), true);
});

test('a full view round-trips', () => {
    const params = new URLSearchParams('type=live&own=missing&sort=plays&dir=asc');
    const view = parseView(params);
    assert.deepEqual(view, { dir: 'asc', own: 'missing', sort: 'plays', type: 'live' });
    assert.equal(viewIsDefault(view), false);
    const written = writeView(view, new URLSearchParams());
    assert.deepEqual(parseView(written), view);
    assert.equal(written.get('type'), 'live');
});

test('unknown or malformed values fall back per key, never throw', () => {
    assert.deepEqual(
        parseView(new URLSearchParams('type=bogus&own=live&sort=&dir=up')),
        DEFAULT_VIEW,
    );
    assert.deepEqual(parseView(new URLSearchParams('type=bogus&own=partly')), {
        ...DEFAULT_VIEW,
        own: 'partly',
    });
    assert.deepEqual(parseView(new URLSearchParams('type=appears-on')), {
        ...DEFAULT_VIEW,
        type: 'appears-on',
    });
});

test('unrelated keys survive and defaults are removed', () => {
    const params = new URLSearchParams('name=Kiosk&type=live&sort=title');
    const written = writeView({ ...DEFAULT_VIEW, sort: 'title' }, params);
    assert.equal(written.get('name'), 'Kiosk');
    assert.equal(written.get('type'), null);
    assert.equal(written.get('sort'), 'title');
    // The input is not mutated.
    assert.equal(params.get('type'), 'live');
});
