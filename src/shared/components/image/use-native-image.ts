import { useEffect, useMemo, useRef, useState } from 'react';

import { imageMemoryCache } from './image-memory-cache';
import {
    type FetchPriority,
    NativeImageCore,
    type NativeImageState,
    signatureOf,
} from './native-image-core';

import { ImageRequest } from '/@/shared/types/domain-types';

interface UseNativeImageArgs {
    enabled: boolean;
    fetchPriority?: FetchPriority;
    onFetchError?: () => void;
    request?: ImageRequest | null;
}

/**
 * An image element's cover, through the memory cache (B-412 follow-up). The logic, and the holds it
 * takes, are `NativeImageCore`'s (driven by its harness the way React drives it here); this is the
 * React wiring: its first render, its effect, its unmount, and a forgotten cover (review M2).
 */
export function useNativeImage({
    enabled,
    fetchPriority,
    onFetchError,
    request,
}: UseNativeImageArgs) {
    const [core] = useState(() => new NativeImageCore(imageMemoryCache));
    // A cover this session has shown is on the first render of a remount (a row scrolled back into
    // a virtualised list), from the memory cache, with no request; pinned until the effect holds it.
    const [state, setState] = useState<NativeImageState>(() => core.first(request));
    const [asked, setAsked] = useState(0);
    const onFetchErrorRef = useRef(onFetchError);
    onFetchErrorRef.current = onFetchError;

    const requestSignature = useMemo(() => signatureOf(request), [request]);

    useEffect(
        () =>
            core.update({
                enabled,
                fetchPriority,
                onFetchError: () => onFetchErrorRef.current?.(),
                request,
                setState,
            }),
        // `asked`: the cover was forgotten (changed on the server); ask again.
        [asked, core, enabled, fetchPriority, request, requestSignature],
    );

    // Review M2: a cover changed from inside the app is asked again by the elements showing it.
    useEffect(
        () =>
            imageMemoryCache.onForget((ids) => {
                if (core.invalidated(ids)) setAsked((count) => count + 1);
            }),
        [core],
    );

    useEffect(() => () => core.unmount(), [core]);

    return {
        displaySrc: state.displaySrc,
        isError: state.status === 'error',
        isLoaded: state.status === 'loaded',
        isLoading: state.status === 'loading',
    };
}
