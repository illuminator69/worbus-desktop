import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

import {
    isLbBotQueryKey,
    shouldPersistLbBotQuery,
} from '../features/lbbot/utils/persisted-queries.ts';

/**
 * The react-query snapshot in IndexedDB (moved out of `main.tsx` so the account follower can flush
 * it, Worbus P2 re-review N5). Pure apart from the store handed in, so `query-persister.harness.ts`
 * runs it.
 *
 * navi-connect (Q-010): `persistQueryClientSubscribe` calls `persistClient` on EVERY
 * QueryCache/MutationCache 'added'/'removed'/'updated' event with no throttle of its own -
 * `@tanstack/react-query-persist-client` 5.x dropped v4's `throttleTime` option entirely - and each
 * call structured-clones and writes the WHOLE dehydrated cache to IndexedDB, which the lb-bot reads
 * turn into a burst on ordinary scrolling. Throttled here instead, at the persister boundary: at
 * most one write per PERSIST_THROTTLE_MS, leading edge fires immediately so a single change still
 * lands promptly. `flush()` writes the pending snapshot now.
 */
export const PERSIST_THROTTLE_MS = 1_000;

export interface SnapshotStore {
    del: (key: IDBValidKey) => Promise<void>;
    get: <T>(key: IDBValidKey) => Promise<T | undefined>;
    set: (key: IDBValidKey, value: unknown) => Promise<void>;
}

export const createThrottledPersister = (
    store: SnapshotStore,
    idbValidKey: IDBValidKey = 'reactQuery',
    now: () => number = Date.now,
): Persister & { flush: () => void } => {
    let lastWriteAt = Number.NEGATIVE_INFINITY;
    let pending: null | PersistedClient = null;
    let timer: null | ReturnType<typeof setTimeout> = null;

    const flush = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (!pending) return;
        const client = pending;
        pending = null;
        lastWriteAt = now();
        void store.set(idbValidKey, client);
    };

    return {
        flush,
        persistClient: async (client: PersistedClient) => {
            pending = client;
            const elapsed = now() - lastWriteAt;
            if (elapsed >= PERSIST_THROTTLE_MS) {
                flush();
            } else if (timer === null) {
                timer = setTimeout(flush, PERSIST_THROTTLE_MS - elapsed);
            }
        },
        removeClient: async () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            pending = null;
            await store.del(idbValidKey);
        },
        restoreClient: async () => {
            const client = await store.get<PersistedClient>(idbValidKey);
            // navi-connect: lb-bot entries are bounded by age on the way back in too - `maxAge`
            // is Infinity, and the snapshot's own filter only ran when it was written.
            if (client?.clientState?.queries) {
                client.clientState.queries = client.clientState.queries.filter(
                    (query) => !isLbBotQueryKey(query.queryKey) || shouldPersistLbBotQuery(query),
                );
            }
            return client;
        },
    };
};
