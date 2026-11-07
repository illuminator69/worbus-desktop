import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

/**
 * navi-connect: "Mixed for You" — the hub's recipe collection, mirrored.
 *
 * **The gap this closes, stated precisely: a saved queue stores a *result*; a
 * mix stores a *recipe*.** Nothing in either client persisted
 * `{mode, seedId, moodCharacter, count}` before this — the auto-DJ runners take
 * them as arguments and drop them, the Mood Flow centroid is in-memory only, and
 * a saved queue exits into a frozen track list that replays rather than
 * regenerates. So "play that mix again" could only ever mean "play those exact
 * songs again", which is the one thing a mix is not.
 *
 * **The hub stores and broadcasts the recipe.** Until I-040 it generated nothing
 * and each client regenerated with its own engine. Since PROTOCOL §18 radio is the
 * hub's station engine: with it, `similar`, `fingerprint`, `adaptive` and the new
 * `station` kind play through a station, and without it the old local paths run.
 *
 * So this store is a **pure mirror**, like `hub.store`, and deliberately *not*
 * persisted the way `saved-queues.store` is. The asymmetry is worth naming
 * because the two look alike:
 *
 *   - A saved queue is captured automatically, on every client, constantly, so
 *     it needs a local cache, an offline accumulation path, a field-level union
 *     merge and tombstones.
 *   - A mix is created by hand, on one device, rarely. It is never published
 *     concurrently by two clients, so none of that machinery is needed — and
 *     leaving the asymmetry to be discovered later is how a second copy of the
 *     merge logic gets written for a problem that does not exist.
 *
 * No hub, no mixes. That is the honest state: the recipe lives there.
 */

export interface Mix {
    /**
     * The station character (`close` / `balanced` / `explore`, PROTOCOL §17.1, §18). The hub
     * derives it from a legacy `moodCharacter` when a record carries none; empty only from a
     * hub older than stations.
     */
    character: string;
    /** How many tracks a regeneration aims for. */
    count: number;
    coverArtId: string;
    createdAt: number;
    /** `mx_<ms>_<hex>`, minted by the hub. */
    id: string;
    /**
     * The hub's value, **verbatim** — not narrowed to {@link MixKind}, because a
     * value this build does not know is a real state that must survive to the
     * UI rather than being coerced into one that does. Gate on
     * {@link isKnownMixKind} before running it.
     */
    kind: string;
    lastPlayedAt: number;
    /**
     * The tuning preset for an `adaptive` mix, in the hub's vocabulary
     * (`EchoMatch` / `SteadyVibes` / `TransitionMaestro`) rather than Worbus for desktop's
     * own (`echo` / `steady` / `transition`). The two clients already disagree
     * about these ids — that drift is the cautionary tale in the Discover
     * catalogue — so the wire form is fixed here and translated at the engine
     * boundary rather than being stored in whichever form this client happens to
     * use.
     */
    moodCharacter: string;
    name: string;
    /** Depends on `kind`: a song id for `similar`, `adaptive` and a radio `station`
     *  (empty for Your mix), an artist id for `artist`, a genre NAME for `genre`
     *  (Navidrome's genre id in a recipe from before B-151), and nothing at all for
     *  `fingerprint`, which is seeded from listening history. */
    seedId: string;
    /**
     * A custom radio's artists (P5, PROTOCOL §17.1), in pick order; `seedId` is the first, so a
     * client that predates this plays that artist's radio. Empty on every other recipe.
     */
    seedIds: string[];
    /** What to call the seed on screen. Stored rather than resolved, so a mix
     *  reads correctly without a round trip — and still reads correctly after the
     *  seed has been deleted from the library. */
    seedName: string;
    updatedAt: number;
    /** A custom radio's Artist variety (`low` / `medium` / `high`); empty: the character's own. */
    variety: string;
}

