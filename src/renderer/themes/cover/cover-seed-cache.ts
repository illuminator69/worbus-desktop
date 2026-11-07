/**
 * The in-memory cover seed cache: least recently used dropped over the limit. Pure: no app imports,
 * no IndexedDB (`cover-seed-store.ts` persists it).
 */

import type { CoverSeed } from './cover-roles.ts';

export interface SeedCache {
    get(key: string): CoverSeed | undefined;
    set(key: string, seed: CoverSeed): void;
    size(): number;
    /** Least recently used first, so `createSeedCache(limit, rows)` restores the order. */
    toRows(): [string, CoverSeed][];
}

/** A cover's identity: never its URL, whose token changes per request. */
export const seedKey = (serverId: string, imageId: string): string => `${serverId}:${imageId}`;

export const createSeedCache = (limit: number, rows: [string, CoverSeed][] = []): SeedCache => {
    // A Map iterates in insertion order; re-inserting on use keeps the least recent first.
    const map = new Map<string, CoverSeed>();

    const set = (key: string, seed: CoverSeed) => {
        map.delete(key);
        map.set(key, seed);
        while (map.size > limit) map.delete(map.keys().next().value as string);
    };

    for (const [key, seed] of rows) set(key, seed);

    return {
        get: (key) => {
            const seed = map.get(key);
            if (seed) set(key, seed);
            return seed;
        },
        set,
        size: () => map.size,
        toRows: () => [...map],
    };
};
