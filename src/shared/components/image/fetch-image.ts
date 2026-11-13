import { isImageBody } from './shown-stack.ts';

/**
 * B-412: an image's bytes, or a rejection.
 *
 * Why a cover can come back as `200` with nothing in it (Navidrome 0.64.2, read): the songs of one
 * disc share one resized-cover cache entry; the first request writes it while the others read it
 * as it is written, and when the writer's request is cancelled the entry closes empty, so every
 * reader of that wave gets an empty 200. So:
 * - **A sent request is never cancelled.** The caller's abort rejects its promise at once, but the
 *   request runs to its end (and its bytes are dropped), so it cannot empty other songs' covers.
 *   A request still waiting for a slot is dropped without being sent.
 * - **At most `MAX_IN_FLIGHT` cover requests per server at once**, so one page does not open a
 *   burst of them (the waves above are what a burst makes).
 * - **An empty 200, a 429 or a 5xx is asked again** after `delaysMs`, past the HTTP cache
 *   (`cache: 'reload'`, so the empty answer Chromium stored is not handed back). A non-image
 *   document under 200 (a Subsonic error) and any other status fail at once.
 * - **Re-asks to one server go one at a time** (`MAX_REASKS_IN_FLIGHT`). The rows a burst emptied
 *   used to re-ask together, at the same moments: one more wave on the same shared entry, the
 *   condition that emptied them (B-415: asked together, empty; asked one at a time, the JPEG).
 * - **The wait grows** (1, 2, 4, 8, 16, then 30 s): a cover is asked again until it gets an image or
 *   a real error, for about two minutes (9 asks), then it is a failure. The re-walk of
 *   `a96a9de17` lost two rows to the old three asks in ~4 s.
 */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
const MAX_IN_FLIGHT = 4;
const MAX_REASKS_IN_FLIGHT = 1;

export class NotAnImage extends Error {}

const abortError = (signal: AbortSignal) =>
    signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');

/** Rejects when `signal` aborts; never settles otherwise. */
const whenAborted = (signal: AbortSignal | null | undefined) =>
    new Promise<never>((_, reject) => {
        if (!signal) return;
        if (signal.aborted) reject(abortError(signal));
        else signal.addEventListener('abort', () => reject(abortError(signal)), { once: true });
    });

const sleep = (ms: number, signal: AbortSignal | null | undefined) =>
    Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), whenAborted(signal)]);

type Pool = Map<string, { active: number; waiting: (() => void)[] }>;

/** Per server (URL origin): the requests in flight and the ones waiting for a slot. */
const servers: Pool = new Map();
/** Per server: the re-asks in flight (each also holds one of the server's slots). */
const reasks: Pool = new Map();

const slotFor = (pool: Pool, origin: string) => {
    let server = pool.get(origin);
    if (!server) {
        server = { active: 0, waiting: [] };
        pool.set(origin, server);
    }
    return server;
};

/** A slot to send in; rejects (and gives up its place) if the caller aborts while it waits. */
const acquire = (
    pool: Pool,
    limit: number,
    origin: string,
    signal: AbortSignal | null | undefined,
) =>
    new Promise<() => void>((resolve, reject) => {
        const server = slotFor(pool, origin);
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            server.active -= 1;
            server.waiting.shift()?.();
        };
        const take = () => {
            server.active += 1;
            resolve(release);
        };
        if (signal?.aborted) return reject(abortError(signal));
        if (server.active < limit) return take();
        const waiter = () => {
            signal?.removeEventListener('abort', onAbort);
            take();
        };
        const onAbort = () => {
            server.waiting = server.waiting.filter((w) => w !== waiter);
            reject(abortError(signal!));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        server.waiting.push(waiter);
    });

type Answer = { blob: Blob | null; ok: boolean; status: number; type: string };

/** One request, sent in a slot and run to its end whatever the caller does. */
const ask = async (
    request: { credentials?: RequestCredentials; headers?: HeadersInit; url: string },
    init: Omit<RequestInit, 'signal'>,
    reload: boolean,
    signal: AbortSignal | null | undefined,
): Promise<Answer> => {
    const origin = new URL(request.url).origin;
    // A re-ask waits for the server's re-ask lane first, then for one of its slots.
    const releaseLane = reload ? await acquire(reasks, MAX_REASKS_IN_FLIGHT, origin, signal) : null;
    let releaseSlot: () => void;
    try {
        releaseSlot = await acquire(servers, MAX_IN_FLIGHT, origin, signal);
    } catch (error) {
        releaseLane?.();
        throw error;
    }
    const release = () => {
        releaseSlot();
        releaseLane?.();
    };
    const sent = (async (): Promise<Answer> => {
        try {
            const response = await fetch(request.url, {
                ...init,
                ...(reload ? { cache: 'reload' as RequestCache } : {}),
                credentials: request.credentials,
                headers: request.headers,
            });
            const blob = response.ok ? await response.blob() : null;
            const type = blob?.type || response.headers.get('content-type') || '';
            return { blob, ok: response.ok, status: response.status, type };
        } finally {
            release();
        }
    })();
    // The caller may stop waiting; the request itself is not cancelled.
    sent.catch(() => {});
    return Promise.race([sent, whenAborted(signal)]);
};

export const fetchImage = async (
    request: { credentials?: RequestCredentials; headers?: HeadersInit; url: string },
    init: RequestInit & { priority?: 'auto' | 'high' | 'low' },
    options: { delaysMs?: number[] } = {},
): Promise<Blob> => {
    const delays = options.delaysMs ?? RETRY_DELAYS_MS;
    const { signal, ...rest } = init;
    for (let attempt = 0; ; attempt += 1) {
        const answer = await ask(request, rest, attempt > 0, signal);
        const transient = answer.status === 429 || answer.status >= 500;
        if (!answer.ok && !transient) {
            throw new Error(`Failed to load image: ${answer.status}`);
        }
        if (answer.blob && answer.blob.size > 0 && isImageBody(answer.type)) return answer.blob;
        // A document under 200 (a Subsonic error) is the server's answer, not a hiccup.
        if (answer.blob && answer.blob.size > 0)
            throw new NotAnImage(`Not an image: ${answer.type}`);
        if (attempt >= delays.length) {
            throw new Error(`No image after ${attempt + 1} answers (${answer.status}, empty)`);
        }
        await sleep(delays[attempt], signal);
    }
};
