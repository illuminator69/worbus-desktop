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
 *   element holds it any more (`take`/`put`/`pin` hold, `release` lets go).
 * - **Bounded** by bytes and by count, least recently shown first. A cover on screen is never
 *   evicted under its element; it can go once released.
 * - **Two budgets** (review M1): a full-size cover (a server request with no size: the full-screen
 *   player's, per song) or a body over `LARGE_BODY_BYTES` is kept in a small budget of its own, so
 *   a few originals of several MB cannot push out the hundreds of list covers this exists for. A
 *   body over `MAX_KEPT_BODY_BYTES` is shown and never kept.
 * - **Never an empty or non-image answer** (B-412): `put` refuses a body of nothing or a document,
 *   so a failed cover is asked again on the next mount.
 * - **A cover changed from inside the app is forgotten** (review M2, `forgetItems`): every size of
 *   the named items goes, the elements showing one are told (`onForget`) and ask again, and a fetch
 *   that was in flight when they were forgotten is shown but not kept. Navidrome 0.64.2 answers a
 *   cover `Cache-Control: public, no-cache` with an ETag carrying the album's update time
 *   (measured), so the ask is a revalidation that brings the new image once Navidrome has
 *   rescanned.
 */
export const MEMORY_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const MEMORY_CACHE_MAX_ENTRIES = 2000;
/** Review M1: a body above this is "large" and kept in the large budget. */
export const LARGE_BODY_BYTES = 1024 * 1024;
/** Review M1: the large budget (full-size and large covers), apart from the list covers'. */
export const LARGE_MAX_BYTES = 24 * 1024 * 1024;
/** Review M1: a body above this is shown (held) but never kept. */
export const MAX_KEPT_BODY_BYTES = 12 * 1024 * 1024;
/** Review L1: how long a first render's `pin` holds a cover if no effect ever takes it. */
export const PIN_MS = 10_000;

type Entry = {
    blob: Blob;
    detached: boolean;
    holders: number;
    key: string;
    large: boolean;
    url: string;
};

type UrlApi = { create: (blob: Blob) => string; revoke: (url: string) => void };

const objectUrls: UrlApi = {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
};

/** A server cover's key (`<type>:<server id>:<base URL>:<id>:<size>`, the controllers'). */
const SERVER_KEY = /^(subsonic|jellyfin):/;

/**
 * The item a cover key names: the image id of a server cover (the base URL may hold colons, the id
 * and size do not), else the key itself (a plain URL).
 */
export const itemIdOf = (key: string): string => {
    if (!SERVER_KEY.test(key)) return key;
    const last = key.lastIndexOf(':');
    return key.slice(key.lastIndexOf(':', last - 1) + 1, last);
};

/** A server cover asked for with no size: the original image, at full size. */
const isFullSizeKey = (key: string) => SERVER_KEY.test(key) && key.endsWith(':');

export type ImageMemoryCacheLimits = {
    largeBodyBytes?: number;
    largeMaxBytes?: number;
    maxBytes?: number;
    maxEntries?: number;
    maxKeptBodyBytes?: number;
    pinMs?: number;
};

export class ImageMemoryCache {
    private readonly byUrl = new Map<string, Entry>();
    /** In Map order: the least recently shown first. */
    private readonly entries = new Map<string, Entry>();
    /** Per item id, the `version` it was last forgotten at (M2: a fetch in flight then is not kept). */
    private readonly forgottenAt = new Map<string, number>();
    private readonly largeBodyBytes: number;
    private largeBytes = 0;
    private largeEntries = 0;
    private readonly largeMaxBytes: number;
    private readonly listeners = new Set<(ids: ReadonlySet<string>) => void>();
    private readonly maxBytes: number;
    private readonly maxEntries: number;
    private readonly maxKeptBodyBytes: number;
    private readonly pinMs: number;
    /** B-428: per key, the forget `version` its last revalidating fetch answered. */
    private readonly revalidatedAt = new Map<string, number>();
    private smallBytes = 0;
    private readonly urls: UrlApi;
    private version = 0;

    constructor(limits: ImageMemoryCacheLimits = {}, urls: UrlApi = objectUrls) {
        this.maxBytes = limits.maxBytes ?? MEMORY_CACHE_MAX_BYTES;
        this.maxEntries = limits.maxEntries ?? MEMORY_CACHE_MAX_ENTRIES;
        this.largeBodyBytes = limits.largeBodyBytes ?? LARGE_BODY_BYTES;
        this.largeMaxBytes = limits.largeMaxBytes ?? LARGE_MAX_BYTES;
        this.maxKeptBodyBytes = limits.maxKeptBodyBytes ?? MAX_KEPT_BODY_BYTES;
        this.pinMs = limits.pinMs ?? PIN_MS;
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

    /**
     * Review M2: the covers of these items changed (an album's cover, its songs'). Every size of
     * each is dropped, a fetch in flight for one is not kept, and `onForget` listeners (the elements
     * showing one) are told, so they ask again.
     */
    forgetItems(ids: Iterable<string>) {
        const wanted = new Set([...ids].filter(Boolean));
        if (wanted.size === 0) return;
        this.version += 1;
        for (const id of wanted) this.forgottenAt.set(id, this.version);
        for (const entry of [...this.entries.values()]) {
            if (wanted.has(itemIdOf(entry.key))) this.detach(entry);
        }
        for (const listener of [...this.listeners]) listener(wanted);
    }

    /** The holds outstanding, kept or not (the harness: 0 once every element has let go). */
    holdCount() {
        let holds = 0;
        for (const entry of this.byUrl.values()) holds += entry.holders;
        return holds;
    }

    /** A version to pass to `put` as `since`: taken before a fetch starts (M2). */
    mark(): number {
        return this.version;
    }

    /**
     * B-428: a Navidrome cover id carries its version (`<id>&_=<imageHash>`) and Navidrome answers
     * the current one `immutable`, so Chromium's HTTP cache answers an old version's URL from disk.
     * After `forgetItems` the cover is asked again under the id the app holds, which may still be
     * the old version (the queue's songs, a list not refetched yet): its first fetch per key must
     * revalidate. Returns the forget version to revalidate against, or 0 for an ordinary fetch.
     */
    mustRevalidate(key: string): number {
        const forgot = this.forgottenAt.get(itemIdOf(key)) ?? 0;
        return forgot > (this.revalidatedAt.get(key) ?? 0) ? forgot : 0;
    }

    /** Review M2: told the item ids `forgetItems` dropped. Returns the unsubscribe. */
    onForget(listener: (ids: ReadonlySet<string>) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** The cover's URL without holding it; marks it recently shown. */
    peek(key: string): string | undefined {
        return this.touch(key)?.url;
    }

    /**
     * Review L1: the cover's URL for a first render, held until `unpin` (the element's effect,
     * once it has taken its own hold) or `pinMs`, whichever comes first, so another row's `put`
     * between the render and the effect cannot revoke it. A render React throws away is let go by
     * the timer.
     */
    pin(key: string): undefined | { unpin: () => void; url: string } {
        const url = this.take(key);
        if (!url) return undefined;
        let pinned = true;
        const unpin = () => {
            if (!pinned) return;
            pinned = false;
            clearTimeout(timer);
            this.release(url);
        };
        const timer = setTimeout(unpin, this.pinMs);
        (timer as { unref?: () => void }).unref?.();
        return { unpin, url };
    }

    /**
     * Keeps `blob` as the cover for `key` and holds it for the caller. Undefined (nothing kept)
     * for an empty body or a document. A cover already kept is held and returned instead. A body
     * too large to keep, or one whose item was forgotten after `since` (a `mark()` taken before
     * its fetch), is held for the caller and not kept.
     */
    put(key: string, blob: Blob, options: { since?: number } = {}): string | undefined {
        if (blob.size === 0 || !isImageBody(blob.type)) return undefined;
        const kept = this.take(key);
        if (kept) return kept;
        const stale =
            options.since !== undefined &&
            (this.forgottenAt.get(itemIdOf(key)) ?? 0) > options.since;
        const entry: Entry = {
            blob,
            detached: false,
            holders: 1,
            key,
            large: blob.size > this.largeBodyBytes || isFullSizeKey(key),
            url: this.urls.create(blob),
        };
        this.byUrl.set(entry.url, entry);
        if (stale || blob.size > this.maxKeptBodyBytes) {
            // Shown, never kept: freed when its element lets go.
            entry.detached = true;
            return entry.url;
        }
        this.entries.set(key, entry);
        this.account(entry, 1);
        this.trim();
        return entry.url;
    }

    /** Lets go of a URL from `take`, `put` or `pin`. */
    release(url: string) {
        const entry = this.byUrl.get(url);
        if (!entry || entry.holders === 0) return;
        entry.holders -= 1;
        if (entry.holders > 0) return;
        if (entry.detached) this.free(entry);
        else this.trim();
    }

    /** B-428: `key` was fetched revalidating since forget `version` (`mustRevalidate`). */
    revalidated(key: string, version: number) {
        if (version > (this.revalidatedAt.get(key) ?? 0)) this.revalidatedAt.set(key, version);
    }

    size() {
        return {
            bytes: this.smallBytes + this.largeBytes,
            entries: this.entries.size,
            largeBytes: this.largeBytes,
        };
    }

    /** The cover's URL, held for the caller until `release`. */
    take(key: string): string | undefined {
        const entry = this.touch(key);
        if (!entry) return undefined;
        entry.holders += 1;
        return entry.url;
    }

    private account(entry: Entry, sign: -1 | 1) {
        if (entry.large) {
            this.largeBytes += sign * entry.blob.size;
            this.largeEntries += sign;
        } else {
            this.smallBytes += sign * entry.blob.size;
        }
    }

    private detach(entry: Entry) {
        this.entries.delete(entry.key);
        this.account(entry, -1);
        entry.detached = true;
        if (entry.holders === 0) this.free(entry);
    }

    private free(entry: Entry) {
        this.byUrl.delete(entry.url);
        this.urls.revoke(entry.url);
    }

    private largeOver() {
        return this.largeBytes > this.largeMaxBytes;
    }

    private smallOver() {
        return (
            this.smallBytes > this.maxBytes ||
            this.entries.size - this.largeEntries > this.maxEntries
        );
    }

    private touch(key: string): Entry | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry;
    }

    /** Each budget evicts its own entries only, least recently shown first, never one held. */
    private trim() {
        if (!this.smallOver() && !this.largeOver()) return;
        for (const entry of [...this.entries.values()]) {
            const small = this.smallOver();
            const large = this.largeOver();
            if (!small && !large) return;
            if (entry.holders > 0) continue;
            if (entry.large ? large : small) this.detach(entry);
        }
    }
}

export const imageMemoryCache = new ImageMemoryCache();

/**
 * A cover's URL, held for the caller (who `release`s it): from memory when this session has shown
 * it, else fetched (`fetchImage`: the per-server slots and B-412's re-asks) and kept. Review L3: a
 * cover whose caller went away (the row scrolled out) while its sent request ran on is kept when it
 * arrives, so scroll-back does not ask again.
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
    const since = cache.mark();
    // B-428: the first fetch of a forgotten cover revalidates (`mustRevalidate`).
    const revalidate = cache.mustRevalidate(key);
    const blob = await fetchImage(request, revalidate ? { ...init, cache: 'no-cache' } : init, {
        ...options,
        onLateImage: (late) => {
            const url = cache.put(key, late, { since });
            if (url) cache.release(url);
        },
    });
    const url = cache.put(key, blob, { since });
    if (!url) throw new Error('Not an image');
    if (revalidate) cache.revalidated(key, revalidate);
    return url;
};
