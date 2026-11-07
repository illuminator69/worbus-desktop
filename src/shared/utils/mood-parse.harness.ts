import assert from 'node:assert/strict';
import test from 'node:test';

import {
    moodOutcome,
    parseMoodCatalogue,
    parseMoodList,
    parseStoredMoodCatalogue,
} from './mood-parse.ts';

/**
 * F5:  node --test src/shared/utils/mood-parse.harness.ts
 *
 * The hub's mood catalogue and lists, read defensively: whatever the hub sends, the app gets a
 * well-formed catalogue or null.
 */

const variant = (id: string, title: string, hue: unknown) => ({ hue, id, title });

const full = {
    available: true,
    configured: true,
    moods: [
        {
            depth: 300,
            filter: true,
            group: 'home',
            id: 'relax',
            label: 'Relax',
            maxSeconds: 480,
            variants: [
                variant('acoustic', 'Acoustic evenings', [32, 12]),
                variant('indie', 'Laid-back indie', [140, 175]),
            ],
        },
        {
            depth: 300,
            filter: true,
            group: 'extra',
            id: 'pump-up',
            label: 'Pump-up',
            maxSeconds: null,
            variants: [],
        },
    ],
    ready: true,
    version: '2026-10-20',
};

test('aFullCatalogueParses', () => {
    assert.deepEqual(parseMoodCatalogue(full), {
        available: true,
        configured: true,
        moods: [
            {
                depth: 300,
                filter: true,
                group: 'home',
                id: 'relax',
                label: 'Relax',
                maxSeconds: 480,
                variants: [
                    { hue: [32, 12], id: 'acoustic', title: 'Acoustic evenings' },
                    { hue: [140, 175], id: 'indie', title: 'Laid-back indie' },
                ],
            },
            {
                depth: 300,
                filter: true,
                group: 'extra',
                id: 'pump-up',
                label: 'Pump-up',
                maxSeconds: null,
                variants: [],
            },
        ],
        ready: true,
        version: '2026-10-20',
    });
});

test('unknownFieldsAreIgnored', () => {
    const parsed = parseMoodCatalogue({
        ...full,
        extra: 1,
        moods: [{ ...full.moods[0], colour: 'red' }],
    });
    assert.ok(parsed);
    assert.equal('extra' in parsed, false);
    assert.equal('colour' in parsed.moods[0], false);
});

test('aMissingMoodsIsAnEmptyList', () => {
    const parsed = parseMoodCatalogue({
        available: true,
        configured: true,
        ready: false,
        version: 'v',
    });
    assert.deepEqual(parsed?.moods, []);
});

test('notAnObjectIsNull', () => {
    assert.equal(parseMoodCatalogue(null), null);
    assert.equal(parseMoodCatalogue('catalogue'), null);
    assert.equal(parseMoodCatalogue([1, 2]), null);
});

test('aMissingOrMalformedHueIsEmpty', () => {
    const parsed = parseMoodCatalogue({
        ...full,
        moods: [
            {
                ...full.moods[0],
                variants: [
                    { id: 'a', title: 'A' },
                    variant('b', 'B', [10]),
                    variant('c', 'C', ['10', 20]),
                    variant('d', 'D', [400, 20]),
                    variant('e', 'E', [350, 20]),
                ],
            },
        ],
    });
    assert.deepEqual(
        parsed?.moods[0].variants.map((v) => v.hue),
        [[], [], [], [], [350, 20]],
    );
});

test('nonStringIdsAreDropped', () => {
    const parsed = parseMoodCatalogue({
        ...full,
        moods: [
            {
                ...full.moods[0],
                variants: [
                    variant(7 as unknown as string, 'Seven', [1, 2]),
                    variant('ok', 'Ok', [1, 2]),
                ],
            },
            { ...full.moods[1], id: 42 },
        ],
    });
    assert.deepEqual(
        parsed?.moods.map((m) => m.id),
        ['relax'],
    );
    assert.deepEqual(
        parsed?.moods[0].variants.map((v) => v.id),
        ['ok'],
    );
});

test('aList', () => {
    assert.deepEqual(
        parseMoodList({
            depth: 300,
            ids: ['song-1', 2, 'song-3', null],
            mood: 'relax',
            variant: 'acoustic',
            version: 'v',
        }),
        { depth: 300, ids: ['song-1', 'song-3'], mood: 'relax', variant: 'acoustic', version: 'v' },
    );
    assert.equal(
        parseMoodList({ depth: 300, ids: 'song-1', mood: 'relax', variant: 'acoustic' }),
        null,
    );
    assert.equal(parseMoodList(null), null);
});

test('outcomes', () => {
    assert.equal(moodOutcome(200), 'ok');
    assert.equal(moodOutcome(404), 'absent');
    assert.equal(moodOutcome(404, 'mood_unknown'), 'unknown');
    assert.equal(moodOutcome(404, 'variant_unknown'), 'unknown');
    assert.equal(moodOutcome(503), 'unavailable');
    assert.equal(moodOutcome(0), 'unavailable');
    assert.equal(moodOutcome(500), 'unavailable');
});

// Review fix: the stored copy is read through the same parse, so a bad value can never break Home.
test('aStoredCopyIsParsed', () => {
    assert.equal(parseStoredMoodCatalogue(null), undefined);
    assert.equal(parseStoredMoodCatalogue('not json'), undefined);
    assert.equal(parseStoredMoodCatalogue('[1, 2]'), undefined);
    assert.deepEqual(parseStoredMoodCatalogue('{"available": true}')?.moods, []);
    assert.deepEqual(parseStoredMoodCatalogue(JSON.stringify(full)), parseMoodCatalogue(full));
});
