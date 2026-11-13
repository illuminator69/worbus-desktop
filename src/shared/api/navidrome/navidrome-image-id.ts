/**
 * B-428: an album's or a song's cover id on Navidrome, versioned by Navidrome's own `imageHash`
 * (the cover's ETag, on `/api/album` and `/api/song`), in the shape the artist and playlist covers
 * already use (`<id>&_=<version>`; Navidrome ignores the extra parameter). The cover's memory-cache
 * key then changes when the cover does, so a page refetched after a cover changed outside the app
 * shows the new one, as the phone does with Navidrome's versioned `coverArt` id. No hash (an older
 * Navidrome, an album with no art): the bare id, as before.
 */
export const navidromeVersionedImageId = (id: string, imageHash: string | undefined): string =>
    imageHash ? `${id}&_=${imageHash}` : id;
