import type {
    StationBinding,
    StationMode,
} from '/@/renderer/features/player/station/station-logic';
import type { StationCharacterId } from '/@/shared/types/station-types';

// navi-connect (I-041): the queue's chip row (Off, Close, Balanced, Explore; or Off, Auto DJ
// without the hub's station engine), as pure decisions so they can be replayed in
// station-chips.harness.ts. The same spec is implemented in Worbus for Android.
//
// A chip is a choice about the queue that is playing, and it takes effect now: Off takes out
// what the station queued that has not played, a character replaces it with a batch in that
// character. On a hub with `stationEdits`, for the session's bound station, the HUB makes that
// edit (B-143) and the client only signals. Otherwise the client edits: never the playing
// track, and the next one only when under 20 s of the playing one is left (B-145); and never a
// reload: a local queue in place, a remote session through `remove` acts and one `enqueue`,
// never a `setQueue` (the playing device would reload it, a gap in the music).

export type ChipId = 'autoDj' | 'off' | StationCharacterId;

export const STATION_CHIPS: readonly ChipId[] = ['off', 'close', 'balanced', 'explore'];
export const FALLBACK_CHIPS: readonly ChipId[] = ['off', 'autoDj'];

/** Which chips there are: the four with the station engine, Off and Auto DJ without it. */
export const chipsFor = (mode: StationMode): readonly ChipId[] =>
    mode === 'fallback' ? FALLBACK_CHIPS : STATION_CHIPS;

/**
 * The side queue's Autoplay toggle (F4) is a tap on one chip, so the tap plan, the hub edit and
 * the signals have one code path: off is Off; on is the preferred character with the station
 * engine and Auto DJ without it.
 */
export const autoplayToggleChip = (
    turnOn: boolean,
    stationsAvailable: boolean,
    preferred: StationCharacterId,
): ChipId => (!turnOn ? 'off' : stationsAvailable ? preferred : 'autoDj');

/** The character chips only (no Off, no Auto DJ): empty without the station engine. */
export const characterChips = (chips: readonly ChipId[]): StationCharacterId[] =>
    chips.filter((chip): chip is StationCharacterId => chip !== 'off' && chip !== 'autoDj');

/** The toggle shows on iff the selected chip is not Off. */
export const autoplayIsOn = (selected: ChipId): boolean => selected !== 'off';

export interface ChipState {
    /** This device's preference: `autoDJ.enabled`. */
    autoplay: boolean;
    bound: null | StationBinding;
    /**
     * The hub edits this station's queue itself (B-143): it has `stationEdits` and the queue is
     * the session's bound station, whichever device plays it. A tap then only signals.
     */
    hubEdits?: boolean;
    mode: StationMode;
    /** This device's preferred character, what a new station starts with. */
    preferred: StationCharacterId;
}

/**
 * The selected chip. A queue that belongs to a station shows that station's state, which every
 * device shares: Off when it was stopped, else its character. Any other queue shows this
 * device's preference.
 */
export const selectedChip = (state: ChipState): ChipId => {
    if (state.mode === 'fallback') return state.autoplay ? 'autoDj' : 'off';
    if (state.bound) return state.bound.stopped ? 'off' : state.bound.character;
    return state.autoplay ? state.preferred : 'off';
};

/** One queue row, in play order. `key` is how the edit finds it again. */
export interface QueueEntry {
    id: string;
    /** Local: the row's `_uniqueId`. Remote: its queue index, as a string. */
    key: string;
    /** The row's index in queue order (the hub's `remove` takes it). */
    queueIndex: number;
    /** The station put it there (not the user, not the seed). */
    stationAdded: boolean;
}

/**
 * Under this much left of the playing track, the next one is already being prepared, so a
 * chip's edit leaves it alone too. Otherwise the cut is right after the playing track (B-145):
 * keeping the next song on every change was the "second song persists" report. The hub cuts
 * the same way when it edits the queue itself.
 */
export const KEEP_NEXT_UNDER_MS = 20_000;

/** Whether the next track stays: under 20 s left of the playing one, or no way to tell. */
export const keepsNext = (playingLeftMs: null | number): boolean =>
    playingLeftMs === null || !Number.isFinite(playingLeftMs) || playingLeftMs < KEEP_NEXT_UNDER_MS;

/**
 * The station's rows that a chip may take out: station-added, in play order after the playing
 * track, or after the next one when `keepNext`. The playing track is never touched.
 */
export const removableStationRows = (
    playOrder: readonly QueueEntry[],
    position: number,
    keepNext: boolean,
): QueueEntry[] =>
    playOrder.slice(Math.max(0, position + (keepNext ? 2 : 1))).filter((row) => row.stationAdded);

export interface ChipTapPlan {
    /** Ask the hub to edit the session queue itself (`signal` with `apply: true`); the client
     *  edits nothing and asks for nothing for this tap. */
    apply?: boolean;
    /** The preference to store. */
    autoplay: boolean;
    character?: StationCharacterId;
    /** Fallback only: Auto DJ was switched on and should look at the queue at once. */
    kickAutoDj?: boolean;
    /** What the bound station becomes on screen at once (the chip moves on the tap). */
    optimistic?: Partial<StationBinding>;
    /** Swap `rows` for a batch of this many from the station, in its new character. */
    replaceCount?: number;
    /** Station rows to take out now (Off), or to swap for a new batch (a character). */
    rows: QueueEntry[];
    signal?: { kind: 'character'; value: StationCharacterId } | { kind: 'stop' };
    /** Run the top-up decision now, so a queue near its end gets its batch without waiting. */
    topUp: boolean;
}

