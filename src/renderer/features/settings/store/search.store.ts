import { create } from 'zustand';

/** Where to scroll once the tab a search result opened has mounted. */
export type PendingScroll = { section: string; tab: string };

type SearchState = {
    pendingScroll: null | PendingScroll;
    search: string;
    setPendingScroll: (pending: null | PendingScroll) => void;
    setSearch: (search: string) => void;
};

export const useSettingSearchStore = create<SearchState>((set) => ({
    pendingScroll: null,
    search: '',
    setPendingScroll: (pendingScroll) => set({ pendingScroll }),
    setSearch: (search) => set({ search }),
}));
