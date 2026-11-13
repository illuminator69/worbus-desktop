import {
    ImageMemoryCache,
    imageMemoryCache,
    itemIdOf,
    loadCachedImage,
} from './image-memory-cache.ts';

/**
 * What `useNativeImage` does, outside React (review L4: the harness drives it the way React does).
 * One instance per image element. The holds it takes on the memory cache are the risky part:
 * - **`first`** (the first render): a cover this session has shown, pinned (review L1) so another
 *   row's fetch between the render and the effect cannot revoke it.
 * - **`update`** (the effect, on every request change): holds the cover it shows in `objectUrl`;
 *   the one before is let go only after the new one is held. Returns the effect's cleanup, which
 *   aborts that run's fetch; a fetch that still arrives is let go at once (and kept, review L3).
 * - **`invalidated`**: the cover it shows was forgotten (`forgetItems`, review M2); the caller runs
 *   the effect again, which asks again while the old image stays on screen.
 * - **`unmount`**: aborts and lets go.
 */
export type FetchPriority = 'auto' | 'high' | 'low';

export interface NativeImageRequest {
    cacheKey?: string;
    credentials?: RequestCredentials;
    headers?: HeadersInit;
    url: string;
}

export interface NativeImageState {
    displaySrc?: string;
    status: 'error' | 'idle' | 'loaded' | 'loading';
}

type SetState = (
    update: ((state: NativeImageState) => NativeImageState) | NativeImageState,
) => void;

const keyOf = (request: NativeImageRequest) => request.cacheKey || request.url;

export const signatureOf = (request?: NativeImageRequest | null): null | string =>
    request
        ? JSON.stringify({
              cacheKey: request.cacheKey,
              credentials: request.credentials,
              headers: request.headers,
              url: request.url,
          })
        : null;

export class NativeImageCore {
    onFetchError?: () => void;
    /** The URL this element holds (and shows), if any. */
    get held(): null | string {
        return this.objectUrl;
    }

    private abortController: AbortController | null = null;

    private readonly cache: ImageMemoryCache;
    private readonly load: typeof loadCachedImage;
    private loadedSignature: null | string = null;
    private objectUrl: null | string = null;
    private pin: null | { unpin: () => void; url: string } = null;
    private request: NativeImageRequest | null = null;
    constructor(cache: ImageMemoryCache = imageMemoryCache, load = loadCachedImage) {
        this.cache = cache;
        this.load = load;
    }

    /** The first render's state: from memory when this session has shown the cover (pinned). */
    first(request?: NativeImageRequest | null): NativeImageState {
        this.pin?.unpin();
        this.pin = request ? (this.cache.pin(keyOf(request)) ?? null) : null;
        return this.pin ? { displaySrc: this.pin.url, status: 'loaded' } : { status: 'idle' };
    }

    /** Review M2: whether the cover shown was among `ids` (now forgotten); if so, ask again. */
    invalidated(ids: ReadonlySet<string>): boolean {
        if (!this.request || !ids.has(itemIdOf(keyOf(this.request)))) return false;
        this.loadedSignature = null;
        return true;
    }

    setState: SetState = () => {};

    unmount() {
        this.abortController?.abort();
        this.abortController = null;
        this.releaseObjectUrl();
        this.dropPin();
    }

    update(args: {
        enabled: boolean;
        fetchPriority?: FetchPriority;
        /** The element's error callback (the hook passes one that reads its latest). */
        onFetchError?: () => void;
        request?: NativeImageRequest | null;
        /** The element's state setter (React's, stable). */
        setState?: SetState;
    }): (() => void) | undefined {
        if (args.setState) this.setState = args.setState;
        if (args.onFetchError) this.onFetchError = args.onFetchError;
        try {
            return this.run(args);
        } finally {
            // After this run has taken its own hold: the first render's pin is no longer needed.
            this.dropPin();
        }
    }

    private abortCurrentRequest() {
        this.abortController?.abort();
        this.abortController = null;
    }

    private dropPin() {
        this.pin?.unpin();
        this.pin = null;
    }

    // The cover stays in the memory cache (bounded there); this element lets go of it.
    private releaseObjectUrl() {
        const url = this.objectUrl;
        if (!url) return;
        this.objectUrl = null;
        this.loadedSignature = null;
        this.cache.release(url);
    }

    private run({
        enabled,
        fetchPriority,
        request,
    }: {
        enabled: boolean;
        fetchPriority?: FetchPriority;
        request?: NativeImageRequest | null;
    }): (() => void) | undefined {
        const signature = signatureOf(request);
        this.request = request ?? null;

        if (!request || !signature) {
            this.abortCurrentRequest();
            this.releaseObjectUrl();
            this.setState({ status: 'idle' });
            return undefined;
        }

        if (this.loadedSignature === signature && this.objectUrl) {
            this.setState({ displaySrc: this.objectUrl, status: 'loaded' });
            return undefined;
        }

        // Shown before (its row scrolled away and back): at once, with no request, whether or not
        // this element may load yet (a cover in memory costs nothing). Taken before the old one is
        // let go, so a cover shared by both never reaches no holder in between.
        const kept = this.cache.take(keyOf(request));
        if (kept) {
            this.abortCurrentRequest();
            this.setState({ displaySrc: kept, status: 'loaded' });
            this.releaseObjectUrl();
            this.objectUrl = kept;
            this.loadedSignature = signature;
            return undefined;
        }

        if (!enabled) {
            this.abortCurrentRequest();
            this.setState((current) =>
                current.displaySrc ? { ...current, status: 'loaded' } : { status: 'idle' },
            );
            return undefined;
        }

        // The state moves off the old cover before it is let go (the <img> that already shows it
        // keeps its decoded image; image.tsx stacks it under the next one).
        this.abortCurrentRequest();
        this.setState({ status: 'loading' });
        this.releaseObjectUrl();

        const abortController = new AbortController();
        this.abortController = abortController;

        void (async () => {
            try {
                const init = { signal: abortController.signal } as RequestInit & {
                    priority?: FetchPriority;
                };
                if (fetchPriority) init.priority = fetchPriority;

                // B-412: one fetch rule (fetch-image.ts): an empty or non-image 200 is no image,
                // and an empty one is asked again past the HTTP cache. An image is kept in memory.
                const objectUrl = await this.load(request, init, undefined, this.cache);

                if (abortController.signal.aborted) {
                    this.cache.release(objectUrl);
                    return;
                }

                this.objectUrl = objectUrl;
                this.loadedSignature = signature;
                this.setState({ displaySrc: objectUrl, status: 'loaded' });
            } catch {
                if (abortController.signal.aborted) return;
                this.releaseObjectUrl();
                this.setState({ status: 'error' });
                this.onFetchError?.();
            } finally {
                if (this.abortController === abortController) this.abortController = null;
            }
        })();

        return () => {
            abortController.abort();
            if (this.abortController === abortController) this.abortController = null;
        };
    }
}
