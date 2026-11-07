/**
 * F6: typo-tolerant matching for the Library field, ported rule for rule from Worbus for Android's Find
 * (`FuzzyMatch.kt`), so both clients find the same artist for the same typo.
 *
 * Navidrome's search matches substrings, so a typo finds nothing there; the whole artist list is held
 * here instead and scored locally. Each query token must be matched by some candidate token: exactly,
 * as a prefix, or within an edit allowance that grows with the token's length (Damerau: a transposition
 * is one edit). Tokens of one to three letters get no allowance, the documented limit ("daft pnk" does
 * not find Daft Punk): with one edit there, "boy" finds Bob Dylan. Non-Latin tokens (CJK, Cyrillic...)
 * match as substrings and never fuzzily, since an edit there changes the word. Pure, for the harness.
 */

export type FuzzyTier = 'exact' | 'prefix' | 'typo' | 'word';

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Latin letters with marks, and the few ligatures and letters that are their own spelling. */
const FOLDS: Record<string, string> = {};
const fold = (chars: string, to: string) => {
    for (const c of chars) FOLDS[c] = to;
};
fold('àáâãäåāăąǎạảấầẩẫậắằẳẵặ', 'a');
fold('æ', 'ae');
fold('çćĉċč', 'c');
fold('ďđð', 'd');
fold('èéêëēĕėęěẹẻẽếềểễệ', 'e');
fold('ĝğġģ', 'g');
fold('ĥħ', 'h');
fold('ìíîïĩīĭįıǐỉị', 'i');
fold('ĵ', 'j');
fold('ķ', 'k');
fold('ĺļľŀł', 'l');
fold('ñńņň', 'n');
fold('òóôõöøōŏőǒọỏốồổỗộơớờởỡợ', 'o');
fold('œ', 'oe');
fold('ŕŗř', 'r');
fold('śŝşšș', 's');
fold('ß', 'ss');
fold('ţťŧț', 't');
fold('þ', 'th');
fold('ùúûüũūŭůűųǔưụủứừửữự', 'u');
fold('ŵ', 'w');
fold('ýÿŷỳỵỷỹ', 'y');
fold('źżž', 'z');

const DROPPED = new Set(["'", '.', '‘', '’', 'ʼ']);

/** Lower case, accents folded, "&" read as "and", apostrophes and dots dropped, every other symbol a space. */
export const normalizeForSearch = (s: string): string => {
    let out = '';
    let pendingSpace = false;
    const put = (text: string) => {
        if (pendingSpace && out.length > 0) out += ' ';
        pendingSpace = false;
        out += text;
    };
    for (const raw of s) {
        const c = raw.toLowerCase();
        if (DROPPED.has(c)) continue;
        if (c === '&') {
            pendingSpace = true;
            put('and');
            pendingSpace = true;
        } else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
            put(c);
        } else if (c.length === 1 && c.charCodeAt(0) < 0x80) {
            pendingSpace = true;
        } else {
            const folded = FOLDS[c];
            if (folded !== undefined) put(folded);
            else if (LETTER_OR_DIGIT.test(c)) put(c);
            else pendingSpace = true;
        }
    }
    return out;
};

type Prepared = { joined: string; normalized: string; tokens: string[] };

const prepare = (text: string): Prepared => {
    const normalized = normalizeForSearch(text);
    const tokens = normalized === '' ? [] : normalized.split(' ');
    return { joined: tokens.join(''), normalized, tokens };
};

type PreparedQuery = Prepared & { latin: boolean[] };

const LATIN_TOKEN = /^[a-z0-9]+$/;

const prepareQuery = (query: string): null | PreparedQuery => {
    const text = prepare(query);
    if (text.tokens.length === 0) return null;
    return { ...text, latin: text.tokens.map((t) => LATIN_TOKEN.test(t)) };
};

// A token's match, best first: exact, a prefix, one edit, two edits. Two edits on a seven-letter word
// let "beetles" find "Nettles" and "Besties" (seen on Worbus for Android's AVD), so they rank below one.
const TIER_EXACT = 4;
const TIER_PREFIX = 3;
const TIER_FUZZY = 2;
const TIER_FUZZY2 = 1;
const TIER_NONE = 0;

const MAX_TOKEN = 48;

/** One to three letters: none. Four to six: one edit. Seven or more: two. A token with a digit: none. */
const allowance = (token: string): number => {
    if (/[0-9]/.test(token)) return 0;
    if (token.length <= 3) return 0;
    if (token.length <= 6) return 1;
    return 2;
};

// The scorer's distance rows, reused for every candidate (Task 3 scores the whole library per keystroke).
const row0 = new Int32Array(MAX_TOKEN + 1);
const row1 = new Int32Array(MAX_TOKEN + 1);
const row2 = new Int32Array(MAX_TOKEN + 1);

/**
 * Optimal string alignment distance, bounded: anything over `k` comes back as k + 1. With `prefix` it
 * is the distance to the closest PREFIX of `b` (the last query word may be unfinished).
 */
