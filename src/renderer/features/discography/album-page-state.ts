/**
 * navi-connect F7 (Task 6): the not-owned album page's shell, from what it knows so far.
 */

export type AlbumPageState = 'loading' | 'older' | 'ready' | 'redirect' | 'unconfigured';

export const albumPageState = (input: {
    available: boolean;
    hasRgid: boolean;
    /** The index names a Navidrome album for this release-group: the library has it. */
    ownedAlbumId: null | string;
    releasesRead: 'data' | 'null' | 'pending';
    /** The hub does not advertise `GET /lb/album/releases`. */
    routeOlder: boolean;
}): AlbumPageState => {
    if (input.ownedAlbumId) return 'redirect';
    // The page says the link has no id; there is nothing to wait for.
    if (!input.hasRgid) return 'ready';
    if (!input.available && input.releasesRead !== 'data') return 'unconfigured';
    if (input.releasesRead === 'null' && input.routeOlder) return 'older';
    if (input.releasesRead === 'pending') return 'loading';
    return 'ready';
};

/**
 * Worbus P1: what a ready page offers. `sources` is Find sources, the request box and the
 * wishlist, as before; `wishlistOnly` (downloading off) is the wishlist and one plain line in
 * their place; `none` for every other state. `downloadsShown` is `downloadsShown(mode)` (an older
 * peer's unknown mode shows them, as before).
 */
export type AlbumPageOffer = 'none' | 'sources' | 'wishlistOnly';

export const albumPageOffer = (state: AlbumPageState, downloadsShown: boolean): AlbumPageOffer => {
    if (state !== 'ready') return 'none';
    return downloadsShown ? 'sources' : 'wishlistOnly';
};
