import { useEffect, useRef, useState } from 'react';

import { type CoverSeed } from '/@/renderer/themes/cover/cover-roles';
import {
    getCachedSeed,
    readLastSeed,
    resolveCoverSeed,
} from '/@/renderer/themes/cover/cover-seed-store';

/**
 * The seed for a cover. A cached seed comes back in the same render (`resolved: true`); otherwise the
 * previous seed (the last one returned, or the last seed kept from the previous run) until the load
 * finishes. A failed load or a missing `src` stays unresolved and keeps the previous seed.
 */
export const useCoverSeed = ({
    key,
    src,
}: {
    key?: string;
    src?: null | string;
}): { resolved: boolean; seed: CoverSeed } => {
    // The last seed known, and the key it belongs to. A loaded seed must land here, in state: the
    // React Compiler memoizes `getCachedSeed(key)` by `key`, so a rerender alone would not re-read it.
    const [known, setKnown] = useState<{ key?: string; seed: CoverSeed }>(() => ({
        seed: readLastSeed(),
    }));
    const request = useRef(0);
    const cached = key ? getCachedSeed(key) : undefined;

    if (cached && (known.key !== key || known.seed !== cached)) setKnown({ key, seed: cached });

    useEffect(() => {
        const id = ++request.current;
        if (!key || !src) return;
        // Also when cached: the seed may have landed (another consumer's load) after this render read
        // the cache. A cached key resolves without a load.
        void resolveCoverSeed(key, src).then((seed) => {
            // Only the latest request applies; a slower, older cover never lands over a newer one.
            if (!seed || id !== request.current) return;
            setKnown((prev) => (prev.key === key && prev.seed === seed ? prev : { key, seed }));
        });
    }, [key, src]);

    return {
        resolved: Boolean(key) && (cached !== undefined || known.key === key),
        seed: cached ?? known.seed,
    };
};
