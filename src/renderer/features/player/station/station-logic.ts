import type {
    StationAnswer,
    StationCatalog,
    StationCharacter,
    StationCharacterId,
    StationEngine,
    StationNextBody,
    StationOrigin,
    StationResult,
    StationSeed,
    StationStartBody,
} from '/@/shared/types/station-types';

// navi-connect stations (I-040, PROTOCOL §18): the decisions, with no React, store, IPC or clock,
// so they can be replayed in station-logic.harness.ts. The hook (use-station-autoplay.ts) and the
// store (station-store.ts) only feed them and carry out what they answer.
//
// What the hub owns and what this client owns. The hub keeps each station: its seed, its
// character, what it served, what was skipped and liked, and `seq`, the count of tracks it has
// served, which is also the cursor every device continues from. This client keeps which station
// the queue it is listening to belongs to (`StationBinding`), asks for the next few tracks when
// the queue is about to run out, and puts the answer into the queue. A queue that was not built
// by a station (an album, a playlist, a Journey) continues as one when it runs out: the last
// tracks played become the seed.

/**
 * Whether a station answer switches autoplay over to Auto DJ for the latch's minute (B-268).
 */
export const latchesAutoDj = <T>(result: StationResult<T>): boolean =>
    !result.ok && (result.status === 503 || result.fallback === true);

/** Top up when fewer than this many tracks remain after the current one, in play order. */
export const LOOKAHEAD_MIN = 2;
/** How many tracks a top-up asks for. Short on purpose: skips steer the next batch. */
export const NEXT_COUNT = 5;
/** A radio's first batch, after its seed track(s). */
export const START_COUNT = 20;
/** The hub's limit on `exclude`. */
export const EXCLUDE_MAX = 1000;
/** The hub's limit on a `tracks` seed. */
export const SEED_TRACKS_MAX = 5;
/** The hub's seed cap since P5 (PROTOCOL §18.1), shared among a custom radio's artists. */
export const STATION_SEEDS_MAX = 12;
/** How many of the last tracks played seed the station a queue continues as. */
export const CONTINUE_SEED_MAX = 3;
/** How long a local change of binding outranks a `session` frame that disagrees with it. */
export const LOCAL_BINDING_HOLD_MS = 5000;
/** How long an armed binding waits for the queue it belongs to. */
export const ARM_TTL_MS = 30_000;
/**
 * After another device served this station (a `station` frame, or `servedElsewhere`), its batch
 * is still on its way into the session queue. Asking with the new `seq` meanwhile would compute
 * a second batch, so this client waits this long before asking again.
 */
export const SERVED_ELSEWHERE_GRACE_MS = 8000;
/** Retries of one trigger after a partial or failed answer, before waiting for the next. */
export const RETRY_MAX = 3;
export const RETRY_DELAY_MS = 8000;

export const CHARACTER_IDS: readonly StationCharacterId[] = ['close', 'balanced', 'explore'];

/**
 * The hub's catalogue as PROTOCOL §18.1 states it, for when it cannot be asked. The probe's own
 * answer always wins: both clients render the hub's words, so the two cannot drift again.
 */
export const BUNDLED_CHARACTERS: readonly StationCharacter[] = [
    {
        description: 'Stays right next to what you started with.',
        id: 'close',
        label: 'Familiar',
        legacy: 'EchoMatch',
    },
    {
        description: 'Near what you started with, with room to move.',
        id: 'balanced',
        label: 'Blend',
        legacy: 'SteadyVibes',
    },
    {
        description: 'Wanders further, steered by what you skip and like.',
        id: 'explore',
        label: 'Discover',
        legacy: 'TransitionMaestro',
    },
];

export const toCharacterId = (value: unknown): null | StationCharacterId =>
    CHARACTER_IDS.includes(value as StationCharacterId) ? (value as StationCharacterId) : null;

/**
 * A character from anything that may have stored one: a new id, the hub's legacy MoodCharacter
 * name, or Worbus for desktop's own old preset id. Anything else is Balanced, the hub's default.
 */
export const characterFromAny = (value: unknown): StationCharacterId => {
    const id = toCharacterId(value);
    if (id) return id;
    switch (value) {
        case 'echo':
        case 'EchoMatch':
            return 'close';
        case 'transition':
        case 'TransitionMaestro':
            return 'explore';
        default:
            return 'balanced';
    }
};

