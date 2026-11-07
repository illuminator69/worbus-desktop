/**
 * Which covers' artwork is loaded and decoded, so the window wash can change its colours and its
 * artwork in the same frame. One load per cover however many ask; a cover that fails is ready too
 * (it shows as an empty layer, never the previous cover). The last `limit` stay ready. Pure: the
 * loader is passed in, so node can run the harness.
 */
export interface ArtCache {
    isReady: (src: string) => boolean;
    preload: (src: string) => Promise<void>;
}

export const createArtCache = (load: (src: string) => Promise<void>, limit: number): ArtCache => {
    // Insertion order is recency: a use moves the key to the end.
    const ready = new Set<string>();
    const inflight = new Map<string, Promise<void>>();

    const touch = (src: string) => {
        ready.delete(src);
        ready.add(src);
        while (ready.size > limit) ready.delete(ready.values().next().value as string);
    };

    return {
        isReady: (src) => ready.has(src),
        preload: (src) => {
            if (ready.has(src)) {
                touch(src);
                return Promise.resolve();
            }
            let pending = inflight.get(src);
            if (!pending) {
                pending = load(src)
                    .catch(() => undefined)
                    .then(() => {
                        inflight.delete(src);
                        touch(src);
                    });
                inflight.set(src, pending);
            }
            return pending;
        },
    };
};
