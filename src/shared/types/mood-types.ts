/**
 * The hub's mood routes (spec: the hub's P7 A1): `GET /sonic/mood/catalogue` and
 * `POST /sonic/mood/list`. A variant id is unique only within its mood: identify a tile by
 * `mood/variant`. Variant titles are unique across the catalogue.
 */

export interface MoodCatalogue {
    /** AudioMuse answered and its CLAP index is loaded. */
    available: boolean;
    /** The hub has an AudioMuse address. */
    configured: boolean;
    moods: MoodEntry[];
    ready: boolean;
    version: string;
}

export interface MoodEntry {
    /** How many leading ids of a list a draw may use. */
    depth: number;
    filter: boolean;
    group: 'extra' | 'home';
    id: string;
    label: string;
    /** A song longer than this is not drawn into a mix (null: no limit). */
    maxSeconds: null | number;
    variants: MoodVariant[];
}

export interface MoodListData {
    depth: number;
    /** Navidrome song ids, in rank order. */
    ids: string[];
    mood: string;
    variant: string;
    version: string;
}

export type MoodOutcome = 'absent' | 'ok' | 'unavailable' | 'unknown';

export type MoodResult<T> =
    | { data: T; ok: true; status: number }
    | { error: string; kind: 'absent' | 'unavailable' | 'unknown'; ok: false; status: number };

export interface MoodVariant {
    /** The tile's gradient runs from the first hue to the second (0 to 359; it may wrap). Empty when the hub sent none. */
    hue: [] | [number, number];
    id: string;
    title: string;
}
