/**
 * Which list row is the playing one (B-451). `song` is the session's song, `useRemoteAwarePlayerSong`:
 * the one another device plays while it is active, else the local player's. A remote song carries no
 * `_uniqueId` (the local queue's entry ids mean nothing for it), so it matches by song id; a local
 * queue row still matches by its entry, so a song queued twice marks only the playing entry.
 */

interface RowSong {
    _uniqueId?: string;
    id: string;
}

interface SessionSong {
    _uniqueId?: string;
    albumArtists?: { id: string }[];
    albumId?: string;
    artists?: { id: string }[];
    id?: string;
}

export const songRowIsPlaying = (row: RowSong, song: SessionSong | undefined): boolean => {
    if (!song?.id) return false;
    if (row._uniqueId && song._uniqueId) return row._uniqueId === song._uniqueId;
    return row.id === song.id;
};

export const albumRowIsPlaying = (albumId: string | undefined, song: SessionSong | undefined) =>
    !!albumId && song?.albumId === albumId;

export const artistRowIsPlaying = (
    artistId: string | undefined,
    song: SessionSong | undefined,
    credit: 'albumArtists' | 'artists',
) => !!artistId && !!song?.[credit]?.some((artist) => artist.id === artistId);
