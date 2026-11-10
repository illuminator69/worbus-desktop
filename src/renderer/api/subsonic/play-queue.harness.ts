import assert from 'node:assert/strict';
import test from 'node:test';

import { readClassicPlayQueue } from './play-queue.ts';

/**
 * B-372 (Phase B):
 *   node --test src/renderer/api/subsonic/play-queue.harness.ts
 *
 * A server without a saved queue answers `getPlayQueue` with no `playQueue` (Navidrome answers
 * `playQueueByIndex` the same way, which the ByIndex path already guards with `|| {}`). The classic
 * path destructured `res.body.playQueue` and threw.
 */

const song = (id: string) => ({ id });
const toSong = (s: { id: string }) => `song ${s.id}`;

test('no_saved_queue_reads_as_an_empty_queue', () => {
    assert.deepEqual(readClassicPlayQueue({} as never, toSong), {
        changed: '',
        changedBy: '',
        currentIndex: 0,
        entry: [],
        positionMs: 0,
        username: '',
    });
});

test('a_saved_queue_reads_as_before', () => {
    const body = {
        playQueue: {
            changed: 'c',
            changedBy: 'Worbus',
            current: 'b',
            entry: [song('a'), song('b')],
            position: 1200,
            username: 'alice',
        },
    };
    assert.deepEqual(readClassicPlayQueue(body, toSong), {
        changed: 'c',
        changedBy: 'Worbus',
        currentIndex: 1,
        entry: ['song a', 'song b'],
        positionMs: 1200,
        username: 'alice',
    });
});

test('a_queue_with_no_entries_or_an_unknown_current_reads_as_row_0', () => {
    const body = { playQueue: { changed: '', changedBy: '', current: 'x', username: 'a' } };
    assert.equal(readClassicPlayQueue(body as never, toSong).currentIndex, 0);
    const missing = {
        playQueue: { changed: '', changedBy: '', current: 'x', entry: [song('a')], username: 'a' },
    };
    assert.equal(readClassicPlayQueue(missing, toSong).currentIndex, 0);
});