/** The legacy MoodCharacter name a mix record keeps beside `character` (PROTOCOL §17.1). */
export const legacyMoodCharacter = (character: StationCharacterId): string => {
    switch (character) {
        case 'close':
            return 'EchoMatch';
        case 'explore':
            return 'TransitionMaestro';
        default:
            return 'SteadyVibes';
    }
};

/** The words before P5, which an older hub (or a catalogue stored before it) may still send. */
const OLD_LABELS = new Set(['Balanced', 'Close', 'Explore']);

/**
 * The characters to render: the hub's, or the bundled copy when it has given none. The words
 * before P5 (Close, Balanced, Explore) read as today's (Familiar, Blend, Discover); a hub's own
 * other words win. Worbus for Android's `StationCatalogue.infoFor` is the twin.
 */
export const charactersOf = (catalog: null | StationCatalog): readonly StationCharacter[] =>
    catalog && catalog.characters.length > 0
        ? catalog.characters.map((row) =>
              OLD_LABELS.has(row.label)
                  ? {
                        ...row,
                        label: BUNDLED_CHARACTERS.find((b) => b.id === row.id)?.label ?? row.label,
                    }
                  : row,
          )
        : BUNDLED_CHARACTERS;

export const characterLabel = (
    catalog: null | StationCatalog,
    character: StationCharacterId,
): string =>
    charactersOf(catalog).find((row) => row.id === character)?.label ??
    BUNDLED_CHARACTERS.find((row) => row.id === character)!.label;

/** Whether `start` takes this Artist variety here: the probe lists it (P5). */
export const takesVariety = (catalog: null | StationCatalog, variety: string): boolean =>
    Boolean(variety) && (catalog?.varieties ?? []).includes(variety as never);

// --- Which path runs ---------------------------------------------------------------------------

/**
 * `stations`: the hub's engine. `fallback`: upstream's Auto DJ (no hub, no `station` feature, a
 * probe that answered unavailable, or a `start` that answered 503). `pending`: the hub has the
 * feature and this connection's probe has not answered yet, so neither runs for that moment.
 */
export type StationMode = 'fallback' | 'pending' | 'stations';

export const stationMode = (args: {
    /** This connection's probe answered `available: true`. */
    available: boolean;
    connected: boolean;
    fallbackLatched: boolean;
    hasFeature: boolean;
    probed: boolean;
}): StationMode => {
    if (!args.connected || !args.hasFeature) return 'fallback';
    if (args.fallbackLatched) return 'fallback';
    if (!args.probed) return 'pending';
    return args.available ? 'stations' : 'fallback';
};

// --- Play order ---------------------------------------------------------------------------------

/**
 * Tracks left after the current one in PLAY order, for this client's own player. Worbus for desktop's
 * `player.index` is a position in the shuffled order while shuffle is on, so this is the same
 * arithmetic either way.
 */
export const remainingLocal = (playIndex: number, length: number): number =>
    Math.max(0, length - playIndex - 1);

/**
 * The same for the hub's session, whose `index` is a queue index and whose `order` (when shuffle
 * is on) lists queue indexes in play order. An `order` that does not cover the queue is ignored:
 * the hub rebuilds it on the next frame, and counting by queue order meanwhile errs late, not
 * twice.
 */
export const remainingRemote = (
    index: number,
    length: number,
    order: null | readonly number[] | undefined,
): number => {
    if (order && order.length === length) {
        const position = order.indexOf(index);
        if (position >= 0) return Math.max(0, order.length - position - 1);
    }
    return Math.max(0, length - index - 1);
};

/** Queue ids in play order, for a session described by queue index + optional `order`. */
export const idsInPlayOrder = (
    ids: readonly string[],
    order: null | readonly number[] | undefined,
): string[] => (order && order.length === ids.length ? order.map((index) => ids[index]) : [...ids]);

/**
 * The seed a queue that ran out continues from: the current track and up to two before it in
 * play order (they are the tracks just played), oldest first, without repeats.
 */
export const continueSeedIds = (
    playOrderIds: readonly string[],
    playPosition: number,
): string[] => {
    const from = Math.max(0, playPosition - (CONTINUE_SEED_MAX - 1));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of playOrderIds.slice(from, playPosition + 1)) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
};

