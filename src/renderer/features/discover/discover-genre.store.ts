import { create } from 'zustand';

/**
 * Which Deezer genre the two browse rows are scoped to.
 *
 * **One genre for both rows, deliberately.** Charts and Editorial are two views
 * of one source; letting them sit on different genres would put two chart-shaped
 * rows on screen with nothing saying which was which. Worbus for Android reached the same
 * conclusion with one chip row above both.
 *
 * Not persisted, unlike `fresh-filters.store`. A genre is a question you have
 * while you are looking at the shelf — a chip that survived a restart would make
 * Discover open on a narrow chart for a reason nobody remembers choosing, which
 * is the same argument the `/downloads` filter chips already settled.
 *
 * `"0"` is Deezer's "All", i.e. exactly what a bare chart request answers, so
 * the default state is the behaviour these rows had before the chips existed.
 */
interface DiscoverGenreSlice {
    genre: string;
    setGenre: (genre: string) => void;
}

export const useDiscoverGenreStore = create<DiscoverGenreSlice>()((set) => ({
    genre: '0',
    setGenre: (genre) => set({ genre }),
}));

export const useDiscoverGenre = (): string => useDiscoverGenreStore((state) => state.genre);
export const useSetDiscoverGenre = () => useDiscoverGenreStore((state) => state.setGenre);
