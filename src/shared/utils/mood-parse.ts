import type {
    MoodCatalogue,
    MoodEntry,
    MoodListData,
    MoodOutcome,
    MoodVariant,
} from '/@/shared/types/mood-types';

/**
 * The hub's mood answers, read defensively (spec/mood-contract.md). Pure: the main process
 * calls it, and so does the harness. Unknown fields are ignored; a mood or variant without a
 * string id is dropped.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const int = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
const isHue = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 359;

const toVariant = (value: unknown): MoodVariant | null => {
    if (!isObject(value) || typeof value.id !== 'string' || !value.id) return null;
    const hue = value.hue;
    return {
        hue:
            Array.isArray(hue) && hue.length === 2 && isHue(hue[0]) && isHue(hue[1])
                ? [hue[0], hue[1]]
                : [],
        id: value.id,
        title: str(value.title) || value.id,
    };
};

const toMood = (value: unknown): MoodEntry | null => {
    if (!isObject(value) || typeof value.id !== 'string' || !value.id) return null;
    return {
        depth: Math.max(0, int(value.depth, 300)),
        filter: value.filter === true,
        group: value.group === 'home' ? 'home' : 'extra',
        id: value.id,
        label: str(value.label) || value.id,
        maxSeconds:
            typeof value.maxSeconds === 'number' && Number.isFinite(value.maxSeconds)
                ? value.maxSeconds
                : null,
        variants: Array.isArray(value.variants)
            ? value.variants.map(toVariant).filter((v): v is MoodVariant => v !== null)
            : [],
    };
};

export const parseMoodCatalogue = (json: unknown): MoodCatalogue | null => {
    if (!isObject(json)) return null;
    return {
        available: json.available === true,
        configured: json.configured === true,
        moods: Array.isArray(json.moods)
            ? json.moods.map(toMood).filter((m): m is MoodEntry => m !== null)
            : [],
        ready: json.ready === true,
        version: typeof json.version === 'number' ? String(json.version) : str(json.version),
    };
};

export const parseMoodList = (json: unknown): MoodListData | null => {
    if (!isObject(json) || !Array.isArray(json.ids)) return null;
    return {
        depth: Math.max(0, int(json.depth, json.ids.length)),
        ids: json.ids.filter((id): id is string => typeof id === 'string' && id.length > 0),
        mood: str(json.mood),
        variant: str(json.variant),
        version: typeof json.version === 'number' ? String(json.version) : str(json.version),
    };
};

/**
 * 200 is an answer. A 404 with no code is a hub older than the routes (absent: no moods, not an
 * error); with a code it is about this request (unknown). Anything else, and no answer, is
 * unavailable.
 */
export const moodOutcome = (status: number, code?: string): MoodOutcome => {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 404) return code ? 'unknown' : 'absent';
    return 'unavailable';
};

/** The stored copy of the catalogue, read through the same parse (a bad or old value is none, never a crash). */
export const parseStoredMoodCatalogue = (raw: null | string): MoodCatalogue | undefined => {
    if (!raw) return undefined;
    try {
        return parseMoodCatalogue(JSON.parse(raw)) ?? undefined;
    } catch {
        return undefined;
    }
};
