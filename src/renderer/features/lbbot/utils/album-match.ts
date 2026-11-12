/**
 * Deciding whether two records that *look* alike are the same album.
 *
 * This exists because of one measured failure. `/lb/album/lookup` passes
 * MusicBrainz's own **text score** straight through, and that score rewards a
 * release-group whose *title* contains both search words over one where the
 * artist match lives in a different field. Measured 2026-09-23 against the
 * deployed service, `q=Daft Punk Discovery`:
 *
 *     1  Pignickel   Daft Punk's Discovery but it's in the SM64 Soundfont
 *     2  verymilkee  Daft Punk's Discovery, but with the SM64 soundfont […]
 *     3  Daft Punk   Discovery
 *
 * So taking the first hit opened a parody's download page for an album the user
 * owned in full. A fielded query fixes the ranking (`q` reaches MusicBrainz
 * verbatim, so it costs nothing and asks a different question), but a text score
 * can still be wrong — which is why the answer is additionally **validated
 * against what was asked** rather than trusted for being first.
 *
 * Declining is a correct outcome here. Opening the wrong album reads as the
 * feature being broken; "couldn't match that" reads as a near miss, which is
 * what it is.
 */

/**
 * B-313, the owner's ruling (2026-11-12): one rule on both clients, and a letter in ANY script
 * counts, as on Worbus for Android. After lower-casing, every code point that is not a letter
 * (`\p{L}`) or a decimal digit (`\p{Nd}`) is a separator: no accent folding and no NFC/NFKC, so a
 * combining mark separates, "Björk" is not "Bjork" and full-width letters stay full-width. The
 * ASCII-only rule before it turned 방탄소년단, 米津玄師, Кино and Σωκράτης into "" (no act, so
 * nothing matched them, themselves included) and made names that differ only in non-ASCII letters
 * equal ("Björk" and "Bjärk" were both "bj rk"). The table both clients run is
 * `artist-name-vectors.ts`.
 */
const NOT_A_LETTER_OR_DIGIT = /[^\p{L}\p{Nd}]+/gu;

/**
 * Drop the edition suffix and everything that is punctuation rather than a word.
 *
 * The suffix matters in both directions: Deezer ships "Discovery (Remastered)"
 * where MusicBrainz and the library both say "Discovery", and a parenthetical
 * defeats an exact comparison and a fielded search alike.
 *
 * Only bracketed runs are stripped, never a separator — "Homework / Discovery"
 * is a different record from "Discovery" and must stay one. The survivors of
 * the real case are the proof this is tight enough: of `Discovery`,
 * `Re-Discovery`, `Discovery Remixed` and `Homework / Discovery`, exactly one
 * normalises to `discovery`.
 *
 * Titles take the artists' letters rule (B-313): once an artist in any script can match, an
 * ASCII-only title fell back to its Latin remainder, and `화양연화 pt.1` picked `花様年華 pt.1`
 * (both "pt 1"). The bracket rule is the desktop's own, unchanged.
 */
export const normalizeAlbumTitle = (value: string): string =>
    (value || '')
        .toLowerCase()
        .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
        .replace(NOT_A_LETTER_OR_DIGIT, ' ')
        .trim();

/** Artists take the same treatment minus the suffix rule — an artist name has no
 *  edition. `&`, `feat.` and the rest collapse to spaces, so the comparison below
 *  is over words rather than over punctuation two catalogues spell differently. */
export const normalizeArtistName = (value: string): string =>
    (value || '').toLowerCase().replace(NOT_A_LETTER_OR_DIGIT, ' ').trim();

/**
 * Split a credit string into the acts it names.
 *
 * Deezer credits a collaboration to one artist where MusicBrainz writes the
 * whole thing ("Daft Punk" vs "Daft Punk & Julian Casablancas"), so comparing
 * the strings whole would decline every such record. Splitting first means each
 * side becomes a set of acts and the comparison is exact within it.
 *
 * Done **before** normalisation, because the separators are punctuation and
 * `normalizeArtistName` removes it.
 *
 * `/` is deliberately **not** a separator, though MusicBrainz does sometimes use
 * it as one: AC/DC is the counterexample, and splitting on it would let "AC"
 * match them. Declining to split an "A / B" credit only costs a match; splitting
 * AC/DC would hand back a wrong album, which is the failure this file exists to
 * stop.
 */
/**
 * B-313: `&`, `+`, `,`, `;`, `•` (with or without spaces), `feat.`, `featuring`, `with`, `vs.`,
 * `x` as whole words, and a hyphen with whitespace on BOTH sides ("Lana Del Rey - Nikki Lane").
 * Never an unspaced hyphen (Jay-Z, Run-DMC) and never `/` (AC/DC). The bullet and the spaced
 * hyphen are the hub's (`_ARTIST_SEP_RE`, B-176/Q-120); Worbus for Android's rule is the same.
 *
 * "Whole word" is in any script (the 2026-11-12 ruling): a keyword counts only where no letter,
 * mark, decimal digit or connector stands beside it. `\b` is ASCII in JavaScript, so "Iannis
 * Xénakis" split at the x and matched "Iannis"; once é is a letter, the x is inside a word.
 */
