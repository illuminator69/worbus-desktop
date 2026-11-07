/*
 * Pure helpers for the header's titles, kept free of the app's `/@/` aliases so a node harness can
 * import them. `library-header.tsx` re-exports `calculateWeightedLength` for its existing users.
 */

const MIN_HERO_TITLE = 28;

export const isAsianCharacter = (char: string): boolean => {
    const codePoint = char.codePointAt(0);

    if (!codePoint) return false;

    // CJK Unified Ideographs: U+4E00–U+9FFF
    if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return true;

    // Hiragana: U+3040–U+309F
    if (codePoint >= 0x3040 && codePoint <= 0x309f) return true;

    // Katakana: U+30A0–U+30FF
    if (codePoint >= 0x30a0 && codePoint <= 0x30ff) return true;

    // CJK Extension A: U+3400–U+4DBF
    if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return true;

    // CJK Compatibility Ideographs: U+F900–U+FAFF
    if (codePoint >= 0xf900 && codePoint <= 0xfaff) return true;

    // Fullwidth forms (some Asian characters): U+FF00–U+FFEF
    // Only count fullwidth letters/numbers as Asian
    if (codePoint >= 0xff01 && codePoint <= 0xff5e) return true;

    return false;
};

export const calculateWeightedLength = (str: string): number => {
    let length = 0;
    for (const char of str) {
        length += isAsianCharacter(char) ? 2.5 : 1;
    }
    return length;
};

/*
 * The hero title: the board's size (`max`) for a short name, stepping down for a long one so it
 * still sits on a few lines. Never larger than `max` and never below 28 px.
 */
export const heroTitleSize = (title: string, max: number): string => {
    const length = calculateWeightedLength(title);
    let factor = 1;

    if (length > 18) factor = 0.85;
    if (length > 28) factor = 0.75;
    if (length > 40) factor = 0.65;
    if (length > 55) factor = 0.55;

    return `${Math.min(max, Math.max(MIN_HERO_TITLE, Math.round(max * factor)))}px`;
};