/** At most `max` items spread evenly over a list, first and last included. */
export const spreadPick = <T>(items: readonly T[], max: number = SEED_TRACKS_MAX): T[] => {
    if (items.length <= max) return [...items];
    if (max <= 1) return items.slice(0, 1);
    const step = (items.length - 1) / (max - 1);
    return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
};

/** The fields an artist radio's seed is chosen by. */
export interface ArtistSeedCandidate {
    albumId?: null | string;
    /** The song's track artists, primary first. Empty when the server says none. */
    artists?: readonly { id: string }[];
    id: string;
    playCount?: null | number;
}

/**
 * The artist's own songs among `songs` (an artist filter that also matched them as album artist
 * or as a guest): those whose primary track artist is `artistId`, which is what Worbus for Android's library
 * holds a song under. A song that names no track artist is kept.
 */
export const ownArtistSongs = <T extends ArtistSeedCandidate>(
    songs: readonly T[],
    artistId: string,
): T[] => songs.filter((song) => !song.artists?.length || song.artists[0].id === artistId);

/**
 * An artist radio's seed, Worbus for Android's `artistSeedSongs` (B-149): up to `max` of the artist's songs,
 * the most played first, one per album before a second from any album. Equal play counts keep
 * the order given. A song with no album counts as an album of its own.
 */
export const artistSeedSongs = <T extends ArtistSeedCandidate>(
    songs: readonly T[],
    max: number = SEED_TRACKS_MAX,
): T[] => {
    if (max <= 0) return [];
    // Array.prototype.sort is stable, as Kotlin's sortedByDescending is.
    const ranked = [...songs].sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0));
    const albums = new Set<string>();
    const firstPerAlbum = ranked.filter((song) => {
        const album = song.albumId || song.id;
        if (albums.has(album)) return false;
        albums.add(album);
        return true;
    });
    const ids = new Set<string>();
    const out: T[] = [];
    for (const song of [...firstPerAlbum, ...ranked]) {
        if (out.length >= max) break;
        if (ids.has(song.id)) continue;
        ids.add(song.id);
        out.push(song);
    }
    return out;
};

/**
 * What an artist radio plays without a station (Worbus for Android's `artistSimilarQueue`, B-149): the seed
 * songs, then Navidrome's similar songs for the artist (`getSimilarSongs2`) in the order it gave
 * them, without repeats, cut at `cap` when one is given (a mix's length). Never a shuffle.
 */
export const artistFallbackQueue = <T extends { id: string }>(
    seeds: readonly T[],
    similar: readonly T[],
    cap?: number,
): T[] => {
    const ids = new Set<string>();
    const out: T[] = [];
    for (const song of [...seeds, ...similar]) {
        if (cap !== undefined && out.length >= cap) break;
        if (ids.has(song.id)) continue;
        ids.add(song.id);
        out.push(song);
    }
    return out;
};

/**
 * Seed songs per artist for a custom radio (P5): twelve shared out, one to five each. Worbus for Android's
 * `seedsPerArtist` is the twin.
 */
export const seedsPerArtist = (artists: number): number =>
    artists <= 0 ? 0 : Math.max(1, Math.min(5, Math.floor(STATION_SEEDS_MAX / artists)));

/** One seed from each artist's list in turn, then the second of each; a song in two lists once. */
export const interleaveSeeds = <T extends { id: string }>(
    perArtist: readonly (readonly T[])[],
): T[] => {
    const out: T[] = [];
    const seen = new Set<string>();
    const longest = Math.max(0, ...perArtist.map((list) => list.length));
    for (let i = 0; i < longest; i += 1) {
        for (const list of perArtist) {
            const song = list[i];
            if (song && !seen.has(song.id)) {
                seen.add(song.id);
                out.push(song);
            }
        }
    }
    return out;
};

/**
 * A custom radio's seeds: each held artist's `artistSeedSongs`, `seedsPerArtist` of them, dealt
 * in turn, twelve at most. An artist with no songs here is skipped; one artist is exactly the
 * artist radio's five.
 */
export const customRadioSeeds = <T extends ArtistSeedCandidate>(
    perArtist: readonly (readonly T[])[],
): T[] => {
    const held = perArtist.filter((songs) => songs.length > 0);
    if (held.length <= 1) return artistSeedSongs(held[0] ?? []);
    const each = seedsPerArtist(held.length);
    return interleaveSeeds(held.map((songs) => artistSeedSongs(songs, each))).slice(
        0,
        STATION_SEEDS_MAX,
    );
};

