/**
 * The body of `POST /lb/artist/discography` (a page's Rescan, or "Find missing albums"). With an
 * MBID lb-bot needs both: the MBID is what it scans, the name is what it matches the library
 * against. Without one (Worbus P1, "Scan now"), the Navidrome id. Null: nothing to ask with.
 */
export const indexArtistBody = (args: {
    mbid?: string;
    name: string;
    ndId: string;
}): null | Record<string, string> => {
    if (args.mbid ? !args.name : !args.ndId) return null;
    return args.mbid
        ? { mbid: args.mbid, name: args.name, nd_id: args.ndId }
        : { nd_id: args.ndId };
};
