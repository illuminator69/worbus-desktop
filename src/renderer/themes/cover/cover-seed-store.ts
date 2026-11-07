import { createStore, get, set, UseStore } from 'idb-keyval';

import { type CoverSeed, NEUTRAL_SEED } from '/@/renderer/themes/cover/cover-roles';
import { deriveCoverSeed } from '/@/renderer/themes/cover/cover-seed';
import { createSeedCache } from '/@/renderer/themes/cover/cover-seed-cache';
import { logger } from '/@/renderer/utils/logger';

/**
 * Cover seeds by `seedKey`: in memory (LRU 512), persisted to IndexedDB at most every 2 s and hydrated
 * before the first render, plus the last seed in localStorage for a synchronous cold start.
 */

/** Bump whenever `cover-seed.ts`'s algorithm or thresholds change, so seeds made by the old rules are discarded. */
const SEED_SCHEMA = 1;
const LIMIT = 512;
const WRITE_EVERY_MS = 2000;
const LAST_SEED_KEY = 'cover_seed_last';
/** The sample the seed is read from; the cover's small URL is drawn down to this. */
const SAMPLE = 48;

interface Persisted {
    rows: [string, CoverSeed][];
    schema: number;
}

let cache = createSeedCache(LIMIT);
let idb: undefined | UseStore;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
const inflight = new Map<string, Promise<CoverSeed | null>>();

const store = () => (idb ??= createStore('cover-seeds', 'cover-seeds'));

const isSeed = (value: unknown): value is CoverSeed => {
    const seed = value as CoverSeed | null;
    return (
        typeof seed === 'object' &&
        seed !== null &&
        [seed.hue, seed.k, seed.meanL].every((n) => typeof n === 'number' && Number.isFinite(n))
    );
};

export const hydrateCoverSeeds = async (): Promise<void> => {
    const saved = await get<Persisted>('all', store());
    if (saved?.schema !== SEED_SCHEMA || !Array.isArray(saved.rows)) return;
    // Anything put before hydration finished is newer, so it goes last.
    cache = createSeedCache(LIMIT, [
        ...saved.rows.filter((row) => Array.isArray(row) && isSeed(row[1])),
        ...cache.toRows(),
    ]);
};

export const getCachedSeed = (key: string): CoverSeed | undefined => cache.get(key);

export const putSeed = (key: string, seed: CoverSeed): void => {
    cache.set(key, seed);
    writeTimer ??= setTimeout(() => {
        writeTimer = undefined;
        const value: Persisted = { rows: cache.toRows(), schema: SEED_SCHEMA };
        set('all', value, store()).catch((error) =>
            logger.warn('cover seed: could not persist seeds', { error: String(error) }),
        );
    }, WRITE_EVERY_MS);
};

/**
 * The last seed the window showed, for a synchronous cold start. Only `useCoverWash` writes it, so a
 * page header's seed or a discarded stale load never becomes the window's first colour.
 */
export const writeLastSeed = (seed: CoverSeed): void => {
    try {
        localStorage.setItem(LAST_SEED_KEY, JSON.stringify(seed));
    } catch (error) {
        logger.warn('cover seed: could not keep the last seed', { error: String(error) });
    }
};

export const readLastSeed = (): CoverSeed => {
    try {
        const seed: unknown = JSON.parse(localStorage.getItem(LAST_SEED_KEY) ?? 'null');
        return isSeed(seed) ? seed : NEUTRAL_SEED;
    } catch {
        return NEUTRAL_SEED;
    }
};

/** For logs only: the cover's id from its URL (`?id=` for Subsonic, `/Items/<id>/` for Jellyfin), never the URL. */
const imageIdOf = (src: string) => {
    try {
        const url = new URL(src, window.location.href);
        return url.searchParams.get('id') ?? url.pathname.match(/\/Items\/([^/]+)\//)?.[1] ?? '?';
    } catch {
        return '?';
    }
};

export const loadSeedFromImage = (src: string): Promise<CoverSeed | null> => {
    const id = imageIdOf(src);
    logger.debug('cover seed: loading', { id });

    return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = SAMPLE;
                canvas.height = SAMPLE;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) throw new Error('no 2d context');
                context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
                const seed = deriveCoverSeed(
                    context.getImageData(0, 0, SAMPLE, SAMPLE).data,
                    SAMPLE,
                    SAMPLE,
                );
                if (!seed) logger.warn('cover seed: the cover is transparent', { id });
                resolve(seed);
            } catch (error) {
                // A tainted canvas (no CORS on a cover that loaded anyway) throws here.
                logger.warn('cover seed: could not read the cover', { error: String(error), id });
                resolve(null);
            }
        };
        image.onerror = () => {
            logger.warn('cover seed: the cover did not load', { id });
            resolve(null);
        };
        image.src = src;
    });
};

/** The seed for a cover: from the cache, or one shared load per key however many ask at once. */
export const resolveCoverSeed = (key: string, src: string): Promise<CoverSeed | null> => {
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);

    let pending = inflight.get(key);
    if (!pending) {
        pending = loadSeedFromImage(src)
            .then((seed) => {
                if (seed) putSeed(key, seed);
                return seed;
            })
            .finally(() => inflight.delete(key));
        inflight.set(key, pending);
    }
    return pending;
};