/** What is queued, for `exclude`: the newest EXCLUDE_MAX distinct ids. */
export const excludeIds = (ids: readonly string[]): string[] => {
    const distinct = [...new Set(ids.filter(Boolean))];
    return distinct.length > EXCLUDE_MAX ? distinct.slice(-EXCLUDE_MAX) : distinct;
};

// --- The binding: which station the listened queue belongs to -----------------------------------

export interface StationBinding {
    character: StationCharacterId;
    engine: null | StationEngine;
    exhausted: boolean;
    /** The hub's name for it ("Cinnamon Girl radio", "Your mix"); empty when not yet told. */
    name: string;
    /** As the hub echoed it (informational since I-041: Off stops radios too). */
    origin?: null | StationOrigin;
    rev: number;
    /** Kept so an expired station (404 station_unknown) can be started again once. */
    seed: null | StationSeed;
    /** The `seq` this client last applied or learned: the `after` of its next `next`. */
    seq: number;
    stationId: string;
    /**
     * Someone picked Off (I-041): the hub serves this station nothing more, for every device,
     * until a character is picked again. Also set here at once when this client picks Off.
     */
    stopped?: boolean;
    /**
     * Asked to bind the session and the hub answered `bound: false`: this queue continues the
     * station from this device without the session naming it. No setQueue names it, no bind is
     * tried again, and a session that names no station does not end it.
     */
    unbound?: boolean;
}

/** A `station` frame or `welcome.station`, read defensively. Null when it names no station. */
export interface StationCursor {
    character: null | StationCharacterId;
    exhausted: boolean;
    name?: string;
    origin?: StationOrigin;
    rev: number;
    seed?: null | StationSeed;
    seq: number;
    stationId: string;
    /** Only when the frame says (a hub with `stop`). */
    stopped?: boolean;
}

const asSeed = (value: unknown): null | StationSeed => {
    if (!value || typeof value !== 'object') return null;
    const seed = value as { ids?: unknown; kind?: unknown; name?: unknown };
    const name = typeof seed.name === 'string' && seed.name ? seed.name : undefined;
    if (seed.kind === 'yourMix') return { kind: 'yourMix', name };
    const ids = Array.isArray(seed.ids)
        ? seed.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
    if (ids.length === 0) return null;
    if (seed.kind === 'track') return { ids: ids.slice(0, 1), kind: 'track', name };
    if (seed.kind === 'tracks') return { ids: ids.slice(0, SEED_TRACKS_MAX), kind: 'tracks', name };
    return null;
};

export const parseStationCursor = (value: unknown): null | StationCursor => {
    if (!value || typeof value !== 'object') return null;
    const frame = value as Record<string, unknown>;
    if (typeof frame.stationId !== 'string' || !frame.stationId) return null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
        character: toCharacterId(frame.character),
        exhausted: frame.exhausted === true,
        ...(typeof frame.name === 'string' && frame.name ? { name: frame.name } : {}),
        ...(frame.origin === 'radio' || frame.origin === 'continue'
            ? { origin: frame.origin }
            : {}),
        ...('seed' in frame ? { seed: asSeed(frame.seed) } : {}),
        rev: num(frame.rev),
        seq: num(frame.seq),
        stationId: frame.stationId,
        ...(typeof frame.stopped === 'boolean' ? { stopped: frame.stopped } : {}),
    };
};

/** A binding from a cursor, keeping what the cursor does not carry from `known`. */
export const bindingFromCursor = (
    cursor: StationCursor,
    known: null | StationBinding,
): StationBinding => {
    const same = known && known.stationId === cursor.stationId ? known : null;
    return {
        character: cursor.character ?? same?.character ?? 'balanced',
        engine: same?.engine ?? null,
        exhausted: cursor.exhausted,
        name: cursor.name || same?.name || '',
        origin: cursor.origin ?? same?.origin ?? null,
        rev: cursor.rev,
        seed: cursor.seed !== undefined ? cursor.seed : (same?.seed ?? null),
        // A cursor never moves a binding backwards: a frame that left before this client's own
        // last batch was applied carries a smaller seq.
        seq: Math.max(cursor.seq, same?.seq ?? 0),
        stationId: cursor.stationId,
        // A hub that does not say leaves what this client knows (its own Off) standing.
        stopped: cursor.stopped ?? same?.stopped ?? false,
        unbound: same?.unbound ?? false,
    };
};