const WORD_CHAR = String.raw`[\p{L}\p{M}\p{Nd}\p{Pc}]`;
export const CREDIT_SEPARATORS = new RegExp(
    String.raw`\s+-\s+|\s*(?:&|\+|,|;|•|(?<!${WORD_CHAR})(?:feat\.?|featuring|with|vs\.?|x)(?!${WORD_CHAR}))\s*`,
    'iu',
);

/**
 * B-313 amendment (2026-11-12, the coordinator's ruling for both clients): an act written `A (B)`,
 * with ONE trailing bracketed part in round or full-width brackets, is also A alone and B alone.
 * K-pop libraries tag "BTS (방탄소년단)" where lb-bot and MusicBrainz say "BTS"; the ASCII-only
 * rule matched that by dropping the Hangul, and the any-script rule alone would not.
 *
 * - A and B are compared as whole keys (`BTS (방탄소년단)` is not `BT`, nor `방탄`).
 * - Two bracketed acts match only as wholes: `A (B)` is not `A (C)`, nor `B (A)`.
 * - A bracket whose every word is a number or a {@link CREDIT_DISAMBIGUATORS} word
 *   ("(US)", "(band)", "(2)", "(UK band)", "(가수)") is never a name on its own; A still is.
 * - Square brackets, two bracketed parts and an unclosed bracket are not the shape.
 * - The credit is split into acts first, so "IU (아이유) & BTS (방탄소년단)" is two such acts.
 */
const TRAILING_BRACKET = /^([^()（）]*)[(（]([^()（）]*)[)）]\s*$/u;

/** Words that only tell two acts of one name apart: roles, a few genres, countries and
 *  nationalities, as MusicBrainz, Discogs and Wikipedia write them in a credit's bracket. */
export const CREDIT_DISAMBIGUATORS: ReadonlySet<string> = new Set(
    [
        // roles
        'artist band composer dj duo group mc musician producer rapper singer songwriter trio vocalist',
        // genres
        'electronic folk hip hop indie jazz metal pop punk rap rock',
        // countries and regions
        'au br ca cn de dk es fi fr gb hk ie japan jp korea kr mx nl north nz pl ru se south tw ua uk us usa',
        // nationalities
        'american australian brazilian british canadian chinese danish dutch english finnish french german',
        'irish italian japanese korean mexican norwegian russian scottish spanish swedish',
        // the same roles in the scripts the shape is common in
        '가수 그룹 래퍼 밴드 バンド 歌手',
    ]
        .join(' ')
        .split(' '),
);

const isDisambiguator = (key: string): boolean =>
    key.split(' ').every((word) => /^\p{Nd}+$/u.test(word) || CREDIT_DISAMBIGUATORS.has(word));

/** One credited act: its whole key, and for the `A (B)` shape the keys it also is alone. */
type CreditedAct = { alone: string[]; bracketed: boolean; key: string };

const creditedAct = (part: string): CreditedAct | null => {
    const key = normalizeArtistName(part);
    if (!key) return null;
    const shape = TRAILING_BRACKET.exec(part.trim());
    const inner = shape ? normalizeArtistName(shape[2]) : '';
    if (!shape || !inner) return { alone: [], bracketed: false, key };
    const alone = [normalizeArtistName(shape[1]), isDisambiguator(inner) ? '' : inner];
    return { alone: alone.filter(Boolean), bracketed: true, key };
};

const creditedActs = (value: string): CreditedAct[] => {
    const whole = creditedAct(value || '');
    if (!whole) return [];
    const parts = (value || '')
        .split(CREDIT_SEPARATORS)
        .map(creditedAct)
        .filter((act): act is CreditedAct => act !== null);
    // A credit that is ENTIRELY separator tokens splits to nothing - an act
    // actually named "X" is the real case. Falling back to the whole string
    // keeps that artist matchable instead of silently never matching.
    return parts.length > 0 ? parts : [whole];
};

/** Exact whole keys; else a bracketed act against a plain one, by what the bracketed one is alone. */
const sameAct = (x: CreditedAct, y: CreditedAct): boolean => {
    if (x.key === y.key) return true;
    if (x.bracketed === y.bracketed) return false;
    const [shaped, plain] = x.bracketed ? [x, y] : [y, x];
    return shaped.alone.includes(plain.key);
};

