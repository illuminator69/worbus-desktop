import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import type { Mix } from '../../store/mixes.store.ts';

/**
 * B-149, B-151:  node --test src/renderer/features/mixes/mix-recipe.harness.ts
 *
 * "Mixed for You", the spec shared with Worbus for Android: the form's kinds, their order and words with and
 * without the station engine; the recipe each kind saves; what every stored kind plays as,
 * legacy kinds included; a genre recipe's name from an old id; and the pickers' rule that there
 * is no list until something is typed.
 */

// mix-recipe.ts imports station-logic through the app's `/@/` alias; resolve it to the source.
registerHooks({
    resolve: (specifier, context, nextResolve) =>
        specifier.startsWith('/@/')
            ? nextResolve(
                  new URL(`../../../${specifier.slice(3)}.ts`, import.meta.url).href,
                  context,
              )
            : nextResolve(specifier, context),
});

const {
    artistPickerEmpty,
    buildRecipe,
    FORM_KINDS,
    formKindsFor,
    formKindTakesCharacter,
    genreNameOf,
    isCustomRadio,
    matchGenres,
    mixArtistIds,
    mixLine,
    mixPlan,
    PICKER_LIMIT,
    pickerOptions,
    pickerTerm,
    radioTitle,
    storedCharacter,
    suggestedMixName,
    yourMixLine,
} = await import('./mix-recipe.ts');

const mix = (over: Partial<Mix>): Mix => ({
    character: '',
    count: 50,
    coverArtId: '',
    createdAt: 0,
    id: 'mx_1',
    kind: 'station',
    lastPlayedAt: 0,
    moodCharacter: '',
    name: 'A mix',
    seedId: '',
    seedIds: [],
    seedName: '',
    updatedAt: 0,
    variety: '',
    ...over,
});

const engine = { engine: true, preferred: 'explore' as const };
const noEngine = { engine: false, preferred: 'explore' as const };

// --- The form's kinds ----------------------------------------------------------------------------

test('with the engine: Radio, Your mix, Genre, Artist, in that order, with the shared words', () => {
    assert.deepEqual(
        formKindsFor(true).map((row) => [row.id, row.label, row.description]),
        [
            ['radio', 'Radio', 'Around a song, steered by your skips and likes'],
            ['yourMix', 'Your mix', 'Built from what you play most'],
            ['genre', 'Genre', 'A random run through one genre'],
            ['artist', 'Artist', 'More like the artists you pick'],
        ],
    );
});

test('without the engine Your mix is gone; Radio, Genre and Artist stay, in order', () => {
    assert.deepEqual(
        formKindsFor(false).map((row) => row.id),
        ['radio', 'genre', 'artist'],
    );
});

test('Similar, Adaptive and Sonic fingerprint are not offered in either state', () => {
    const offered = [...formKindsFor(true), ...formKindsFor(false)].map((row) => row.label);
    for (const gone of ['Similar', 'Adaptive', 'Sonic fingerprint']) {
        assert.ok(!offered.some((label) => label.startsWith(gone)), gone);
    }
    assert.equal(FORM_KINDS.length, 4);
});

test('a character is picked for Radio, Your mix and Artist, never for Genre', () => {
    assert.deepEqual(
        FORM_KINDS.map((row) => [row.id, formKindTakesCharacter(row.id)]),
        [
            ['radio', true],
            ['yourMix', true],
            ['genre', false],
            ['artist', true],
        ],
    );
});

test('the suggested name follows the kind and its seed', () => {
    assert.equal(suggestedMixName('radio', { song: 'Cinnamon Girl' }), 'Cinnamon Girl radio');
    assert.equal(suggestedMixName('radio', {}), '');
    assert.equal(suggestedMixName('yourMix', { song: 'Cinnamon Girl' }), 'Your mix');
    assert.equal(suggestedMixName('genre', { genre: 'Shoegaze' }), 'Shoegaze');
    assert.equal(suggestedMixName('artist', { artists: ['Slowdive'] }), 'Slowdive');
    assert.equal(suggestedMixName('artist', { artists: [] }), '');
    assert.equal(
        suggestedMixName('artist', { artists: ['Moth Season', 'Ida Verrall', 'Hollow Orchard'] }),
        'Moth Season, Ida Verrall, Hollow Orchard',
    );
});

// --- The recipe each kind saves -------------------------------------------------------------------

