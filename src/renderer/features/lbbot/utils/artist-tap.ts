/**
 * B-407 review L1: the taps on lb-bot artist links that wait for a library search. One guard for
 * the whole app: a later tap anywhere supersedes an earlier one, a second tap on a link still
 * pending is ignored (no second history entry), and a lookup that ends after the person moved on
 * navigates nowhere. `pending` is the key of the tap being worked on, for its link's busy state.
 */
export interface TapGuard {
    /** A tap on `key`: its token, or null for a tap on the link already pending. */
    begin: (key: string) => null | number;
    /** The lookup of `token` ended: whether to navigate (the latest tap, and still where it was made). */
    finish: (token: number, stillHere: boolean) => boolean;
    pending: () => null | string;
    subscribe: (listener: () => void) => () => void;
}

export const createTapGuard = (): TapGuard => {
    let latest = 0;
    let pendingKey: null | string = null;
    const listeners = new Set<() => void>();
    const setPending = (key: null | string) => {
        if (pendingKey === key) return;
        pendingKey = key;
        listeners.forEach((listener) => listener());
    };
    return {
        begin: (key) => {
            if (pendingKey === key) return null;
            latest += 1;
            setPending(key);
            return latest;
        },
        finish: (token, stillHere) => {
            if (token !== latest) return false;
            setPending(null);
            return stillHere;
        },
        pending: () => pendingKey,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
};

/** The key a tap is pending under: the row's MBID, else its name. */
export const artistTapKey = (artist: { mbid?: null | string; name?: null | string }): string =>
    artist.mbid || artist.name || '';
