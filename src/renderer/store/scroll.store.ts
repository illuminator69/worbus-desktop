import { create } from 'zustand';

/**
 * React Router reads a history entry it did not create (state null: a hash assigned from code,
 * `location.replace`, the first entry of a session) back with the key "default", and delivers a hash
 * change as a POP. Offsets are kept per key and restored on POP, so those entries would all share one
 * offset (B-208: a forward push opening mid-scroll). A key that names no particular entry is not an
 * identity: nothing is stored under it and nothing is read from it.
 */
export const hasEntryIdentity = (key: string): boolean => key !== '' && key !== 'default';

/** The part of `window.history` the entry key needs (a harness passes a fake). */
export interface EntryHistory {
    replaceState: (state: unknown, unused: string) => void;
    readonly state: unknown;
}

/**
 * B-315: the key this history entry's scroll offset (and chip) is kept under. The router's own
 * key when it gave one. An entry it did not create (a hash assigned from code, `location.replace`,
 * the first entry of a session) reads back as "default": B-208 kept nothing under that, so such an
 * entry had no identity and Back to it landed at the top. It gets one stamped into its own
 * history state, beside the router's `idx` and `usr`; react-router reads `history.state.key` back
 * as `location.key` when the entry is popped to, so it keeps its offset like any other.
 */
export const entryKeyFor = (
    locationKey: string,
    history: EntryHistory,
    mint: () => string,
): string => {
    if (hasEntryIdentity(locationKey)) return locationKey;
    const state = (history.state ?? {}) as Record<string, unknown>;
    if (typeof state.key === 'string' && hasEntryIdentity(state.key)) return state.key;
    const key = mint();
    history.replaceState({ ...state, key }, '');
    return key;
};

/** A key in react-router's own form (`createKey`: base36, 8 characters). */
export const mintEntryKey = (): string => Math.random().toString(36).substring(2, 10);

type ScrollState = {
    getOffset: (key: string) => number | undefined;
    offsets: Record<string, number>;
    setOffset: (key: string, offset: number) => void;
};

export const useScrollStore = create<ScrollState>((set, get) => ({
    getOffset: (key) => (hasEntryIdentity(key) ? get().offsets[key] : undefined),
    offsets: {},
    setOffset: (key, offset) => {
        if (!hasEntryIdentity(key)) return;
        set((s) => ({
            offsets: { ...s.offsets, [key]: offset },
        }));
    },
}));
