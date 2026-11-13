import { useEffect, useMemo, useRef, useState } from 'react';

import { imageMemoryCache, loadCachedImage } from './image-memory-cache';

import { ImageRequest } from '/@/shared/types/domain-types';

type FetchPriority = 'auto' | 'high' | 'low';

interface NativeImageState {
    displaySrc?: string;
    status: 'error' | 'idle' | 'loaded' | 'loading';
}

interface UseNativeImageArgs {
    enabled: boolean;
    fetchPriority?: FetchPriority;
    onFetchError?: () => void;
    request?: ImageRequest | null;
}

const cacheKeyOf = (request: ImageRequest) => request.cacheKey || request.url;

export function useNativeImage({
    enabled,
    fetchPriority,
    onFetchError,
    request,
}: UseNativeImageArgs) {
    const abortControllerRef = useRef<AbortController | null>(null);
    const loadedRequestSignatureRef = useRef<null | string>(null);
    const objectUrlRef = useRef<null | string>(null);
    const onFetchErrorRef = useRef(onFetchError);
    // B-412 follow-up: a cover this session has shown is on the first render of a remount (a row
    // scrolled back into a virtualised list), from the memory cache, with no request. The effect
    // below holds it.
    const [state, setState] = useState<NativeImageState>(() => {
        const kept = request ? imageMemoryCache.peek(cacheKeyOf(request)) : undefined;
        return kept ? { displaySrc: kept, status: 'loaded' } : { status: 'idle' };
    });

    const requestSignature = useMemo(() => {
        if (!request) {
            return null;
        }

        return JSON.stringify({
            cacheKey: request.cacheKey,
            credentials: request.credentials,
            headers: request.headers,
            url: request.url,
        });
    }, [request]);

    onFetchErrorRef.current = onFetchError;

    useEffect(() => {
        const abortCurrentRequest = () => {
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
        };

        // The cover stays in the memory cache (bounded there); this element lets go of it.
        const releaseObjectUrl = () => {
            if (!objectUrlRef.current) {
                return;
            }

            imageMemoryCache.release(objectUrlRef.current);
            objectUrlRef.current = null;
            loadedRequestSignatureRef.current = null;
        };

        if (!request || !requestSignature) {
            abortCurrentRequest();
            releaseObjectUrl();
            setState({ status: 'idle' });
            return;
        }

        if (loadedRequestSignatureRef.current === requestSignature && objectUrlRef.current) {
            setState({ displaySrc: objectUrlRef.current, status: 'loaded' });
            return;
        }

        // Shown before (its row scrolled away and back): at once, with no request, whether or not
        // this element may load yet (a cover in memory costs nothing).
        const kept = imageMemoryCache.take(cacheKeyOf(request));
        if (kept) {
            abortCurrentRequest();
            releaseObjectUrl();
            objectUrlRef.current = kept;
            loadedRequestSignatureRef.current = requestSignature;
            setState({ displaySrc: kept, status: 'loaded' });
            return;
        }

        if (!enabled) {
            abortCurrentRequest();
            setState((currentState) =>
                currentState.displaySrc
                    ? { ...currentState, status: 'loaded' }
                    : { status: 'idle' },
            );
            return;
        }

        abortCurrentRequest();
        releaseObjectUrl();
        setState({ status: 'loading' });

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        void (async () => {
            try {
                const init = {
                    signal: abortController.signal,
                } as RequestInit & { priority?: FetchPriority };

                if (fetchPriority) {
                    init.priority = fetchPriority;
                }

                // B-412: one fetch rule (fetch-image.ts): an empty or non-image 200 is no image,
                // and an empty one is asked again past the HTTP cache. An image is kept in memory.
                const objectUrl = await loadCachedImage(request, init);

                if (abortController.signal.aborted) {
                    imageMemoryCache.release(objectUrl);
                    return;
                }

                objectUrlRef.current = objectUrl;
                loadedRequestSignatureRef.current = requestSignature;
                setState({ displaySrc: objectUrl, status: 'loaded' });
            } catch {
                if (abortController.signal.aborted) {
                    return;
                }

                releaseObjectUrl();
                setState({ status: 'error' });
                onFetchErrorRef.current?.();
            } finally {
                if (abortControllerRef.current === abortController) {
                    abortControllerRef.current = null;
                }
            }
        })();

        return () => {
            abortController.abort();

            if (abortControllerRef.current === abortController) {
                abortControllerRef.current = null;
            }
        };
    }, [enabled, fetchPriority, request, requestSignature]);

    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort();

            if (objectUrlRef.current) {
                imageMemoryCache.release(objectUrlRef.current);
                objectUrlRef.current = null;
            }
        };
    }, []);

    return {
        displaySrc: state.displaySrc,
        isError: state.status === 'error',
        isLoaded: state.status === 'loaded',
        isLoading: state.status === 'loading',
    };
}
