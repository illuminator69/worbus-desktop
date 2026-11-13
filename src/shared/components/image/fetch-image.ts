import { isImageBody } from './shown-stack.ts';

/**
 * B-412: an image's bytes, or a rejection. A server under load can answer a cover with HTTP 200 and
 * nothing in it: the owner's Navidrome did for 6 of 12 songs asked in one second (empty body, no
 * Content-Type, `public, no-cache`), and answers the same ids with the JPEG when asked again. So an
 * empty or non-image 200, a 429 and a 5xx are asked again, past the HTTP cache (`cache: 'reload'`,
 * so the empty answer it stored is not handed back), after `delaysMs`; anything else that is not an
 * image is a failure at once. Aborting the signal stops it.
 */
const RETRY_DELAYS_MS = [400, 1500];

export class NotAnImage extends Error {}

const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(signal.reason);
            },
            { once: true },
        );
    });

export const fetchImage = async (
    request: { credentials?: RequestCredentials; headers?: HeadersInit; url: string },
    init: RequestInit & { priority?: 'auto' | 'high' | 'low' },
    options: { delaysMs?: number[] } = {},
): Promise<Blob> => {
    const delays = options.delaysMs ?? RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(request.url, {
            ...init,
            ...(attempt > 0 ? { cache: 'reload' as RequestCache } : {}),
            credentials: request.credentials,
            headers: request.headers,
        });
        const transient = response.status === 429 || response.status >= 500;
        if (!response.ok && !transient) {
            throw new Error(`Failed to load image: ${response.status}`);
        }
        const blob = response.ok ? await response.blob() : null;
        const type = blob?.type || response.headers.get('content-type') || '';
        if (blob && blob.size > 0 && isImageBody(type)) return blob;
        // A document under 200 (a Subsonic error) is the server's answer, not a hiccup.
        if (blob && blob.size > 0) throw new NotAnImage(`Not an image: ${type}`);
        if (attempt >= delays.length) {
            throw new Error(`No image after ${attempt + 1} answers (${response.status}, empty)`);
        }
        if (init.signal) await sleep(delays[attempt], init.signal);
        else await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
};
