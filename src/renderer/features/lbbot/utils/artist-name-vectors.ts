/**
 * B-313, the shared artist-name vectors (owner's ruling 2026-11-12: one normaliser rule on both
 * clients, a letter in ANY script counts). Worbus for desktop's `album-match.ts` is held to every row
 * by `artist-name.harness.ts`; Worbus for Android's `creditKey` / `creditActs` / `sameArtist`
 * (`BrowseResolver.kt`) are to be held to the same rows. `android` is what Android's code answers
 * TODAY where that differs from the shared answer (measured on a JVM replica of its host-test
 * semantics, 2026-11-12); a row without it is one both clients already agree on.
 *
 * The rule, in words: lower-case (the language-neutral Unicode mapping, `toLowerCase()` /
 * `lowercase()`), then every code point that is not a letter (`\p{L}`) or a decimal digit (`\p{Nd}`)
 * is a separator, runs of separators are one space, and the ends are trimmed. No accent folding, no
 * NFC/NFKC: a combining mark is a separator, full-width letters stay full-width. A credit splits into
 * acts on `CREDIT_SEPARATORS`, whose keywords (feat., featuring, with, vs., x) count only where no
 * letter, mark, decimal digit or connector stands beside them, in any script; an empty key is no act,
 * and two credits with no act never match.
 *
 * Inputs with characters that do not show are written as escapes.
 */

export type KeyVector = {
    /** What Android's `creditKey` answers today, when it differs. */
    android?: string;
    input: string;
    key: string;
    note: string;
};

export type SameArtistVector = {
    a: string;
    /** What Android's `sameArtist(a, b)` answers today, when it differs. */
    android?: boolean;
    b: string;
    note: string;
    same: boolean;
};

export const KEY_VECTORS: readonly KeyVector[] = [
    { input: 'Daft Punk', key: 'daft punk', note: 'Latin: unchanged' },
    { input: 'AC/DC', key: 'ac dc', note: 'punctuation is a separator' },
    { input: 'Jay-Z', key: 'jay z', note: 'an unspaced hyphen is a separator inside the act' },
    { input: '  The   Beatles  ', key: 'the beatles', note: 'runs collapse, ends trimmed' },
    { input: 'Blink-182', key: 'blink 182', note: 'ASCII digits kept' },
    { input: '방탄소년단', key: '방탄소년단', note: 'Hangul syllables are letters' },
    { input: '米津玄師', key: '米津玄師', note: 'Han ideographs are letters' },
    { input: 'ヨルシカ', key: 'ヨルシカ', note: 'katakana are letters' },
    { input: 'Кино', key: 'кино', note: 'Cyrillic, lower-cased' },
    { input: 'ДДТ', key: 'ддт', note: 'Cyrillic capitals' },
    { input: 'Σωκράτης', key: 'σωκράτης', note: 'Greek, final sigma kept' },
    { input: 'ΣΩΚΡΆΤΗΣ', key: 'σωκράτης', note: 'Greek capitals: a final Σ lower-cases to ς' },
    { input: 'Björk', key: 'björk', note: 'precomposed ö is a letter, not folded to o' },
    {
        input: 'Björk',
        key: 'bjo rk',
        note: 'decomposed (NFD) ö: the combining mark is a separator; no NFC',
    },
    { input: 'Sigur Rós', key: 'sigur rós', note: 'no accent folding' },
    { input: 'Straße', key: 'straße', note: 'ß stays ß (no case folding to ss)' },
    { input: 'İlhan', key: 'i lhan', note: 'İ lower-cases to i + U+0307, the mark a separator' },
    {
        input: 'Ｙｏａｓｏｂｉ',
        key: 'ｙｏａｓｏｂｉ',
        note: 'full-width Ｙｏａｓｏｂｉ: lower-cased, NOT folded to ASCII (no NFKC)',
    },
    { input: 'Ⅷ', key: '', note: 'a Roman-numeral sign (Nl) is not a digit' },
    { input: 'Area²', key: 'area', note: 'a superscript (No) is not a digit' },
    { input: 'فرقة ٣', key: 'فرقة ٣', note: 'Arabic letters and Arabic-Indic digits (Nd)' },
    {
        input: 'कुमार सानू',
        key: 'क म र स न',
        note: 'Devanagari vowel signs are marks, so separators (see the pairs)',
    },
    {
        android: 'daft punk',
        input: 'Daft Punk',
        key: 'daft punk',
        note: 'a no-break space is a separator; Android keeps it inside the word',
    },
    {
        android: '米津　玄師',
        input: '米津　玄師',
        key: '米津 玄師',
        note: 'an ideographic space is a separator; Android keeps it inside the word',
    },
    { android: 'a\tb', input: 'a\tb', key: 'a b', note: 'a tab is a separator; Android keeps it' },
    {
        android: '野家',
        input: '\u{20bb7}野家',
        key: '\u{20bb7}野家',
        note: '𠮷 (U+20BB7, outside the BMP) is a letter; Android tests UTF-16 units and drops it',
    },
    { input: '!!!', key: '', note: 'nothing but punctuation' },
    { input: '🎵', key: '', note: 'an emoji is not a letter' },
    { input: '', key: '', note: 'empty' },
];