/** A binding from a `start` answer. */
export const bindingFromAnswer = (
    answer: StationAnswer,
    extra: { unbound?: boolean } = {},
): StationBinding => ({
    character: answer.character,
    engine: answer.engine,
    exhausted: answer.exhausted,
    name: answer.name,
    origin: answer.origin,
    rev: answer.rev,
    seed: answer.seed,
    seq: answer.seq,
    stationId: answer.stationId,
    stopped: answer.stopped === true,
    unbound: extra.unbound ?? false,
});

/** A `next` answer applied to the binding it was asked for. Other stations are left alone. */
export const applyNextAnswer = (
    bound: null | StationBinding,
    answer: StationAnswer,
): null | StationBinding => {
    if (!bound || bound.stationId !== answer.stationId) return bound;
    return {
        ...bound,
        character: answer.character,
        engine: answer.engine ?? bound.engine,
        exhausted: answer.servedElsewhere ? bound.exhausted : answer.exhausted,
        origin: answer.origin ?? bound.origin ?? null,
        rev: Math.max(bound.rev, answer.rev),
        seq: Math.max(bound.seq, answer.seq),
        stopped: answer.stopped ?? bound.stopped ?? false,
    };
};

/** A `station` frame applied: only the bound station's cursor moves. */
export const applyStationFrame = (
    bound: null | StationBinding,
    cursor: StationCursor,
): null | StationBinding =>
    bound && bound.stationId === cursor.stationId ? bindingFromCursor(cursor, bound) : bound;

/**
 * `session.stationId` (or `welcome`'s) arriving. The hub's session is the authority on which
 * station the live queue belongs to, with one exception: right after this client changed the
 * binding itself (it started a radio, or began a queue that is not one), the frames still in
 * flight describe the queue before that change, so for LOCAL_BINDING_HOLD_MS a disagreeing frame
 * is ignored. A frame that agrees ends the hold early. `undefined` is a hub that does not speak
 * stations: nothing changes.
 */
export const applySessionStationId = (args: {
    bound: null | StationBinding;
    /** Cursors this client has heard for stations, by id: a newly bound one starts from them. */
    cursors: Readonly<Record<string, StationCursor>>;
    incoming: unknown;
    localUntil: number;
    now: number;
}): { bound: null | StationBinding; localUntil: number } => {
    const { bound, cursors, incoming, localUntil, now } = args;
    if (incoming === undefined) return { bound, localUntil };
    const id = typeof incoming === 'string' && incoming ? incoming : null;
    if ((bound?.stationId ?? null) === id) {
        // The session names this station: whatever the hub said at `start`, it is bound now.
        return { bound: bound?.unbound ? { ...bound, unbound: false } : bound, localUntil: 0 };
    }
    if (now < localUntil) return { bound, localUntil };
    // A station the hub declined to bind is this queue's without the session naming it.
    if (id === null && bound?.unbound) return { bound, localUntil };
    if (id === null) return { bound: null, localUntil: 0 };
    const cursor = cursors[id];
    return {
        bound: cursor
            ? bindingFromCursor(cursor, null)
            : {
                  character: 'balanced',
                  engine: null,
                  exhausted: false,
                  name: '',
                  origin: null,
                  rev: 0,
                  seed: null,
                  seq: 0,
                  stationId: id,
              },
        localUntil: 0,
    };
};

/**
 * A `session` frame bound this client's queue to a station it did not ask for while it asked
 * nothing: another device started it, and that device is appending its first batch. It is waited
 * for like a batch served elsewhere (SERVED_ELSEWHERE_GRACE_MS); asking `next` at once added a
 * second batch to the same top-up (walk W7, Worbus for Android continuing an album, Worbus for desktop controlling).
 */
export const boundByAnotherDevice = (
    before: null | StationBinding,
    after: null | StationBinding,
    inFlight: boolean,
): boolean => after !== null && after.stationId !== before?.stationId && !inFlight;

// --- The autoplay decision ---------------------------------------------------------------------

