import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createThrottledPersister, PERSIST_THROTTLE_MS } from './query-persister.ts';

/**
 * Worbus P2 re-review N5:  node --test src/renderer/lib/query-persister.harness.ts
 *
 * An account change removes every lb-bot answer (R28); the persister rewrites the snapshot on the
 * 'removed' events but at most once a second, so for up to a second the disk still held the old
 * account's answers. The follower flushes it at once.
 */

const client = (tag: string) => ({
    buster: tag,
    clientState: { mutations: [], queries: [] },
    timestamp: 0,
});

test('an account change writes the snapshot without waiting for the throttle', async () => {
    const writes: string[] = [];
    let clock = 10_000;
    const persister = createThrottledPersister(
        {
            del: async () => undefined,
            get: async () => undefined,
            set: async (_key, value) => {
                writes.push((value as { buster: string }).buster);
            },
        },
        'feishin',
        () => clock,
    );
    await persister.persistClient(client('owner') as never);
    assert.deepEqual(writes, ['owner'], 'the leading edge writes at once');
    clock += 100;
    await persister.persistClient(client('without-lbbot') as never);
    assert.deepEqual(writes, ['owner'], 'throttled');
    persister.flush();
    assert.deepEqual(writes, ['owner', 'without-lbbot'], 'flushed now, not in a second');
    // The throttle's timer is gone with it: nothing is written twice.
    await new Promise((resolve) => setTimeout(resolve, PERSIST_THROTTLE_MS + 50));
    assert.deepEqual(writes, ['owner', 'without-lbbot']);

    const actions = readFileSync(
        new URL('../features/hub/utils/hub-signin-actions.ts', import.meta.url),
        'utf8',
    );
    // After the removal's batched cache notifications (a 0 ms timer) have reached the persister.
    assert.match(
        actions,
        /queryClient\.removeQueries\(\{ queryKey: \['lbbot'\] \}\);\s*(?:\/\/[^\n]*\n\s*)*setTimeout\(flushQueryPersister, 0\);/,
    );
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    assert.match(main, /persister: indexedDbPersister,/);
    assert.doesNotMatch(main, /function createIDBPersister/);
});
