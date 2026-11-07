/**
 * Worbus P3 (design §6.4, the owner's answer 2): the automatic look - candidates beside Navidrome
 * only, never the sweep - whenever no Worbus Server is set: once after a Navidrome sign-in, and
 * each time the Server tab opens. Pure, so `finder.harness.ts` runs it.
 */
export interface AutoLookDeps {
    /** `isHubConfigured` - "no server set" is its false, never an empty-string test. */
    configured: () => boolean;
    look: (navidromeUrls: string[]) => Promise<unknown>;
    /** The current server's `url` and `remoteUrl`. */
    navidromeUrls: () => string[];
}

/** Returns whether a look was started. */
export const createAutoLook = (deps: AutoLookDeps) => (): boolean => {
    if (deps.configured()) return false;
    const urls = deps.navidromeUrls();
    if (urls.length === 0) return false;
    void deps.look(urls);
    return true;
};
