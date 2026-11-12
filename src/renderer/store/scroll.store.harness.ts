import assert from 'node:assert/strict';
import test from 'node:test';

import { entryKeyFor, hasEntryIdentity, useScrollStore } from './scroll.store.ts';

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

/**
 * B-315: B-208's rule hid the shared offset but left those entries with no identity at all: a page
 * reached by a hash change (lb-bot's `leaveTo` after a merge uses `location.replace`) saved nothing,
 * so Back to it landed at the top. An entry with no key gets one stamped into its own history
 * state (react-router reads `history.state.key` back as `location.key` on POP), so it keeps its
 * offset like any other entry.
 */
const fakeHistory = (state: unknown) => {
    const h = {
        replaceState: (next: unknown) => {
            h.state = next;
        },
        state,
    };
    return h;
};

test('aStatelessEntryGetsAKeyOfItsOwnAndKeepsItsOffset', () => {
    let n = 0;
    const mint = () => `stamped${++n}`;
    // The entry location.replace made: react-router gives it "default", its state is null.
    const entry = fakeHistory(null);
    const key = entryKeyFor('default', entry, mint);
    assert.ok(hasEntryIdentity(key), 'a key that names this entry');
    const { getOffset, setOffset } = useScrollStore.getState();
    setOffset(key, 700);
    // Back to it later: react-router reads the key from the entry's state.
    const onPop = (entry.state as null | { key?: string })?.key ?? 'default';
    assert.equal(getOffset(onPop), 700);
    // The same entry keeps the same key; a second stateless entry gets another.
    assert.equal(entryKeyFor('default', entry, mint), key);
    assert.notEqual(entryKeyFor('default', fakeHistory({ idx: 3 }), mint), key);
});

test('theStampKeepsTheRoutersOwnState', () => {
    const entry = fakeHistory({ idx: 4, usr: { from: 'x' } });
    const key = entryKeyFor('default', entry, () => 'k1');
    assert.deepEqual(entry.state, { idx: 4, key, usr: { from: 'x' } });
    // An entry the router keyed is left alone.
    const keyed = fakeHistory({ idx: 1, key: 'abc', usr: null });
    assert.equal(
        entryKeyFor('abc', keyed, () => 'k2'),
        'abc',
    );
    assert.deepEqual(keyed.state, { idx: 1, key: 'abc', usr: null });
});

test('noPlaceIsKeptUnderTheRoutersRawKey', async () => {
    // Review minor (fix round 2026-11-12): B-315 moved the scroll hooks and the artist page's chip
    // to `useEntryKey`, but the Artists page (`use-library-place.ts`) still kept its text, sort and
    // offset under `location.key`: on an entry the router did not key the offset is refused under
    // "default" (B-208), and the held text and sort of every such entry share that one key, so a
    // second unkeyed entry could restore another's search.
    // The source tree itself, not `git ls-files`: the guard must run outside a checkout too (a
    // source tarball, the VM's exported tree).
    const { readdirSync, readFileSync } = await import('node:fs');
    const root = new URL('../../..', import.meta.url);
    const files = (readdirSync(new URL('src/renderer', root), { recursive: true }) as string[])
        .map((rel) => `src/renderer/${rel.split('\\').join('/')}`)
        .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.harness.ts'));
    assert.ok(files.length > 500, `only ${files.length} renderer sources found`);
    const offenders = files.filter((file) => {
        const code = readFileSync(new URL(file, root), 'utf8');
        return /\b(?:getOffset|setOffset)\(/.test(code) && /location\.key\b/.test(code);
    });
    assert.deepEqual(offenders, []);
    const place = readFileSync(
        new URL('src/renderer/features/library/hooks/use-library-place.ts', root),
        'utf8',
    );
    assert.match(place, /useEntryKey\(\)/);
});
