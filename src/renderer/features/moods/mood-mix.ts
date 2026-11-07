import type { MoodCatalogue, MoodEntry, MoodVariant } from '../../../shared/types/mood-types.ts';

import { tintHues } from '../../../shared/components/animations/tint-hues.ts';
import { hubSetUp } from '../hub/utils/hub-credential.ts';

/**
 * The rules of a Home mood mix (spec/mood-contract.md): which moods are chips, how a mix is
 * drawn from a tile's list, its states, which saved queues came from a mood's tiles, and the
 * tiles' colours. Pure (types only from the app), for the harness.
 */

export const MOOD_MIX_SIZE = 50;
/** Fewer songs than this left after the draw is "Short", never a short mix shown as full. */
export const MOOD_MIX_MIN = 20;
/** No artist twice within this many songs, when the pool allows it. */
export const MOOD_ARTIST_GAP = 4;
/** Song lookups: the first batch, then each further batch, and at most this many batches. */
export const MOOD_FETCH_FIRST = 64;
export const MOOD_FETCH_STEP = 32;
export const MOOD_FETCH_ROUNDS = 8;

export const homeMoods = (c: MoodCatalogue): MoodEntry[] =>
    c.moods.filter((m) => m.group === 'home' && m.variants.length > 0);

/** The chips show only while mood search answers and there is a mood to show. */
export const chipsVisible = (c: MoodCatalogue | null): boolean =>
    !!c && c.available && homeMoods(c).length > 0;

export const findMood = (c: MoodCatalogue | null, id: string): MoodEntry | undefined =>
    c?.moods.find((m) => m.id === id);

/** Tapping the selected chip clears it. */
export const toggleMood = (selected: null | string, id: string): null | string =>
    selected === id ? null : id;

/** The first `depth` ids, each once, in a random order (Fisher-Yates over `random`). */
export const candidateOrder = (ids: string[], depth: number, random: () => number): string[] => {
    const out = [...new Set(ids.slice(0, Math.max(0, depth)))];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

export type DrawSong = { artistKey: string; durationSec: number; id: string };

export const withinLength = (song: DrawSong, maxSeconds: null | number): boolean =>
    maxSeconds === null || song.durationSec <= maxSeconds;

/**
 * Up to `size` songs in their drawn order, each next song the first one whose artist is not
 * among the previous `gap - 1`; when none qualifies the gap gives way (it is a preference).
 * Never pads.
 */
export const arrangeMix = <T extends DrawSong>(
    songs: T[],
    size = MOOD_MIX_SIZE,
    gap = MOOD_ARTIST_GAP,
): T[] => {
    const left = [...songs];
    const out: T[] = [];
    while (out.length < size && left.length > 0) {
        const recent = new Set(out.slice(-(gap - 1)).map((s) => s.artistKey));
        const at = left.findIndex((s) => !recent.has(s.artistKey));
        out.push(left.splice(at === -1 ? 0 : at, 1)[0]);
    }
    return out;
};

export type MixState = 'empty' | 'loading' | 'ready' | 'short' | 'unavailable';

export const mixState = (input: { drawn: DrawSong[] | null; failed: boolean }): MixState => {
    if (input.failed) return 'unavailable';
    if (input.drawn === null) return 'loading';
    if (input.drawn.length === 0) return 'empty';
    return input.drawn.length < MOOD_MIX_MIN ? 'short' : 'ready';
};

/**
 * The saved queues a mood's tiles made, newest first: a tile plays as a radio-kind session
 * named after its title, and the record keeps that title as `sourceName`; `name` is only the
 * user's rename, so a renamed queue drops out (it stays in Continue listening).
 */
export const queuesFromMood = <
    T extends { name?: string; sourceKind: string; sourceName?: string; updatedAt: number },
>(
    queues: T[],
    titles: string[],
    limit = 12,
): T[] =>
    queues
        .filter((q) => q.sourceKind === 'radio' && !q.name && titles.includes(q.sourceName ?? ''))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);

// ---- the tiles' colours ----

export type Hsl = { h: number; l: number; s: number };

const hslToRgb = ({ h, l, s }: Hsl): number[] => {
    const S = s / 100;
    const L = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = S * Math.min(L, 1 - L);
    const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
};
const blend = (top: number[], alpha: number, bottom: number[]) =>
    bottom.map((b, i) => top[i] * alpha + b * (1 - alpha));
const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
};
const WHITE = [255, 255, 255];

/**
 * The tile's worst case at one end: white and white at .88 over the end, plain or under the stripe
 * overlay. The tile paints one stripe, in its second hue, over both ends; both hues are checked.
 */
const worstAt = (end: Hsl, stripeHues: number[]): number => {
    const base = hslToRgb(end);
    const backgrounds = [
        base,
        ...stripeHues.map((h) => blend(hslToRgb({ h, l: 70, s: 80 }), 0.14, base)),
    ];
    return Math.min(
        ...backgrounds.flatMap((bg) => [contrast(WHITE, bg), contrast(blend(WHITE, 0.88, bg), bg)]),
    );
};

const settle = (end: Hsl, stripeHues: number[]): Hsl => {
    let l = end.l;
    while (l > 5 && worstAt({ ...end, l }, stripeHues) < 4.5) l -= 1;
    return { ...end, l };
};

/**
 * A tile's two gradient ends: the board's `hsl(a 58% 44%)` to `hsl(b 60% 24%)`, each end darkened
 * until white text reaches 4.5:1 on it (for hues of about 40 to 190 that is darker than the board
 * draws). A variant with no hue gets a stable pair from its id.
 */
export const tileColors = (variant: MoodVariant): { from: Hsl; to: Hsl } => {
    const [a, b] = variant.hue.length === 2 ? variant.hue : tintHues(variant.id);
    return {
        from: settle({ h: a, l: 44, s: 58 }, [a, b]),
        to: settle({ h: b, l: 24, s: 60 }, [a, b]),
    };
};

/**
 * What the tile's play button does with a draw: play a full or a short mix (a short one says so,
 * so it is never presented as "About 50 songs"), or play nothing and say why.
 */
export const tilePlayResult = (
    state: 'empty' | 'ready' | 'short' | 'unavailable',
): { notice: 'empty' | 'none' | 'short' | 'unavailable'; play: boolean } => {
    if (state === 'ready') return { notice: 'none', play: true };
    if (state === 'short') return { notice: 'short', play: true };
    return { notice: state, play: false };
};

/**
 * Moods show only in the desktop app, for a Navidrome server (the hub's ids are Navidrome's), with
 * the hub switched on and set up (an address and a credential: a device secret held, or a typed
 * token - hub-credential.ts): a hub the user disabled or never set up renders nothing, a stored
 * copy included.
 */
export const moodsShown = (input: {
    electron: boolean;
    hub: { enabled: boolean; token: string; url: string };
    /** Worbus P2: main holds (or is getting) a device secret. */
    secretHeld: boolean;
    serverType: string | undefined;
}): boolean =>
    input.electron && hubSetUp(input.hub, input.secretHeld) && input.serverType === 'navidrome';