const distance = (a: string, b: string, k: number, prefix: boolean): number => {
    const m = a.length;
    const n = prefix ? Math.min(b.length, m + k) : b.length;
    let prev2 = row0;
    let prev = row1;
    let cur = row2;
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        let rowMin = cur[0];
        const ac = a.charCodeAt(i - 1);
        for (let j = 1; j <= n; j++) {
            const bc = b.charCodeAt(j - 1);
            const cost = ac === bc ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && ac === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bc) {
                v = Math.min(v, prev2[j - 2] + 1);
            }
            cur[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > k) return k + 1;
        const t = prev2;
        prev2 = prev;
        prev = cur;
        cur = t;
    }
    if (!prefix) return prev[n];
    let best = k + 1;
    for (let j = Math.max(0, m - k); j <= n; j++) if (prev[j] < best) best = prev[j];
    return best;
};

const tokenTier = (qt: string, latin: boolean, ct: string, isLast: boolean): number => {
    if (qt === ct) return TIER_EXACT;
    if (ct.startsWith(qt)) return TIER_PREFIX;
    if (!latin) return ct.includes(qt) ? TIER_PREFIX : TIER_NONE;
    const k = allowance(qt);
    if (k === 0) return TIER_NONE;
    if (qt.length > MAX_TOKEN || ct.length > MAX_TOKEN) return TIER_NONE;
    const lengthGap = ct.length - qt.length;
    let d = k + 1;
    if (lengthGap <= k && lengthGap >= -k) d = distance(qt, ct, k, false);
    if (d > 1 && isLast && ct.length >= qt.length - k) d = Math.min(d, distance(qt, ct, k, true));
    if (d <= 1) return TIER_FUZZY;
    if (d <= k) return TIER_FUZZY2;
    return TIER_NONE;
};

/**
 * "boy genius" against "boygenius": the words run together on one side only. Exact or a prefix, never
 * fuzzy: joined, "daft pnk" is one edit from "daftpunk", and the short-word rule says no.
 */
const joinedScore = (q: PreparedQuery, c: Prepared): number => {
    if (q.tokens.length === 1 && c.tokens.length === 1) return 0;
    if (q.joined === c.joined) return 800;
    if (c.joined.startsWith(q.joined)) return 700;
    return 0;
};

const scorePrepared = (q: PreparedQuery, c: Prepared): number => {
    if (c.tokens.length === 0) return 0;
    if (q.normalized === c.normalized) return 1000;
    if (c.normalized.startsWith(q.normalized)) return 900;
    // One letter is too little to search inside a name: only a start counts.
    if (q.normalized.length === 1) return 0;

    let worst = TIER_EXACT;
    let firstAtStart = false;
    const last = q.tokens.length - 1;
    for (let qi = 0; qi < q.tokens.length; qi++) {
        const qt = q.tokens[qi];
        let best = TIER_NONE;
        let bestAt = -1;
        for (let ci = 0; ci < c.tokens.length; ci++) {
            const t = tokenTier(qt, q.latin[qi], c.tokens[ci], qi === last);
            if (t > best) {
                best = t;
                bestAt = ci;
                if (t === TIER_EXACT) break;
            }
        }
        if (best === TIER_NONE) return joinedScore(q, c);
        if (qi === 0) firstAtStart = bestAt === 0;
        if (best < worst) worst = best;
    }
    const base =
        worst === TIER_EXACT ? 800 : worst === TIER_PREFIX ? 700 : worst === TIER_FUZZY ? 600 : 520;
    const extra = Math.max(0, c.tokens.length - q.tokens.length);
    return base + (firstAtStart ? 50 : 0) + Math.max(0, 40 - 5 * extra);
};

/** 0 when `candidate` does not match `query`; higher is better. An exact match is 1000, a prefix 900. */
export const fuzzyScore = (query: string, candidate: string): number => {
    const q = prepareQuery(query);
    if (!q) return 0;
    return scorePrepared(q, prepare(candidate));
};

/**
 * What a score means: the whole name (exact), the name's start (prefix), every word found as typed or
 * as a word's start (word, 700 to 899), or a typo somewhere (below 700). Null for no match.
 */
export const fuzzyTier = (score: number): FuzzyTier | null => {
    if (score <= 0) return null;
    if (score >= 1000) return 'exact';
    if (score >= 900) return 'prefix';
    if (score >= 700) return 'word';
    return 'typo';
};

export type FuzzyIndex<T> = {
    search(query: string, limit: number): { score: number; value: T }[];
    /** The entries' values, in input order. */
    values: readonly T[];
};

/**
 * The library's names, normalised once, searched per query. Best first; ties keep input order; empty
 * for a blank query. Nothing is allocated per candidate beyond its prepared tokens.
 */
export const buildFuzzyIndex = <T>(entries: { text: string; value: T }[]): FuzzyIndex<T> => {
    const values = entries.map((e) => e.value);
    const texts = entries.map((e) => prepare(e.text));
    return {
        search(query, limit) {
            const q = prepareQuery(query);
            if (!q || limit <= 0) return [];
            const hits: { at: number; score: number }[] = [];
            for (let i = 0; i < texts.length; i++) {
                const score = scorePrepared(q, texts[i]);
                if (score > 0) hits.push({ at: i, score });
            }
            hits.sort((a, b) => b.score - a.score || a.at - b.at);
            const cut = Number.isFinite(limit) ? hits.slice(0, limit) : hits;
            return cut.map((h) => ({ score: h.score, value: values[h.at] }));
        },
        values,
    };
};