export const SAME_ARTIST_VECTORS: readonly SameArtistVector[] = [
    // The split's vectors (B-313 desktop half, `SameArtistTest`): unchanged.
    {
        a: 'Phoebe Bridgers • Phoebe Bridgers, Christian Lee Hutson',
        b: 'Phoebe Bridgers',
        note: 'bullet',
        same: true,
    },
    {
        a: 'Phoebe Bridgers•Christian Lee Hutson',
        b: 'Christian Lee Hutson',
        note: 'bullet',
        same: true,
    },
    { a: 'Lana Del Rey - Nikki Lane', b: 'Lana Del Rey', note: 'spaced hyphen', same: true },
    { a: 'Lana Del Rey - Nikki Lane', b: 'Nikki Lane', note: 'spaced hyphen', same: true },
    { a: 'Jay-Z', b: 'Jay', note: 'unspaced hyphen', same: false },
    { a: 'Run-DMC', b: 'Run', note: 'unspaced hyphen', same: false },
    { a: 'Run-DMC', b: 'DMC', note: 'unspaced hyphen', same: false },
    { a: 'Lana Del Rey -Nikki Lane', b: 'Nikki Lane', note: 'one side unspaced', same: false },
    { a: 'AC/DC', b: 'AC', note: 'slash', same: false },
    { a: 'Jay-Z', b: 'Jay-Z', note: 'itself', same: true },
    { a: 'Daft Punk feat. Julian Casablancas', b: 'Daft Punk', note: 'feat.', same: true },
    { a: 'Pink Floyd', b: 'Pink', note: 'containment is not agreement', same: false },

    // A name in any script matches itself (the ASCII-only rule matched none of these).
    { a: '방탄소년단', b: '방탄소년단', note: 'Hangul, itself', same: true },
    { a: '米津玄師', b: '米津玄師', note: 'Han, itself', same: true },
    { a: 'Кино', b: 'Кино', note: 'Cyrillic, itself', same: true },
    { a: 'КИНО', b: 'кино', note: 'Cyrillic, case', same: true },
    { a: 'Σωκράτης', b: 'ΣΩΚΡΆΤΗΣ', note: 'Greek, case and final sigma', same: true },
    { a: '米津玄師 & 菅田将暉', b: '菅田将暉', note: 'split, then a Han act', same: true },
    { a: 'Кино feat. Земфира', b: 'Земфира', note: 'split, then a Cyrillic act', same: true },
    { a: 'Кино', b: 'Ария', note: 'two different names', same: false },

    // Collisions the ASCII-only rule made (its keys dropped every non-Latin letter): now apart.
    { a: 'Björk', b: 'Bjärk', note: 'constructed: both were "bj rk"', same: false },
    { a: 'Би-2', b: 'Ю-2', note: 'constructed: both were "2"', same: false },
    {
        a: 'Iannis Xénakis',
        android: true,
        b: 'Iannis',
        note: 'x before é split there (an ASCII word boundary); a letter in any script keeps x inside the word',
        same: false,
    },

    // Matches the ASCII-only rule made by dropping letters, which the shared rule does not make.
    {
        a: 'BTS (방탄소년단)',
        b: 'BTS',
        note: 'a native-script alias in the credit: was "bts" = "bts"',
        same: false,
    },
    { a: 'Joe Hisaishi 久石譲', b: 'Joe Hisaishi', note: 'the same, Han', same: false },

    // What the rule does not do (unchanged, both clients).
    { a: 'Björk', b: 'Bjork', note: 'no accent folding', same: false },
    { a: 'Björk', b: 'Björk', note: 'NFD against NFC: no normalisation form', same: false },
    { a: 'José', b: 'Jose', note: 'NFD: the mark is a separator, so the accent drops', same: true },
    { a: 'Ｙｏａｓｏｂｉ', b: 'Yoasobi', note: 'no NFKC', same: false },
    {
        a: 'कुमार सानू',
        b: 'कोमार सोनू',
        note: 'constructed: names that differ only in vowel signs (marks) collide, on both clients',
        same: true,
    },

    // Where Android differs today.
    {
        a: 'Daft Punk',
        android: false,
        b: 'Daft Punk',
        note: 'a no-break space separates words',
        same: true,
    },
    {
        a: '米津　玄師',
        android: false,
        b: '米津 玄師',
        note: 'an ideographic space separates words',
        same: true,
    },
    {
        a: '\u{20bb7}野家',
        android: true,
        b: '\u{2000b}野家',
        note: 'constructed: two letters outside the BMP are two letters (Android reads both as "野家")',
        same: false,
    },
    { a: '!!!', android: true, b: '???', note: 'no act on either side', same: false },
    { a: '', android: true, b: '', note: 'empty against empty', same: false },
    { a: '🎵', android: true, b: '💀', note: 'emoji only: no act', same: false },
];
