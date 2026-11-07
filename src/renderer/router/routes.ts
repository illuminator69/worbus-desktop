export enum AppRoute {
    ACTION_REQUIRED = '/action-required',
    /** navi-connect: albums lb-bot is fetching from Soulseek, in flight and finished. */
    DOWNLOADS = '/downloads',
    /** navi-connect: the Discover screen — Fresh, similar artists you don't
     *  own, the rediscovery set and mood search, on one shared row catalogue.
     *  The enum slot predates it and was unused; claimed deliberately, so a
     *  later upstream Explore page shows up as a merge conflict rather than
     *  two pages quietly fighting over one path. */
    EXPLORE = '/explore',
    /** navi-connect: an album the library does NOT have, keyed by MusicBrainz
     *  release-group id. Its tracklist and source picker come from lb-bot. */
    EXTERNAL_ALBUM_DETAIL = '/external/albums/:rgid',
    /** navi-connect: an artist the library does NOT have, keyed by MusicBrainz
     *  artist id — the `mb:` id form lb-bot's discography scan already understands. */
    EXTERNAL_ARTIST_DETAIL = '/external/artists/:artistMbid',
    FAKE_LIBRARY_ALBUM_DETAILS = '/library/albums/dummy/:albumId',
    FAVORITES = '/favorites',
    /** navi-connect: site-wide new and upcoming releases, from lb-bot. */
    FRESH = '/fresh',
    HOME = '/',
    /** F6: Library as one place, its Artists page. The frame's chips lead to the other list pages. */
    LIBRARY = '/library',
    LIBRARY_ALBUM_ARTISTS = '/library/album-artists',
    LIBRARY_ALBUM_ARTISTS_DETAIL = '/library/album-artists/:albumArtistId',
    LIBRARY_ALBUM_ARTISTS_DETAIL_DISCOGRAPHY = '/library/album-artists/:albumArtistId/discography',
    LIBRARY_ALBUM_ARTISTS_DETAIL_FAVORITE_SONGS = '/library/album-artists/:albumArtistId/favorite-songs',
    LIBRARY_ALBUM_ARTISTS_DETAIL_SONGS = '/library/album-artists/:albumArtistId/songs',
    LIBRARY_ALBUM_ARTISTS_DETAIL_TOP_SONGS = '/library/album-artists/:albumArtistId/top-songs',
    LIBRARY_ALBUMS = '/library/albums',
    LIBRARY_ALBUMS_DETAIL = '/library/albums/:albumId',
    LIBRARY_ARTISTS = '/library/artists',
    LIBRARY_ARTISTS_DETAIL = '/library/artists/:artistId',
    LIBRARY_ARTISTS_DETAIL_DISCOGRAPHY = '/library/artists/:artistId/discography',
    LIBRARY_ARTISTS_DETAIL_FAVORITE_SONGS = '/library/artists/:artistId/favorite-songs',
    LIBRARY_ARTISTS_DETAIL_SONGS = '/library/artists/:artistId/songs',
    LIBRARY_ARTISTS_DETAIL_TOP_SONGS = '/library/artists/:artistId/top-songs',
    LIBRARY_FOLDERS = '/library/folders',
    LIBRARY_GENRES = '/library/genres',
    LIBRARY_GENRES_DETAIL = '/library/genres/:genreId',
    /** navi-connect: Library Matches - the MusicBrainz matches lb-bot holds for
     *  the library (artist overrides, artists to check, album matches, merged
     *  names), with the artwork and the actions to correct them. */
    LIBRARY_MATCHES = '/library-matches',
    LIBRARY_SONGS = '/library/songs',
    /** navi-connect: My Listening — aggregates over the user's ListenBrainz
     *  history, mirrored by lb-bot. */
    LISTENING = '/listening',
    LOGIN = '/login',
    /** navi-connect: "Mixed for You" — the hub's stored generator recipes. Each
     *  one regenerates on play rather than replaying a frozen tracklist, which
     *  is what separates it from SAVED_QUEUES. */
    MIXES = '/mixes',
    NO_NETWORK = '/no-network',
    NOW_PLAYING = '/now-playing',
    PLAYING = '/playing',
    PLAYLISTS = '/playlists',
    PLAYLISTS_DETAIL_SONGS = '/playlists/:playlistId/songs',
    RADIO = '/radio',
    SAVED_QUEUES = '/saved-queues',
    SEARCH = '/search/:itemType',
    SERVERS = '/servers',
    SETTINGS = '/settings',
    /** navi-connect: albums nobody was sharing, kept for lb-bot's slow
     *  periodic re-search. Reached from Downloads, where the failure that puts
     *  an album here is reported. */
    WISHLIST = '/wishlist',
}