/** How many tracks a character change asks for to replace what the station had queued. */
export const REPLACE_COUNT = 5;

export const planChipTap = (
    chip: ChipId,
    state: ChipState,
    queue: { keepNext: boolean; playOrder: readonly QueueEntry[]; position: number },
): ChipTapPlan => {
    if (state.mode === 'fallback') {
        // Upstream's Auto DJ, on or off. A character chip cannot be tapped here.
        const on = chip === 'autoDj';
        return { autoplay: on, kickAutoDj: on && !state.autoplay, rows: [], topUp: false };
    }
    const bound = state.bound;
    if (bound && state.hubEdits) {
        // The hub cuts, inserts and tells the playing device (queueChanged, never a load); a
        // second edit from here was the double handling of B-143.
        if (chip === 'off' || chip === 'autoDj') {
            return {
                apply: true,
                autoplay: false,
                optimistic: { stopped: true },
                rows: [],
                signal: { kind: 'stop' },
                topUp: false,
            };
        }
        if (bound.stopped || bound.character !== chip) {
            return {
                apply: true,
                autoplay: true,
                character: chip,
                optimistic: { character: chip, exhausted: false, stopped: false },
                rows: [],
                signal: { kind: 'character', value: chip },
                topUp: false,
            };
        }
        return { autoplay: true, character: chip, rows: [], topUp: true };
    }
    if (chip === 'off' || chip === 'autoDj') {
        if (!bound) return { autoplay: false, rows: [], topUp: false };
        // Off stops the station for every device and takes out what it queued that has not
        // played; nothing more is added to this queue while it stays Off.
        return {
            autoplay: false,
            optimistic: { stopped: true },
            rows: removableStationRows(queue.playOrder, queue.position, queue.keepNext),
            ...(bound.stopped ? {} : { signal: { kind: 'stop' as const } }),
            topUp: false,
        };
    }
    const plan: ChipTapPlan = { autoplay: true, character: chip, rows: [], topUp: true };
    if (bound && (bound.stopped || bound.character !== chip)) {
        // The character also lifts a stop (and the hub clears exhaustion on the change).
        plan.signal = { kind: 'character', value: chip };
        plan.optimistic = { character: chip, exhausted: false, stopped: false };
        const rows = removableStationRows(queue.playOrder, queue.position, queue.keepNext);
        if (rows.length > 0) {
            plan.rows = rows;
            plan.replaceCount = REPLACE_COUNT;
        }
    }
    return plan;
};

export type RemoteEditAct =
    | { action: 'enqueue'; at: 'end'; count: number }
    | { action: 'remove'; index: number };

/**
 * The acts that edit a REMOTE session: one `remove` per row, highest queue index first (each
 * removal shifts only the indexes after it), then one `enqueue` at the end for what replaces
 * them. Never a `setQueue`: the playing device would reload the whole queue.
 */
export const remoteEditActs = (
    removeIndexes: readonly number[],
    addCount: number,
): RemoteEditAct[] => [
    ...[...new Set(removeIndexes)]
        .filter((index) => Number.isInteger(index) && index >= 0)
        .sort((a, b) => b - a)
        .map((index) => ({ action: 'remove' as const, index })),
    ...(addCount > 0 ? [{ action: 'enqueue' as const, at: 'end' as const, count: addCount }] : []),
];

/**
 * The line under the chips (B-146): what built the queue, then what happens next, as one line
 * the panel truncates (its tooltip carries this whole text). Null when there is nothing to say.
 */
export const chipLine = (origin: null | string, status: null | string): null | string => {
    const parts = [origin, status].filter((part): part is string => Boolean(part?.trim()));
    return parts.length > 0 ? parts.join(' · ') : null;
};

/** What happens when the queue runs out, as the key of its sentence (`naviConnect.station.*`). */
export type StationStatusKey = 'continues' | 'exhausted' | 'finding' | 'offStops' | 'partial';

/**
 * The status under the chips, by key. Off (a stopped station, or no station and Autoplay off)
 * means the queue stops at its end, radios included. Null when there is nothing to say.
 */
export const stationStatusKey = (state: {
    autoplay: boolean;
    bound: null | Pick<StationBinding, 'exhausted' | 'stopped'>;
    inFlight: boolean;
    lastPartial: boolean;
    mode: StationMode;
}): null | StationStatusKey => {
    if (state.mode !== 'stations') return null;
    if (state.bound ? state.bound.stopped : !state.autoplay) return 'offStops';
    if (state.bound?.exhausted) return 'exhausted';
    if (state.inFlight) return 'finding';
    if (state.lastPartial) return 'partial';
    if (!state.bound) return 'continues';
    return null;
};

/**
 * The side queue header's line under the title (R14, B-251): the bound station's name, character
 * and engine, and no status sentence. The Autoplay switch beside the title already says on or off,
 * and a line that came and went with it ("Off stops", "Auto DJ") moved the list under the pointer
 * at every flip. The drawer, the popover and the Now Playing page keep the whole line
 * (queue-station-chips.tsx).
 */
export const panelStatusLine = (origin: null | string, bound: boolean): null | string =>
    bound && origin?.trim() ? origin : null;
