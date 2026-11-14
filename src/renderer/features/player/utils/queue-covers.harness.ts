import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { coverIdChanges, queueCoverAsks } from './queue-covers.ts';

/**
 * B-437 (the owner, 2026-11-14, QUESTIONS-before-stage2 item 17: "yes, refresh the queue's songs'
 * cover ids on start"):
 *   node --test src/renderer/features/player/utils/queue-covers.harness.ts
 *
 * The persisted play queue keeps each song's cover id from when it was queued. Since B-428 that id
 * is versioned (`<id>&_=<imageHash>`) and Navidrome answers it `immutable`, so after a cover changed
 * outside the app the queue's rows kept the old art even across a restart. On start the app now
 * asks Navidrome for the queue's songs again (by id, in batches) and moves each row whose cover id
 * changed to the current one. Only the cover id moves: the queue, its order and its entries stay.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const nd = (id: string, imageId: string, serverId = 'srv') => ({
    _serverId: serverId,
    _serverType: 'navidrome',
    id,
    imageId,
});

test('the_queues_navidrome_songs_are_asked_once_each_in_batches', () => {
    const songs = [
        nd('a', 'a&_=1'),
        nd('b', 'b&_=1'),
        nd('a', 'a&_=1'), // the same song queued twice is asked once
        nd('c', 'c&_=1', 'other'), // another server's song is not this server's to answer
        { ...nd('d', 'd'), _serverType: 'jellyfin' }, // not Navidrome: no versioned id
        nd('ext:yt:1', 'ext:yt:1'), // a preview has no library row
        nd('e', 'e&_=1'),
    ];
    assert.deepEqual(queueCoverAsks(songs, 'srv', 2), [['a', 'b'], ['e']]);
    assert.deepEqual(queueCoverAsks([], 'srv', 2), []);
});

test('only_a_changed_cover_id_moves', () => {
    const queued = [nd('a', 'a&_=1'), nd('b', 'b&_=1'), nd('c', 'c')];
    const fresh = [
        { id: 'a', imageId: 'a&_=2' }, // replaced outside the app
        { id: 'b', imageId: 'b&_=1' }, // unchanged
        { id: 'c', imageId: 'c&_=9' }, // Navidrome now sends a hash
    ];
    assert.deepEqual(
        [...coverIdChanges(queued, fresh)],
        [
            ['a', 'a&_=2'],
            ['c', 'c&_=9'],
        ],
    );
    // A song Navidrome no longer lists (deleted, or a failed read) keeps the id it has.
    assert.equal(coverIdChanges(queued, []).size, 0);
    // An answer with no cover id never blanks one.
    assert.equal(coverIdChanges(queued, [{ id: 'a', imageId: null }]).size, 0);
});

test('the_refresh_runs_once_the_session_is_valid', () => {
    const outlet = read('../../../layouts/authentication-outlet.tsx');
    assert.match(outlet, /<QueueCoverRefresh \/>/, 'nothing refreshes the queue on start');
    const hook = read('../hooks/use-queue-cover-refresh.ts');
    assert.match(hook, /setQueueCoverIds\(/, 'the store is not patched');
    assert.match(hook, /hydrated/, 'asks before the persisted queue is read back');
});