const input = {
    artists: [{ id: 'ar1', name: 'Slowdive' }],
    character: 'close' as const,
    count: 50,
    genre: 'Shoegaze',
    name: '  My mix  ',
    song: { albumId: 'al1', id: 's1', name: 'Cinnamon Girl' },
};

test('Radio: a station seeded with the playing song, with its character twice', () => {
    assert.deepEqual(buildRecipe({ ...input, kind: 'radio' }), {
        character: 'close',
        count: 50,
        coverArtId: 'al1',
        kind: 'station',
        moodCharacter: 'EchoMatch',
        name: 'My mix',
        seedId: 's1',
        seedName: 'Cinnamon Girl',
    });
});

test('Your mix: a station with no seed, whatever is playing', () => {
    assert.deepEqual(buildRecipe({ ...input, character: 'explore', kind: 'yourMix' }), {
        character: 'explore',
        count: 50,
        coverArtId: '',
        kind: 'station',
        moodCharacter: 'TransitionMaestro',
        name: 'My mix',
        seedId: '',
        seedName: '',
    });
    assert.notEqual(buildRecipe({ ...input, kind: 'yourMix', song: null }), null);
});

test('Genre: the NAME in seedId and seedName, and no character', () => {
    assert.deepEqual(buildRecipe({ ...input, kind: 'genre' }), {
        count: 50,
        coverArtId: '',
        kind: 'genre',
        name: 'My mix',
        seedId: 'Shoegaze',
        seedName: 'Shoegaze',
    });
});

test('Artist: the Navidrome artist id and name, with its character', () => {
    assert.deepEqual(buildRecipe({ ...input, character: 'balanced', kind: 'artist' }), {
        character: 'balanced',
        count: 50,
        coverArtId: 'ar1',
        kind: 'artist',
        moodCharacter: 'SteadyVibes',
        name: 'My mix',
        seedId: 'ar1',
        seedName: 'Slowdive',
    });
});

test('nothing is saved without a name or without the kind seed', () => {
    assert.equal(buildRecipe({ ...input, kind: 'yourMix', name: '   ' }), null);
    assert.equal(buildRecipe({ ...input, kind: 'radio', song: null }), null);
    assert.equal(buildRecipe({ ...input, genre: ' ', kind: 'genre' }), null);
    assert.equal(buildRecipe({ ...input, artists: [], kind: 'artist' }), null);
});

// --- What a stored recipe plays as ------------------------------------------------------------------

test('a Radio recipe: a track radio in its character; without the engine, as similar', () => {
    const radio = mix({ character: 'close', kind: 'station', seedId: 's1', seedName: 'X' });
    assert.deepEqual(mixPlan(radio, engine), {
        local: 'similar',
        station: { character: 'close', kind: 'track', songId: 's1' },
    });
    assert.deepEqual(mixPlan(radio, noEngine), { local: 'similar', station: null });
});

test('a Your mix recipe: Your mix in its character; without the engine, as fingerprint', () => {
    const yours = mix({ kind: 'station', moodCharacter: 'TransitionMaestro' });
    assert.deepEqual(mixPlan(yours, engine), {
        local: 'fingerprint',
        station: { character: 'explore', kind: 'yourMix' },
    });
    assert.deepEqual(mixPlan(yours, noEngine), { local: 'fingerprint', station: null });
});

test('an Artist recipe: an artist radio in its character; without the engine, artist radio', () => {
    const artist = mix({
        character: 'explore',
        kind: 'artist',
        seedId: 'ar1',
        seedName: 'Slowdive',
    });
    assert.deepEqual(mixPlan(artist, engine), {
        local: 'artist',
        station: {
            artistIds: ['ar1'],
            artistName: 'Slowdive',
            character: 'explore',
            kind: 'artist',
        },
    });
    assert.deepEqual(mixPlan(artist, noEngine), { local: 'artist', station: null });
    // An artist recipe from before stations has no character: Balanced, the hub's default.
    assert.equal(
        mixPlan(mix({ kind: 'artist', seedId: 'ar1' }), engine).station?.character,
        'balanced',
    );
});

test('a Genre recipe is never a station', () => {
    const genre = mix({ kind: 'genre', seedId: 'Shoegaze', seedName: 'Shoegaze' });
    assert.deepEqual(mixPlan(genre, engine), { local: 'genre', station: null });
    assert.deepEqual(mixPlan(genre, noEngine), { local: 'genre', station: null });
});