export type AutoplayDecision =
    | { body: StationNextBody; kind: 'next' }
    | { body: StationStartBody; kind: 'start' }
    | { kind: 'wait'; reason: AutoplayWait };

export interface AutoplayInput {
    /** The station the listened queue belongs to, if any. */
    bound: null | StationBinding;
    deviceId?: string;
    /** Whether this client drives the queue it is looking at: it plays it, or it controls another
     *  device that does. */
    driving: boolean;
    /** Another device served the bound station less than SERVED_ELSEWHERE_GRACE_MS ago. */
    elsewhereRecent?: boolean;
    enabled: boolean;
    /**
     * A chip tap asks now, playing or paused (B-144): the user just chose, so a queue near its
     * end gets its batch at once rather than when playback resumes.
     */
    ignorePaused?: boolean;
    /** A request of this client's is already out. */
    inFlight: boolean;
    isPlaying: boolean;
    mode: StationMode;
    /** Queue ids, any order: what `exclude` carries. */
    queueIds: readonly string[];
    remaining: number;
    /** The hub session's saved-queue id, which `bindSession` names. */
    savedQueueId: null | string;
    /** The last tracks played, for a queue that is not a station's (continueSeedIds). */
    seedIds: readonly string[];
    /** The playing track's title: what a continuation is named after ("<title> radio"). Without
     *  it the hub names the station after its oldest seed track, which may not be the one playing
     *  (B-139). */
    seedName?: string;
    /**
     * The hub session holds the queue this client is looking at (its `setQueue` has landed).
     * Until it does, `savedQueueId` still names the queue before it: a `start` then asked to bind
     * THAT queue, was answered 409 with its station, and continued the old radio into the new
     * queue under the old radio's name (walk W7: a one-track album after a radio). Absent = true.
     */
    sessionHoldsQueue?: boolean;
}

export type AutoplayWait =
    | 'enough'
    | 'exhausted'
    | 'in-flight'
    | 'no-seed'
    | 'not-driving'
    | 'not-playing'
    | 'off'
    | 'publishing'
    | 'served-elsewhere'
    | 'stopped'
    | 'unavailable';

export const decideAutoplay = (
    input: AutoplayInput,
    character: StationCharacterId,
): AutoplayDecision => {
    // I-041: a station's queue goes on until someone picks Off, which stops the station for
    // every device; a queue no station built is continued only while this device's Autoplay is
    // on. Radios are no exception: Off stops them too.
    if (input.bound?.stopped) return { kind: 'wait', reason: 'stopped' };
    if (!input.bound && !input.enabled) return { kind: 'wait', reason: 'off' };
    if (input.mode !== 'stations') return { kind: 'wait', reason: 'unavailable' };
    if (!input.driving) return { kind: 'wait', reason: 'not-driving' };
    if (!input.isPlaying && !input.ignorePaused) return { kind: 'wait', reason: 'not-playing' };
    if (input.remaining >= LOOKAHEAD_MIN) return { kind: 'wait', reason: 'enough' };
    if (input.inFlight) return { kind: 'wait', reason: 'in-flight' };
    const exclude = excludeIds(input.queueIds);
    const deviceId = input.deviceId ? { deviceId: input.deviceId } : {};
    if (input.bound) {
        // An answer, not a failure: the station has nothing left that fits. Autoplay stops here
        // until a like or a character change moves its rev and the hub clears it.
        if (input.bound.exhausted) return { kind: 'wait', reason: 'exhausted' };
        if (input.elsewhereRecent) return { kind: 'wait', reason: 'served-elsewhere' };
        return {
            body: {
                after: input.bound.seq,
                count: NEXT_COUNT,
                exclude,
                stationId: input.bound.stationId,
                ...deviceId,
            },
            kind: 'next',
        };
    }
    if (input.seedIds.length === 0) return { kind: 'wait', reason: 'no-seed' };
    // The session frame that names this queue brings the next look (use-station-autoplay).
    if (input.sessionHoldsQueue === false) return { kind: 'wait', reason: 'publishing' };
    return {
        body: {
            ...(input.savedQueueId ? { bindSession: input.savedQueueId } : {}),
            character,
            count: NEXT_COUNT,
            exclude,
            origin: 'continue',
            seed: {
                ids: input.seedIds.slice(-CONTINUE_SEED_MAX),
                kind: 'tracks',
                ...(input.seedName ? { name: input.seedName } : {}),
            },
            ...deviceId,
        },
        kind: 'start',
    };
};

