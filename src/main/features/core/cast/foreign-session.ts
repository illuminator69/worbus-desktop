/**
 * Worbus P2 (design §6.3): someone else taking the speaker. Pure, so
 * `foreign-session.harness.ts` runs it.
 *
 * Chromecasts are per user and the last caster wins. The bridge that lost the speaker must see it:
 * a MEDIA_STATUS from a media session it did not start, or - while it knows no own media session -
 * with content that is not in its queue, or a RECEIVER_STATUS that no longer runs its app session.
 * Both users read one library, so a track id can be in both queues; the media session id is the
 * proof, and a status carrying the bridge's own id is never foreign (R25).
 */

/** A MEDIA_STATUS or RECEIVER_STATUS, as castv2 hands either over. */
export interface CastStatusLike {
    applications?: { appId?: string; sessionId?: string }[];
    media?: { contentId?: string };
    mediaSessionId?: number;
    playerState?: string;
    volume?: unknown;
}

/** What this bridge knows to be its own on the speaker. */
export interface OwnCast {
    /** The receiver app session it launched or joined; null without one. */
    appSessionId: null | string;
    /** Media sessions it released as someone else's: never adopted again. */
    foreignMediaSessions: ReadonlySet<number>;
    /** The media session its own LOAD (or a proven adoption) produced; null until one. */
    mediaSessionId: null | number;
    /** `streamIdentity` of each track in its queue. */
    queueIds: readonly string[];
}

/**
 * Identity of a track inside a stream URL, for comparing against a Chromecast's `contentId`.
 *
 * Comparing whole URLs looked equivalent and was not: the URL carries a salted auth token and
 * transcoding parameters, so rotating credentials, changing the bitrate setting or publishing
 * from a different client all produce a different string for the same song - and every ownership
 * check that depended on it silently answered "not ours". The Subsonic id is the part that
 * actually identifies the track.
 */
export function streamIdentity(url: null | string | undefined): null | string {
    if (!url) return null;
    try {
        const id = new URL(url).searchParams.get('id');
        if (id) return id;
    } catch {
        /* not a parseable URL - fall through */
    }
    return url;
}

const foreignStatus = (status: CastStatusLike, own: OwnCast): boolean => {
    if (own.mediaSessionId !== null) {
        // R25: with an own media session known, the id decides. The bridge's own session is never
        // someone else's, whatever it plays (a queue edit can drop the playing track); another
        // sender's LOAD starts a new media session.
        if (typeof status.mediaSessionId === 'number') {
            return status.mediaSessionId !== own.mediaSessionId;
        }
    } else {
        // No own media session yet (launched or joined, its LOAD not answered): the content is
        // the only proof.
        const playing = streamIdentity(status.media?.contentId);
        if (playing && !own.queueIds.includes(playing)) return true;
    }
    // RECEIVER_STATUS: the app session this bridge holds is no longer running on the speaker.
    if (Array.isArray(status.applications) && own.appSessionId !== null) {
        return !status.applications.some((app) => app.sessionId === own.appSessionId);
    }
    return false;
};

/**
 * - `release`: the speaker was taken while this bridge was playing - report it released (the
 *   session pauses) and let go of the player;
 * - `drop`: taken while not playing - nothing to report, but let go of the player, so a later
 *   play loads over it instead of resuming someone else's session;
 * - `none`: this bridge's own status, or one that says nothing. While its own LOAD is in flight
 *   a new media session id is its own.
 */
export const takeoverStep = (
    status: CastStatusLike | null | undefined,
    own: OwnCast,
    context: { loading: boolean; playing: boolean },
): 'drop' | 'none' | 'release' => {
    if (!status || context.loading) return 'none';
    if (!foreignStatus(status, own)) return 'none';
    return context.playing ? 'release' : 'drop';
};

/**
 * Whether a running session may be adopted after a bridge restart: it plays a track of this queue
 * (the old proof), and it is not a session this bridge already released as someone else's.
 */
export const adoptable = (
    status: CastStatusLike | null | undefined,
    own: Pick<OwnCast, 'foreignMediaSessions' | 'queueIds'>,
): boolean => {
    if (!status) return false;
    if (
        typeof status.mediaSessionId === 'number' &&
        own.foreignMediaSessions.has(status.mediaSessionId)
    ) {
        return false;
    }
    const playing = streamIdentity(status.media?.contentId);
    return !!playing && own.queueIds.includes(playing);
};
