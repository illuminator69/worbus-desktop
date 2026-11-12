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
 * Amendment 2026-11-12: an act `A (B)` (one trailing part in `()` or `（）`) also matches a plain act
 * whose key is A's or B's; B never, when every word of its key is a number or a disambiguator
 * (`CREDIT_DISAMBIGUATORS` in `album-match.ts`); two bracketed acts match only by their whole keys.
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
        input: 'Bjo\u0308rk',
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
        android: 'daft\u00a0punk',
        input: 'Daft\u00a0Punk',
        key: 'daft punk',
        note: 'a no-break space is a separator; Android keeps it inside the word',
    },
    {
        android: '米津\u3000玄師',
        input: '米津\u3000玄師',
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
    { a: 'Joe Hisaishi 久石譲', b: 'Joe Hisaishi', note: 'an alias with no bracket', same: false },

    // Amendment 2026-11-12 (the coordinator's ruling): an act of the form `A (B)`, ONE trailing
    // bracketed part in round or full-width brackets, also matches `A` alone and `B` alone, each as a
    // whole key; two bracketed acts match only as wholes; a disambiguator in the bracket is never a
    // name on its own (it still separates `A (UK)` from `A (US)`).
    { a: 'BTS (방탄소년단)', android: false, b: 'BTS', note: 'A (B) matches A', same: true },
    { a: 'BTS (방탄소년단)', android: false, b: '방탄소년단', note: 'A (B) matches B', same: true },
    {
        a: 'BTS\uff08방탄소년단\uff09',
        android: false,
        b: 'BTS',
        note: 'full-width brackets, no space before them',
        same: true,
    },
    {
        a: 'BTS\uff08방탄소년단\uff09',
        android: false,
        b: '방탄소년단',
        note: 'full-width brackets: B',
        same: true,
    },
    { a: 'BTS (방탄소년단)', b: 'BTS (방탄소년단)', note: 'A (B) matches itself', same: true },
    { a: 'BTS (방탄소년단)', b: 'BTS (防弾少年団)', note: 'A (B) against A (C): no', same: false },
    {
        a: 'BTS (방탄소년단)',
        b: '방탄소년단 (BTS)',
        note: 'two bracketed acts compare as wholes: the swapped form does not match (open question)',
        same: false,
    },
    {
        a: 'IU (아이유) & BTS (방탄소년단)',
        android: false,
        b: '아이유',
        note: 'the credit is split first, then each act read',
        same: true,
    },
    { a: 'BTS (방탄소년단)', b: '방탄', note: 'B matches only as a whole key', same: false },
    { a: 'BTS (방탄소년단)', b: 'BT', note: 'A matches only as a whole key', same: false },
    {
        a: 'Nirvana (US)',
        android: false,
        b: 'Nirvana',
        note: 'disambiguated A (B) matches A',
        same: true,
    },
    { a: 'Nirvana (US)', b: 'US', note: 'a disambiguator is not a name', same: false },
    {
        a: 'Nirvana (UK)',
        b: 'Nirvana (US)',
        note: 'disambiguators still tell two acts apart',
        same: false,
    },
    { a: 'Genesis (band)', b: 'Band', note: 'a disambiguator is not a name', same: false },
    { a: 'Bush (UK band)', b: 'UK Band', note: 'every word a disambiguator', same: false },
    {
        a: 'Nirvana (2)',
        android: false,
        b: 'Nirvana',
        note: 'a Discogs number: A matches',
        same: true,
    },
    { a: 'Nirvana (2)', b: '2', note: 'a number is not a name', same: false },
    { a: 'Hans Zimmer (composer)', b: 'Composer', note: 'a role word is not a name', same: false },
    { a: '아이유 (가수)', b: '가수', note: 'a native-script role word is not a name', same: false },
    {
        a: 'Robbie Robertson (The Band)',
        android: false,
        b: 'The Band',
        note: 'a name in the bracket is a name, even one made of a disambiguator and "the"',
        same: true,
    },
    { a: 'Foo (Bar) (Baz)', b: 'Foo', note: 'two bracketed parts: not the shape', same: false },
    { a: 'BTS [방탄소년단]', b: 'BTS', note: 'square brackets: not the shape', same: false },
    { a: 'BTS (방탄소년단', b: 'BTS', note: 'an unclosed bracket: not the shape', same: false },
    { a: 'Foo (Bar)', b: 'Foo Bar', note: 'the whole key, as before', same: true },
    {
        a: '!!! (Chk Chk Chk)',
        b: 'Chk Chk Chk',
        note: 'A has no key: the whole is B, as before',
        same: true,
    },

    // What the rule does not do (unchanged, both clients).
    { a: 'Björk', b: 'Bjork', note: 'no accent folding', same: false },
    { a: 'Bjo\u0308rk', b: 'Björk', note: 'NFD against NFC: no normalisation form', same: false },
    {
        a: 'Jose\u0301',
        b: 'Jose',
        note: 'NFD: the mark is a separator, so the accent drops',
        same: true,
    },
    { a: 'Ｙｏａｓｏｂｉ', b: 'Yoasobi', note: 'no NFKC', same: false },
    {
        a: 'कुमार सानू',
        b: 'कोमार सोनू',
        note: 'constructed: names that differ only in vowel signs (marks) collide, on both clients',
        same: true,
    },

    // Where Android differs today.
    {
        a: 'Daft\u00a0Punk',
        android: false,
        b: 'Daft Punk',
        note: 'a no-break space separates words',
        same: true,
    },
    {
        a: '米津\u3000玄師',
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