// --- What an answer means ---------------------------------------------------------------------

export type AnswerOutcome =
    /** Put these tracks at the end of the queue; the binding becomes `binding`. */
    | { binding: StationBinding; kind: 'adopt'; recheck: boolean; servedElsewhere: boolean }
    /** Nothing to add, by design: exhausted, or another device served this batch. */
    | { binding: StationBinding; kind: 'append'; partial: boolean; tracks: StationAnswer['tracks'] }
    /** `start` found the session already bound (409): continue that station with `next`. */
    | { kind: 'continue'; stationId: string }
    /** The hub has no usable tier (503): run the fallback. */
    | { kind: 'fallback' }
    /** The station expired or the hub lost it (404 station_unknown): start it again from its seed. */
    | { kind: 'restart' }
    /**
     * Anything else: nothing changed. `transient` (no answer, a timeout, a 5xx, a 429) is tried
     * again shortly; a refusal of the request itself (400 bad_seed, 404 seed_unknown) waits for
     * the next trigger, which brings other seed tracks.
     */
    | { kind: 'retry'; status: number; transient: boolean };

/**
 * A batch after its ids were resolved to songs: an id this server could not resolve is dropped
 * (never a placeholder with no duration), in the order served.
 */
export const keepResolved = <T>(resolved: readonly (null | T | undefined)[]): T[] =>
    resolved.filter((song): song is T => song !== null && song !== undefined);

/**
 * What an `append` becomes once resolved: a batch none of whose tracks resolved is a partial
 * answer (the cursor moved on; ask again shortly), never an append of nothing.
 */
export const afterResolving = (
    outcome: Extract<AnswerOutcome, { kind: 'append' }>,
    resolvedCount: number,
): AnswerOutcome =>
    resolvedCount > 0
        ? outcome
        : {
              binding: outcome.binding,
              kind: 'adopt',
              recheck: !outcome.binding.exhausted,
              servedElsewhere: false,
          };

export const outcomeOf = (
    result: StationResult<StationAnswer>,
    previous: null | StationBinding,
    asked: 'next' | 'start',
    /** For a `start`: whether it asked to bind the session. */
    context: { askedBind?: boolean } = {},
): AnswerOutcome => {
    if (!result.ok || !result.data) {
        if (result.status === 503 || result.fallback) return { kind: 'fallback' };
        if (asked === 'start' && result.status === 409 && result.stationId) {
            return { kind: 'continue', stationId: result.stationId };
        }
        if (asked === 'next' && result.status === 404 && result.code === 'station_unknown') {
            return { kind: 'restart' };
        }
        const status = result.status;
        return {
            kind: 'retry',
            status,
            transient: status === 0 || status === 408 || status === 429 || status >= 500,
        };
    }
    const answer = result.data;
    const binding =
        asked === 'start' || !previous || previous.stationId !== answer.stationId
            ? {
                  ...bindingFromAnswer(answer, {
                      // Asked to bind, not refused with 409, and the hub says it did not: this
                      // queue continues the station unbound, and no bind is tried again.
                      unbound:
                          asked === 'start'
                              ? context.askedBind === true && answer.bound === false
                              : previous?.unbound,
                  }),
                  // A `next` answer names no seed or name; keep what the binding had.
                  name: answer.name || previous?.name || '',
                  origin: answer.origin ?? previous?.origin ?? null,
                  seed: answer.seed ?? previous?.seed ?? null,
              }
            : applyNextAnswer(previous, answer)!;
    // Off was picked (here or elsewhere): nothing more, and nothing to retry.
    if (answer.stopped) return { binding, kind: 'adopt', recheck: false, servedElsewhere: false };
    if (answer.servedElsewhere) {
        return { binding, kind: 'adopt', recheck: true, servedElsewhere: true };
    }
    if (answer.tracks.length > 0) {
        return { binding, kind: 'append', partial: answer.partial, tracks: answer.tracks };
    }
    // No tracks and not exhausted is a partial answer (a source failed or the budget ran out):
    // try again shortly rather than waiting for a trigger that may not come at the queue's end.
    return { binding, kind: 'adopt', recheck: !answer.exhausted, servedElsewhere: false };
};