/**
 * Whether two artist credits name the same act.
 *
 * Each side is split into the acts it credits and compared **exactly** within
 * that set. Exact per act rather than substring or token containment, and that
 * distinction is load-bearing: a containment rule reads as harmless and is not.
 * Measured while writing this - `sameArtist("Pink Floyd", "Pink")` came back
 * TRUE under whole-token containment, because "pink" really is a token of "pink
 * floyd". That is the same class of wrong answer this whole file exists to
 * prevent, arriving through the check meant to prevent it.
 *
 * Splitting handles the collaboration case that containment was reaching for,
 * and handles it better: a one-word act ("Madonna" in "Madonna & Justin
 * Timberlake") matches, which a "the shorter side must have two tokens" guard
 * would have refused. The one widening is the `A (B)` shape above.
 */
export const sameArtist = (a: string, b: string): boolean => {
    const left = creditedActs(a);
    const right = creditedActs(b);
    return left.some((x) => right.some((y) => sameAct(x, y)));
};

/** Titles are compared exactly once normalised — unlike artists, a title that is
 *  merely *contained* in another is a different record ("Discovery" inside
 *  "Discovery Remixed"), which is the half of the bug a ranking fix alone left
 *  standing. */
export const sameAlbumTitle = (a: string, b: string): boolean => {
    const left = normalizeAlbumTitle(a);
    const right = normalizeAlbumTitle(b);
    return Boolean(left) && left === right;
};

/**
 * The fielded MusicBrainz query, built from what was actually asked.
 *
 * `q` reaches MusicBrainz verbatim through lb-bot, so naming the fields costs
 * nothing and is a different question from the free-text one. Measured on the
 * case above it returns the right record first and no parodies at all.
 *
 * Quotes inside a value would close the phrase early and turn the rest into
 * loose terms, so they are dropped rather than escaped — Lucene's escaping rules
 * differ enough between versions that dropping is the predictable option, and a
 * quotation mark carries no matching signal.
 */
export const fieldedAlbumQuery = (artist: string, title: string): string => {
    const clean = (value: string) => (value || '').replace(/["\\]/g, ' ').trim();
    const artistTerm = clean(artist);
    // The bare title, so an edition suffix in the browse row's spelling does not
    // have to exist in MusicBrainz's.
    const titleTerm = clean(title)
        .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
        .trim();
    if (!titleTerm) return '';
    if (!artistTerm) return `releasegroup:"${titleTerm}"`;
    return `artist:"${artistTerm}" AND releasegroup:"${titleTerm}"`;
};

/**
 * Does this title carry a bracketed qualifier?
 *
 * The suffix strip in {@link normalizeAlbumTitle} is necessary - Deezer ships
 * "Discovery (Remastered)" where MusicBrainz and the library both say
 * "Discovery" - but it is blunt, and measuring it against the deployed service
 * showed how blunt. The real fielded query for Daft Punk's *Discovery* returns
 * eight candidates, and **three** survive title-and-artist validation:
 * `Discovery`, `Discovery (Beta Version)` and `Discovery (Sample Bandit
 * Bootlegs)` - because all three strip to the same thing.
 *
 * Validation alone therefore narrows the field without deciding it, and leaving
 * the decision to MusicBrainz's text score would put a bootleg one rank away
 * from winning. A candidate with no qualifier at all is the better answer for a
 * request that named none, so this is what breaks that tie.
 */
export const hasEditionSuffix = (value: string): boolean => /[([{][^)\]}]*[)\]}]/.test(value || '');

/**
 * The lookup's answers that really are the album that was asked about, best first.
 *
 * Validation narrows without deciding, so the survivors are ordered: ownership
 * first (a fact about the library, where a score is a guess about text), then a
 * title with no bracketed qualifier, then the order lb-bot sent. Shared by the
 * browse-row resolver and the "Fix album match" release-group fallback so the
 * two cannot disagree about what "the same album" means.
 */
export const rankAlbumCandidates = <
    T extends { artist: string; releaseOwned: boolean; title: string },
>(
    candidates: readonly T[],
    asked: { artist: string; title: string },
): T[] =>
    candidates
        .filter(
            (row) => sameAlbumTitle(row.title, asked.title) && sameArtist(row.artist, asked.artist),
        )
        .map((row, index) => ({ index, row }))
        .sort(
            (a, b) =>
                Number(b.row.releaseOwned) - Number(a.row.releaseOwned) ||
                Number(hasEditionSuffix(a.row.title)) - Number(hasEditionSuffix(b.row.title)) ||
                a.index - b.index,
        )
        .map(({ row }) => row);

/** The best validated answer, or null: declining is a correct outcome. */
export const pickAlbumCandidate = <
    T extends { artist: string; releaseOwned: boolean; title: string },
>(
    candidates: readonly T[],
    asked: { artist: string; title: string },
): null | T => rankAlbumCandidates(candidates, asked)[0] ?? null;
