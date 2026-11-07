import type { LibraryTabId } from '/@/renderer/features/library/library-tabs';

import { AppRoute } from '/@/renderer/router/routes';

/** Each chip's page. Discover and Favorites (under More) are outside the frame. */
export const LIBRARY_TAB_ROUTES: Record<LibraryTabId, string> = {
    albumArtists: AppRoute.LIBRARY_ALBUM_ARTISTS,
    albums: AppRoute.LIBRARY_ALBUMS,
    allArtists: AppRoute.LIBRARY_ARTISTS,
    artists: AppRoute.LIBRARY,
    discover: AppRoute.EXPLORE,
    favorites: AppRoute.FAVORITES,
    folders: AppRoute.LIBRARY_FOLDERS,
    genres: AppRoute.LIBRARY_GENRES,
    mixes: AppRoute.MIXES,
    playlists: AppRoute.PLAYLISTS,
    radio: AppRoute.RADIO,
    tracks: AppRoute.LIBRARY_SONGS,
};

/** The list pages the Library frame wraps (app-router.tsx): the sidebar's Library row is selected on each. */
export const LIBRARY_FRAME_ROUTES: readonly string[] = [
    AppRoute.LIBRARY,
    AppRoute.LIBRARY_ALBUMS,
    AppRoute.LIBRARY_SONGS,
    AppRoute.LIBRARY_GENRES,
    AppRoute.LIBRARY_FOLDERS,
    AppRoute.PLAYLISTS,
    AppRoute.RADIO,
    AppRoute.MIXES,
    AppRoute.LIBRARY_ALBUM_ARTISTS,
    AppRoute.LIBRARY_ARTISTS,
];
