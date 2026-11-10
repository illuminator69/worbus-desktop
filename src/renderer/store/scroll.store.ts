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
 * B-315: the key this history entry's scroll offset (and chip) is kept under.
 */
export const entryKeyFor = (
    locationKey: string,
    _history: EntryHistory,
    _mint: () => string,
): string => locationKey;

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
