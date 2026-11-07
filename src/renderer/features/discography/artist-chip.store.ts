import { create } from 'zustand';

import { hasEntryIdentity } from '/@/renderer/store/scroll.store';

/**
 * The artist page's selected Discography chip, per history entry (R10): Back to an artist page shows
 * the chip it was left on, as its scroll offset is restored (`scroll.store`, R4), and a new visit
 * starts on Popular releases. Not persisted; an entry with no identity keeps nothing.
 */
type ArtistChipState = {
    chips: Record<string, string>;
    setChip: (entry: string, chip: string) => void;
};

export const useArtistChipStore = create<ArtistChipState>((set) => ({
    chips: {},
    setChip: (entry, chip) => {
        if (!hasEntryIdentity(entry)) return;
        set((state) => ({ chips: { ...state.chips, [entry]: chip } }));
    },
}));
