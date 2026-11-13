/**
 * The body of `POST /lb/artist/discography` (a page's Rescan, or "Find missing albums"). With an
 * MBID lb-bot needs both: the MBID is what it scans, the name is what it matches the library
 * against. Without one (Worbus P1, "Scan now"), the Navidrome id, and the name when the page has
 * it (B-411): lb-bot reads the name from Navidrome's getArtists, which lists album artists only,
 * so for an artist who is only a track artist ("Appears on") it had none and searched MusicBrainz
 * for "". lb-bot prefers Navidrome's name where it has one. Null: nothing to ask with.
 */
export const indexArtistBody = (args: {
    mbid?: string;
    name: string;
    ndId: string;
}): null | Record<string, string> => {
    if (args.mbid ? !args.name : !args.ndId) return null;
    if (args.mbid) return { mbid: args.mbid, name: args.name, nd_id: args.ndId };
    const name = args.name.trim();
    return name ? { name, nd_id: args.ndId } : { nd_id: args.ndId };
};
