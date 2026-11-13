import { fetchImage } from './fetch-image.ts';
import { isImageBody } from './shown-stack.ts';

/**
 * B-412 follow-up: the covers this session has shown, kept in memory so a row that scrolls away
 * and comes back shows its cover on its first render, without a request.
 *
 * The lists are virtualised, so a row out of the overscan unmounts; `useNativeImage` used to revoke
 * its blob then and fetch the cover again on the next mount (through the per-server slots, behind
 * whatever was in flight), so covers went blank and loaded in again while scrolling. Worbus for
 * Android keeps decoded covers in Coil's memory cache keyed by the cover id; this is the desktop's
 * equivalent:
 * - **Keyed by the request's identity** (`ImageRequest.cacheKey`: server, base URL, id and size),
 *   never by the URL, whose salt and token are the login's, not the image's.
 * - **One object URL per cover**, owned here, so a remount gets the same URL (and Chromium's own
 *   decoded copy of it). A URL is revoked only when its cover has been evicted or forgotten and no
 *   element holds it any more (`take`/`put` hold, `release` lets go).
 * - **Bounded** by bytes and by count, least recently shown first. A cover on screen is never
 *   evicted under its element; it can go once released.
 * - **Never an empty or non-image answer** (B-412): `put` refuses a body of nothing or a document,
 *   so a failed cover is asked again on the next mount.
 */
export const MEMORY_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const MEMORY_CACHE_MAX_ENTRIES = 2000;

type Entry = { blob: Blob; detached: boolean; holders: number; key: string; url: string };

type UrlApi = { create: (blob: Blob) => string; revoke: (url: string) => void };

const objectUrls: UrlApi = {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
};

export class ImageMemoryCache {
    private bytes = 0;
    private readonly byUrl = new Map<string, Entry>();
    /** In Map order: the least recently shown first. */
    private readonly entries = new Map<string, Entry>();
    private readonly maxBytes: number;
    private readonly maxEntries: number;
    private readonly urls: UrlApi;

    constructor(
        limits: { maxBytes?: number; maxEntries?: number } = {},
        urls: UrlApi = objectUrls,
    ) {
        this.maxBytes = limits.maxBytes ?? MEMORY_CACHE_MAX_BYTES;
        this.maxEntries = limits.maxEntries ?? MEMORY_CACHE_MAX_ENTRIES;
        this.urls = urls;
    }

    /**
     * Drops a cover, by its key or by its URL (an element that could not decode it knows the URL):
     * the next mount asks for it again. Elements still holding it keep it until they release it.
     */
    forget(keyOrUrl: string) {
        const entry = this.entries.get(keyOrUrl) ?? this.byUrl.get(keyOrUrl);
        if (!entry || entry.detached) return;
        this.detach(entry);
    }

    /** The cover's URL without holding it (a first render); marks it recently shown. */
    peek(key: string): string | undefined {
        return this.touch(key)?.url;
    }

    /**
     * Keeps `blob` as the cover for `key` and holds it for the caller. Undefined (nothing kept)
     * for an empty body or a document. A cover already kept is held and returned instead.
     */
    put(key: string, blob: Blob): string | undefined {
        if (blob.size === 0 || !isImageBody(blob.type)) return undefined;
        const kept = this.take(key);
        if (kept) return kept;
        const entry: Entry = {
            blob,
            detached: false,
            holders: 1,
            key,
            url: this.urls.create(blob),
        };
        this.entries.set(key, entry);
        this.byUrl.set(entry.url, entry);
        this.bytes += blob.size;
        this.trim();
        return entry.url;
    }

    /** Lets go of a URL from `take` or `put`. */
    release(url: string) {
        const entry = this.byUrl.get(url);
        if (!entry || entry.holders === 0) return;
        entry.holders -= 1;
        if (entry.holders > 0) return;
        if (entry.detached) this.free(entry);
        else this.trim();
    }

    size() {
        return { bytes: this.bytes, entries: this.entries.size };
    }

    /** The cover's URL, held for the caller until `release`. */
    take(key: string): string | undefined {
        const entry = this.touch(key);
        if (!entry) return undefined;
        entry.holders += 1;
        return entry.url;
    }

    private detach(entry: Entry) {
        this.entries.delete(entry.key);
        this.bytes -= entry.blob.size;
        entry.detached = true;
        if (entry.holders === 0) this.free(entry);
    }

    private free(entry: Entry) {
        this.byUrl.delete(entry.url);
        this.urls.revoke(entry.url);
    }

    private touch(key: string): Entry | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry;
    }

    private trim() {
        if (this.bytes <= this.maxBytes && this.entries.size <= this.maxEntries) return;
        for (const entry of [...this.entries.values()]) {
            if (this.bytes <= this.maxBytes && this.entries.size <= this.maxEntries) return;
            if (entry.holders === 0) this.detach(entry);
        }
    }
}

export const imageMemoryCache = new ImageMemoryCache();

/**
 * A cover's URL, held for the caller (who `release`s it): from memory when this session has shown
 * it, else fetched (`fetchImage`: the per-server slots and B-412's re-asks) and kept.
 */
export const loadCachedImage = async (
    request: {
        cacheKey?: string;
        credentials?: RequestCredentials;
        headers?: HeadersInit;
        url: string;
    },
    init: RequestInit & { priority?: 'auto' | 'high' | 'low' },
    options?: Parameters<typeof fetchImage>[2],
    cache: ImageMemoryCache = imageMemoryCache,
): Promise<string> => {
    const key = request.cacheKey || request.url;
    const kept = cache.take(key);
    if (kept) return kept;
    const blob = await fetchImage(request, init, options);
    const url = cache.put(key, blob);
    if (!url) throw new Error('Not an image');
    return url;
};
