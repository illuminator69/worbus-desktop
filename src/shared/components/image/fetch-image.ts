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
 *   document under 200 (a Subsonic error), a 501 or 505, and any other status fail at once. Only
 *   Navidrome's empty `getCoverArt` gets the whole schedule; the rest `SHORT_REASKS` (review L1).
 * - **Re-asks to one server go one at a time** (`MAX_REASKS_IN_FLIGHT`). The rows a burst emptied
 *   used to re-ask together, at the same moments: one more wave on the same shared entry, the
 *   condition that emptied them (B-415: asked together, empty; asked one at a time, the JPEG).
 * - **The wait grows** (1, 2, 4, 8, 16, then 30 s): a cover is asked again until it gets an image or
 *   a real error, for about two minutes (9 asks), then it is a failure. The re-walk of
 *   `a96a9de17` lost two rows to the old three asks in ~4 s.
 * - **Every cover ends** (review M1): a re-ask unanswered after `REASK_TIMEOUT_MS` is cancelled
 *   (it is not a working writer of the shared entry by then) and counts as one more empty answer;
 *   a row that goes away gives the lane back at once; and the whole cover, waiting for the lane
 *   included, has `GIVE_UP_AFTER_MS`, after which it is a failure (the empty-art icon). One stalled
 *   re-ask used to hold the lane for good and leave every other emptied row on that server loading.
 */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
/** A re-ask with no answer after this is cancelled and counts as empty (review M1). */
export const REASK_TIMEOUT_MS = 20_000;
/** A cover with no image after this, its waits and lane waiting included, is a failure. */
export const GIVE_UP_AFTER_MS = 150_000;
/**
 * Review L1: re-asks for any other transient answer (a 5xx or 429, an empty 200 from a host that is
 * not a Subsonic cover endpoint): 4 asks in about 7 s, as a host that is rate limiting or has no
 * art for the item will not answer differently in two minutes, and its re-asks would queue in the
 * server's one lane ahead of real recoveries. The whole schedule is for B-415's case alone.
 */
export const SHORT_REASKS = 3;
const MAX_IN_FLIGHT = 4;

/** Navidrome's (Subsonic's) cover endpoint, under any base path: B-415's burst-emptied entry. */
const isSubsonicCover = (url: string) => {
    try {
        return /\/rest\/getCoverArt(\.view)?$/.test(new URL(url).pathname);
    } catch {
        return false;
    }
};

/** A 5xx that says the server will not do this at all (Not Implemented, Version Not Supported). */
const DEFINITIVE_5XX = new Set([501, 505]);
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

type Answer = { blob: Blob | null; ok: boolean; status: number; timedOut?: boolean; type: string };

const isImage = (answer: Answer) =>
    answer.ok && !!answer.blob && answer.blob.size > 0 && isImageBody(answer.type);

/**
 * One request, sent in a slot and run to its end whatever the caller does; `timeoutMs` (a re-ask's,
 * or the budget for a first ask) is the one thing that cancels it.
 */
const ask = async (
    request: { credentials?: RequestCredentials; headers?: HeadersInit; url: string },
    init: Omit<RequestInit, 'signal'>,
    reload: boolean,
    signal: AbortSignal,
    timeoutMs: number,
    onLate?: (blob: Blob) => void,
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
    // Review M1: a row that goes away (or a cover past its budget) gives the lane back now; its
    // request runs on in its slot until it ends or times out.
    const onGone = () => releaseLane?.();
    signal.addEventListener('abort', onGone, { once: true });
    const release = () => {
        signal.removeEventListener('abort', onGone);
        releaseSlot();
        releaseLane?.();
    };
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const sent = (async (): Promise<Answer> => {
        try {
            const response = await fetch(request.url, {
                ...init,
                ...(reload ? { cache: 'reload' as RequestCache } : {}),
                credentials: request.credentials,
                headers: request.headers,
                signal: timeout.signal,
            });
            const blob = response.ok ? await response.blob() : null;
            const type = blob?.type || response.headers.get('content-type') || '';
            return { blob, ok: response.ok, status: response.status, type };
        } catch (error) {
            if (timeout.signal.aborted)
                return { blob: null, ok: false, status: 0, timedOut: true, type: '' };
            throw error;
        } finally {
            clearTimeout(timer);
            release();
        }
    })();
    // The caller may stop waiting; the request itself is not cancelled.
    sent.catch(() => {});
    // Review L3: an image that arrives after the caller stopped waiting is handed on, not dropped.
    if (onLate) {
        void sent.then(
            (answer) => {
                if (signal.aborted && isImage(answer)) onLate(answer.blob!);
            },
            () => {},
        );
    }
    return Promise.race([sent, whenAborted(signal)]);
};

export const fetchImage = async (
    request: { credentials?: RequestCredentials; headers?: HeadersInit; url: string },
    init: RequestInit & { priority?: 'auto' | 'high' | 'low' },
    options: {
        budgetMs?: number;
        delaysMs?: number[];
        /** Review L3: an image that arrived after the caller aborted (the request ran on). */
        onLateImage?: (blob: Blob) => void;
        reaskTimeoutMs?: number;
    } = {},
): Promise<Blob> => {
    const delays = options.delaysMs ?? RETRY_DELAYS_MS;
    const budgetMs = options.budgetMs ?? GIVE_UP_AFTER_MS;
    const reaskTimeoutMs = options.reaskTimeoutMs ?? REASK_TIMEOUT_MS;
    const { signal: callerSignal, ...rest } = init;
    // Review M1: the cover's budget, from its first ask; lane and slot waiting count in it.
    const budget = new AbortController();
    const budgetTimer = setTimeout(
        () => budget.abort(new Error(`No image within ${budgetMs} ms`)),
        budgetMs,
    );
    const signal = callerSignal ? AbortSignal.any([callerSignal, budget.signal]) : budget.signal;
    const coverEndpoint = isSubsonicCover(request.url);
    try {
        for (let attempt = 0; ; attempt += 1) {
            const answer = await ask(
                request,
                rest,
                attempt > 0,
                signal,
                attempt > 0 ? reaskTimeoutMs : budgetMs,
                options.onLateImage,
            );
            const transient =
                answer.status === 429 ||
                (answer.status >= 500 && !DEFINITIVE_5XX.has(answer.status)) ||
                !!answer.timedOut;
            if (!answer.ok && !transient) {
                throw new Error(`Failed to load image: ${answer.status}`);
            }
            if (answer.blob && answer.blob.size > 0 && isImageBody(answer.type)) return answer.blob;
            // A document under 200 (a Subsonic error) is the server's answer, not a hiccup.
            if (answer.blob && answer.blob.size > 0)
                throw new NotAnImage(`Not an image: ${answer.type}`);
            // Review L1: the whole schedule only for an empty (or unanswered) Subsonic cover.
            const burstEmptied = (answer.ok || answer.timedOut) && coverEndpoint;
            const asksAgain = burstEmptied ? delays.length : Math.min(SHORT_REASKS, delays.length);
            if (attempt >= asksAgain) {
                throw new Error(`No image after ${attempt + 1} answers (${answer.status}, empty)`);
            }
            await sleep(delays[attempt], signal);
        }
    } finally {
        clearTimeout(budgetTimer);
    }
};