test('legacy similar: a track radio on Balanced whatever it stored; as itself without the engine', () => {
    const similar = mix({ character: 'explore', kind: 'similar', seedId: 's1' });
    assert.deepEqual(mixPlan(similar, engine), {
        local: 'similar',
        station: { character: 'balanced', kind: 'track', songId: 's1' },
    });
    assert.deepEqual(mixPlan(similar, noEngine), { local: 'similar', station: null });
});

test('legacy adaptive: Your mix in its own character; as itself without the engine', () => {
    const adaptive = mix({ kind: 'adaptive', moodCharacter: 'EchoMatch', seedId: 's1' });
    assert.deepEqual(mixPlan(adaptive, engine), {
        local: 'adaptive',
        station: { character: 'close', kind: 'yourMix' },
    });
    assert.deepEqual(mixPlan(adaptive, noEngine), { local: 'adaptive', station: null });
});

test('legacy fingerprint: Your mix in its character, else the preference; itself without the engine', () => {
    assert.deepEqual(mixPlan(mix({ character: 'close', kind: 'fingerprint' }), engine).station, {
        character: 'close',
        kind: 'yourMix',
    });
    assert.deepEqual(mixPlan(mix({ kind: 'fingerprint' }), engine).station, {
        character: 'explore',
        kind: 'yourMix',
    });
    assert.deepEqual(mixPlan(mix({ kind: 'fingerprint' }), noEngine), {
        local: 'fingerprint',
        station: null,
    });
});

test('a kind this build does not know plays nothing, with or without the engine', () => {
    assert.deepEqual(mixPlan(mix({ kind: 'moodboard', seedId: 's1' }), engine), {
        local: null,
        station: null,
    });
});

// --- A genre recipe's name ---------------------------------------------------------------------------

const genres = [
    { id: 'g-7f3a', name: 'Shoegaze' },
    { id: 'g-91bc', name: 'Dream Pop' },
];

test('a new genre recipe holds the name, and the name is what runs', () => {
    assert.equal(genreNameOf(mix({ seedId: 'Shoegaze', seedName: 'Shoegaze' })), 'Shoegaze');
    assert.equal(
        genreNameOf(mix({ seedId: 'Shoegaze', seedName: 'Shoegaze' }), genres),
        'Shoegaze',
    );
});

test('an old recipe holding an id: resolved through the genre list, else its stored name', () => {
    assert.equal(genreNameOf(mix({ seedId: 'g-91bc', seedName: '' }), genres), 'Dream Pop');
    assert.equal(genreNameOf(mix({ seedId: 'g-91bc', seedName: 'Dream Pop' })), 'Dream Pop');
    // The id wins over a stored name that went stale (the genre was renamed in the tags).
    assert.equal(genreNameOf(mix({ seedId: 'g-91bc', seedName: 'Dreampop' }), genres), 'Dream Pop');
});

test('an id nothing resolves and no name: the id as given; nothing at all: empty', () => {
    assert.equal(genreNameOf(mix({ seedId: 'g-0000', seedName: '' }), genres), 'g-0000');
    assert.equal(genreNameOf(mix({ seedId: '', seedName: '' }), genres), '');
});

// --- The pickers: no list until typed ----------------------------------------------------------------

test('no term while the box is empty or blank', () => {
    assert.equal(pickerTerm(''), '');
    assert.equal(pickerTerm('   '), '');
    assert.equal(pickerTerm('', 'Slowdive'), '');
});

test('no term while the box still shows the pick; one as soon as it is edited', () => {
    assert.equal(pickerTerm('Slowdive', 'Slowdive'), '');
    assert.equal(pickerTerm('Slowdiv', 'Slowdive'), 'Slowdiv');
    assert.equal(pickerTerm(' slo ', null), 'slo');
});

test('no options without a term, whatever the last search answered', () => {
    const results = Array.from({ length: 30 }, (_, index) => `artist ${index}`);
    assert.deepEqual(pickerOptions('', results), []);
    assert.equal(pickerOptions('a', results).length, PICKER_LIMIT);
    assert.deepEqual(pickerOptions('a', results.slice(0, 3)), results.slice(0, 3));
});