/**
 * Which engine regenerates the mix. Matches the hub's stored `kind` string
 * exactly and must stay in step with Worbus for Android's — see `navi-connect/CLAUDE.md` §6
 * for why a hand-mirrored table is the only kind of "shared" these two repos
 * have.
 */
export type MixKind = 'adaptive' | 'artist' | 'fingerprint' | 'genre' | 'similar' | 'station';

/** The kinds this build can actually regenerate. Mirrors the hub's `MIX_KINDS`. */
export const MIX_KINDS: readonly MixKind[] = [
    'adaptive',
    'artist',
    'fingerprint',
    'genre',
    'similar',
    'station',
] as const;

/**
 * Whether this build knows how to run a recipe.
 *
 * A mix whose `kind` is unrecognised is **kept and shown but refused**, never
 * approximated. The hub validates `kind` against its own list, so an unknown one
 * can only mean a client newer than this build minted it — and regenerating it
 * as something adjacent would play something plausible and wrong, which is
 * harder to notice than nothing happening. (Concretely: a `genre` mix run as
 * `similar` would feed a genre id to `getSongDetail` and come back empty, with
 * nothing saying why.)
 */
export const isKnownMixKind = (kind: string): kind is MixKind =>
    (MIX_KINDS as readonly string[]).includes(kind);

interface MixesSlice {
    actions: {
        reset: () => void;
        setMixes: (mixes: Mix[]) => void;
    };
    mixes: Mix[];
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && isFinite(value) ? value : 0);

/**
 * Coerce one hub record. A row with no id is dropped — everything the UI does
 * (rename, delete, touch, play) is keyed on it, so a row without one is a card
 * whose every control is a no-op.
 *
 * An unrecognised `kind` is **carried through unchanged**, not coerced and not
 * dropped. This client ships independently of the other one, so "a mix made on a
 * newer Worbus for Android" is a permanent condition: the row is shown, named, renameable and
 * deletable, and only *playing* it is refused — with a reason. See
 * {@link isKnownMixKind}.
 */
export const mixFromHub = (record: any): Mix | null => {
    const id = str(record?.id);
    if (!id) return null;
    return {
        character: str(record?.character),
        count: num(record?.count) || 50,
        coverArtId: str(record?.coverArtId),
        createdAt: num(record?.createdAt),
        id,
        kind: str(record?.kind),
        lastPlayedAt: num(record?.lastPlayedAt),
        moodCharacter: str(record?.moodCharacter),
        name: str(record?.name) || 'Your Mix',
        seedId: str(record?.seedId),
        seedIds: Array.isArray(record?.seedIds)
            ? [
                  ...new Set<string>(
                      record.seedIds.filter(
                          (v: unknown): v is string => typeof v === 'string' && v !== '',
                      ),
                  ),
              ]
            : [],
        seedName: str(record?.seedName),
        updatedAt: num(record?.updatedAt),
        variety: str(record?.variety),
    };
};

export const mixesFromHub = (records: unknown): Mix[] =>
    Array.isArray(records) ? records.map(mixFromHub).filter((mix): mix is Mix => mix !== null) : [];

export const useMixesStore = createWithEqualityFn<MixesSlice>()((set) => ({
    actions: {
        reset: () => set({ mixes: [] }),
        setMixes: (mixes) => set({ mixes }),
    },
    mixes: [],
}));

/**
 * The recipes, in the hub's order — deliberately not re-sorted here.
 *
 * The hub sends them newest-`updatedAt` first, and it keeps `touchMix` out of
 * that key on purpose: `updatedAt` is also its eviction key, and folding
 * "played" into the sort would make a mix you listen to outrank one you just
 * edited and reorder the list under you every time you pressed play. An earlier
 * revision of this file sorted by `lastPlayedAt || updatedAt` and did exactly
 * that — re-deriving an order the server already decided is how a client comes
 * to disagree with it.
 */
export const useMixes = (): Mix[] => useMixesStore((state) => state.mixes, shallow);

export const useMixesActions = () => useMixesStore((state) => state.actions);
