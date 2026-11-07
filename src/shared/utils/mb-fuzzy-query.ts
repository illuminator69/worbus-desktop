/**
 * F6: what the Library field sends lb-bot's MusicBrainz artist lookup, ported from Worbus for Android's
 * `MusicBrainzQuery.kt`. The term reaches MusicBrainz verbatim as a Lucene query, so typo tolerance
 * there costs no request: a word of four or more Latin letters or digits gets "~1", one edit. Not "~"
 * (distance 2): on short words that ranked strangers first ("boy~ genuis~" put Bob Dylan above
 * boygenius, probed for Worbus for Android 2026-10-20). A word with a symbol in it is escaped and left exact; text
 * that already reads as Lucene is sent as typed. Pure, for the harness.
 */

const LUCENE_SPECIALS = new Set('+-&|!(){}[]^"~*?:\\/');

const LATIN_LETTER = /^\p{L}$/u;

/** a-z, digits, and the Latin letters with marks (Latin-1 Supplement and Latin Extended-A/B). */
const isLatinLetterOrDigit = (c: string): boolean => {
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return true;
    const code = c.charCodeAt(0);
    return c.length === 1 && code >= 0xc0 && code <= 0x24f && LATIN_LETTER.test(c);
};

export const mbFuzzyQuery = (raw: string): string => {
    if (raw.trim() === '') return '';
    if (/[":~]/.test(raw)) return raw;
    return raw
        .trim()
        .split(/\s+/)
        .map((word) => {
            // A bare operator would be read as one: "Simon AND Garfunkel".
            if (word === 'AND' || word === 'OR' || word === 'NOT') return word.toLowerCase();
            const chars = [...word];
            if (chars.some((c) => LUCENE_SPECIALS.has(c))) {
                return chars.map((c) => (LUCENE_SPECIALS.has(c) ? `\\${c}` : c)).join('');
            }
            if (chars.length >= 4 && chars.every(isLatinLetterOrDigit)) return `${word}~1`;
            return word;
        })
        .join(' ');
};