test('genres: none until typed; exact, then prefix, then contains; each once; capped', () => {
    const list = [
        { name: 'Alternative Rock' },
        { name: 'Rock' },
        { name: 'Rockabilly' },
        { name: 'Hard Rock' },
        { name: 'rock' },
        { name: 'Jazz' },
        { name: 'Rock' },
    ];
    assert.deepEqual(matchGenres('', list), []);
    assert.deepEqual(matchGenres('ROCK', list), [
        'Rock',
        'rock',
        'Rockabilly',
        'Alternative Rock',
        'Hard Rock',
    ]);
    const many = Array.from({ length: 60 }, (_, index) => ({ name: `Genre ${index}` }));
    assert.equal(matchGenres('genre', many).length, PICKER_LIMIT);
});

test('the artist dropdown: nothing without a term; searching, then what the server answered', () => {
    const state = { error: false, results: 0, settled: true, term: '' };
    assert.equal(artistPickerEmpty(state), null);
    assert.equal(artistPickerEmpty({ ...state, results: 3, term: 'ogre' }), null);
    assert.equal(artistPickerEmpty({ ...state, settled: false, term: 'ogre' }), 'Searching...');
    assert.equal(artistPickerEmpty({ ...state, term: 'zzqxv' }), 'No artist matches');
    assert.equal(
        artistPickerEmpty({ ...state, error: true, term: 'ogre' }),
        'The search did not answer',
    );
    // Navidrome answers a one-letter search with nothing, whatever the library holds.
    assert.equal(artistPickerEmpty({ ...state, term: 'a' }), 'Keep typing...');
});

// --- The row's words (B-149, Worbus for Android's `mixKindLabel`) ----------------------------------------------

const words = (id: string) => ({ balanced: 'Balanced', close: 'Close', explore: 'Explore' })[id]!;

test('the Your mix entry: built from what you play most, in the character autoplay uses', () => {
    assert.equal(yourMixLine('Explore'), 'Built from what you play most · Explore');
});

test('an Artist row names its character as a Radio row does; one that stores none, none', () => {
    const artist = mix({ kind: 'artist', seedId: 'ar_1', seedName: 'Ogre You Asshole' });
    assert.equal(
        mixLine({ ...artist, character: 'close', moodCharacter: 'EchoMatch' }, words),
        'Artist from Ogre You Asshole · Close',
    );
    // From a client that wrote only the legacy name.
    assert.equal(
        mixLine({ ...artist, moodCharacter: 'TransitionMaestro' }, words),
        'Artist from Ogre You Asshole · Explore',
    );
    assert.equal(mixLine(artist, words), 'Artist from Ogre You Asshole');
    assert.equal(
        mixLine(mix({ character: 'explore', seedId: 'tr_1', seedName: 'Cinnamon Girl' }), words),
        'Radio from Cinnamon Girl · Explore',
    );
    // A radio that stores none plays, and says, Balanced.
    assert.equal(
        mixLine(mix({ seedId: 'tr_1', seedName: 'Cinnamon Girl' }), words),
        'Radio from Cinnamon Girl · Balanced',
    );
    assert.equal(mixLine(mix({ character: 'close' }), words), 'Your mix · Close');
    assert.equal(mixLine(mix({ kind: 'journey' }), words), null);
});

test('a stored character: an id, a legacy name or an old preset id, else none', () => {
    assert.equal(storedCharacter({ character: 'explore', moodCharacter: '' }), 'explore');
    assert.equal(storedCharacter({ character: '', moodCharacter: 'SteadyVibes' }), 'balanced');
    assert.equal(storedCharacter({ character: '', moodCharacter: 'echo' }), 'close');
    assert.equal(
        storedCharacter({ character: 'nonsense', moodCharacter: 'transition' }),
        'explore',
    );
    assert.equal(storedCharacter({ character: '', moodCharacter: '' }), null);
    assert.equal(storedCharacter({ character: 'nonsense', moodCharacter: '' }), null);
});

test('rows read as Worbus for Android words them: legacy kinds that play as Your mix are Your mix', () => {
    const words = (id: string) =>
        ({ balanced: 'Balanced', close: 'Close', explore: 'Explore' })[id] ?? id;
    assert.equal(
        mixLine(
            {
                kind: 'adaptive',
                moodCharacter: 'TransitionMaestro',
                seedId: '',
                seedName: '',
            } as never,
            words as never,
        ),
        'Your mix · Explore',
    );
    assert.equal(
        mixLine({ kind: 'fingerprint', seedId: '', seedName: '' } as never, words as never),
        'Your mix',
    );
    assert.equal(
        mixLine({ kind: 'genre', seedId: 'Rock', seedName: 'Rock' } as never, words as never),
        'Genre from Rock',
    );
    assert.equal(
        mixLine(
            { kind: 'similar', seedId: 's1', seedName: 'Video Games' } as never,
            words as never,
        ),
        'Similar songs from Video Games',
    );
});

