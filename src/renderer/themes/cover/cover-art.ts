import { useEffect, useState } from 'react';

import { createArtCache } from '/@/renderer/themes/cover/cover-art-cache';

/** Covers decoded for the window wash's artwork; their images are kept so the layer reuses them. */
const LIMIT = 8;
const kept: HTMLImageElement[] = [];

export const artCache = createArtCache((src) => {
    // The same request the art layer's `background-image` makes (no CORS mode), so it is served from
    // this load even when the server forbids caching (Navidrome answers placeholders `no-store`).
    const image = new Image();
    image.src = src;
    kept.push(image);
    if (kept.length > LIMIT) kept.shift();
    return image.decode();
}, LIMIT);

/**
 * Whether `src`'s artwork is decoded; starts its load when it is not. The answer is kept in state:
 * the React Compiler memoizes `artCache.isReady(src)` by `src`, so a rerender alone would not re-read it.
 */
export const useArtReady = (src?: null | string): boolean => {
    const [readySrc, setReadySrc] = useState<null | string>(null);
    const ready = Boolean(src) && (readySrc === src || artCache.isReady(src as string));

    useEffect(() => {
        if (!src || readySrc === src) return undefined;
        let live = true;
        void artCache.preload(src).then(() => {
            if (live) setReadySrc(src);
        });
        return () => {
            live = false;
        };
    }, [readySrc, src]);

    return ready;
};