// --- A custom radio (P5) --------------------------------------------------------------------------

test('Artist with several artists: a custom radio, every id in seedIds, the first in seedId', () => {
    const artists = [
        { id: 'ar1', name: 'Moth Season' },
        { id: 'ar2', name: 'Ida Verrall' },
        { id: 'ar1', name: 'Moth Season' },
        { id: 'ar3', name: 'Hollow Orchard' },
    ];
    assert.deepEqual(
        buildRecipe({ ...input, artists, character: 'explore', kind: 'artist', variety: 'high' }),
        {
            character: 'explore',
            count: 50,
            coverArtId: 'ar1',
            kind: 'artist',
            moodCharacter: 'TransitionMaestro',
            name: 'My mix',
            seedId: 'ar1',
            seedIds: ['ar1', 'ar2', 'ar3'],
            seedName: 'Moth Season',
            variety: 'high',
        },
    );
    // Medium is the character's own spacing, which an absent value means: not written.
    assert.equal(
        buildRecipe({ ...input, artists, kind: 'artist', variety: 'medium' })?.variety,
        undefined,
    );
    // At most eight.
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    assert.equal(buildRecipe({ ...input, artists: ten, kind: 'artist' })?.seedIds?.length, 8);
});

test('a custom radio plays every artist, with its variety, under its own name', () => {
    const custom = mix({
        character: 'balanced',
        kind: 'artist',
        name: 'Moth Season, Ida Verrall',
        seedId: 'ar1',
        seedIds: ['ar1', 'ar2'],
        seedName: 'Moth Season',
        variety: 'low',
    });
    assert.deepEqual(mixPlan(custom, engine), {
        local: 'artist',
        station: {
            artistIds: ['ar1', 'ar2'],
            artistName: 'Moth Season, Ida Verrall',
            character: 'balanced',
            kind: 'artist',
            variety: 'low',
        },
    });
    // A variety this build does not know is not sent.
    assert.equal(mixPlan({ ...custom, variety: 'wild' }, engine).station?.kind, 'artist');
    assert.equal(
        (mixPlan({ ...custom, variety: 'wild' }, engine).station as { variety?: string }).variety,
        undefined,
    );
});

test('a recipe from Worbus for Android round-trips; one without seedIds is the artist radio it always was', () => {
    assert.deepEqual(mixArtistIds(mix({ kind: 'artist', seedId: 'ar1' })), ['ar1']);
    assert.deepEqual(
        mixArtistIds(mix({ kind: 'artist', seedId: 'ar1', seedIds: ['ar1', 'ar2', 'ar2'] })),
        ['ar1', 'ar2'],
    );
    assert.equal(isCustomRadio(mix({ kind: 'artist', seedIds: ['ar1', 'ar2'] })), true);
    assert.equal(isCustomRadio(mix({ kind: 'artist', seedIds: ['ar1'] })), false);
    assert.equal(isCustomRadio(mix({ kind: 'station', seedIds: ['ar1', 'ar2'] })), false);
});

test('a custom radio row says Custom radio and its character', () => {
    const words = (id: string) =>
        ({ balanced: 'Blend', close: 'Familiar', explore: 'Discover' })[id]!;
    assert.equal(
        mixLine(
            mix({ character: 'close', kind: 'artist', seedIds: ['a', 'b'], seedName: 'A' }),
            words,
        ),
        'Custom radio · Familiar',
    );
    assert.equal(
        mixLine(mix({ character: 'close', kind: 'artist', seedId: 'a', seedName: 'A' }), words),
        'Artist from A · Familiar',
    );
});

test('radioTitle joins the names in pick order', () => {
    assert.equal(radioTitle(['Moth Season']), 'Moth Season');
    assert.equal(radioTitle(['Moth Season', ' Ida Verrall ', '']), 'Moth Season, Ida Verrall');
    assert.equal(radioTitle([]), '');
});
