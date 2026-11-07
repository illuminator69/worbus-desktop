import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlayingFromInput } from './playing-from.ts';

import { playingFrom, playingFromLine } from './playing-from.ts';

/**
 * node --test --test-reporter=tap src/renderer/features/now-playing/utils/playing-from.harness.ts
 *
 * What the side queue's header says the queue is playing from: the title, the kind, the
 * autoplay state and, while another device plays, that device. No English: the component
 * builds the sentences.
 */

const input = (over: Partial<PlayingFromInput> = {}): PlayingFromInput => ({
    autoplay: true,
    device: null,
    engine: true,
    kind: 'album',
    name: null,
    sourceName: 'Lantern Season',
    stationName: null,
    stationState: 'absent',
    ...over,
});

test('anAlbumQueueWithTheStationBoundContinues', () => {
    const out = playingFrom(input({ stationName: 'Lantern Season radio', stationState: 'bound' }));
    assert.deepEqual(out, {
        device: null,
        kind: 'album',
        state: 'continues',
        title: 'Lantern Season',
    });
});

test('aRadioShowsItsOwnNameAndRuns', () => {
    const out = playingFrom(
        input({
            kind: 'radio',
            sourceName: null,
            stationName: 'Hollow Orchard radio',
            stationState: 'bound',
        }),
    );
    assert.equal(out.kind, 'radio');
    assert.equal(out.title, 'Hollow Orchard radio');
    assert.equal(out.state, 'running');
});

test('aRadioPrefersTheStationNameOverTheSeedName', () => {
    const out = playingFrom(
        input({
            kind: 'radio',
            sourceName: 'Hollow Orchard',
            stationName: 'Hollow Orchard radio',
            stationState: 'bound',
        }),
    );
    assert.equal(out.title, 'Hollow Orchard radio');
});

test('aRadioWithoutAStationNameUsesTheSourceName', () => {
    const out = playingFrom(
        input({ kind: 'radio', sourceName: 'Hollow Orchard', stationName: null }),
    );
    assert.equal(out.title, 'Hollow Orchard');
});

test('aStoppedStationIsStopped', () => {
    const out = playingFrom(
        input({
            autoplay: false,
            kind: 'radio',
            stationName: 'Hollow Orchard radio',
            stationState: 'stopped',
        }),
    );
    assert.equal(out.state, 'stopped');
    assert.equal(out.title, 'Hollow Orchard radio');
});

test('aUserNameBeatsTheSourceName', () => {
    assert.equal(playingFrom(input({ name: 'Sunday morning' })).title, 'Sunday morning');
    assert.equal(
        playingFrom(
            input({
                kind: 'radio',
                name: 'My radio',
                stationName: 'Hollow Orchard radio',
            }),
        ).title,
        'My radio',
    );
});

test('aManualQueueWithANameKeepsIt', () => {
    const out = playingFrom(input({ kind: 'manual', name: 'Search: hollow', sourceName: null }));
    assert.equal(out.title, 'Search: hollow');
    assert.equal(out.kind, null);
});

test('aManualQueueWithNoNameSaysNothing', () => {
    const out = playingFrom(input({ kind: 'manual', name: null, sourceName: null }));
    assert.equal(out.title, null);
    assert.equal(playingFrom(input({ kind: 'manual', name: '  ', sourceName: null })).title, null);
    assert.equal(playingFrom(input({ kind: null, name: null, sourceName: null })).title, null);
});

test('anUnknownKindKeepsTheTitle', () => {
    const out = playingFrom(input({ kind: 'somethingNew', sourceName: 'Odd source' }));
    assert.equal(out.kind, null);
    assert.equal(out.title, 'Odd source');
});

test('withoutTheEngineItIsAutoDjOrOff', () => {
    assert.equal(playingFrom(input({ autoplay: true, engine: false })).state, 'autoDj');
    assert.equal(playingFrom(input({ autoplay: false, engine: false })).state, 'off');
    assert.equal(
        playingFrom(input({ autoplay: true, engine: false, stationState: 'stopped' })).state,
        'autoDj',
    );
});

test('noStationAndAutoplayOnContinues', () => {
    assert.equal(playingFrom(input({ autoplay: true, stationState: 'absent' })).state, 'continues');
});

test('noStationAndAutoplayOffIsOff', () => {
    assert.equal(playingFrom(input({ autoplay: false, stationState: 'absent' })).state, 'off');
});

test('aRemoteSessionCarriesTheDeviceName', () => {
    const out = playingFrom(
        input({ device: 'Pixel 8', name: 'Wren Songs', stationState: 'bound' }),
    );
    assert.equal(out.device, 'Pixel 8');
    assert.equal(out.title, 'Wren Songs');
});

test('theHeaderCarriesNoCharacter', () => {
    // R15 review M2: the line under the title no longer names the character (the characters row
    // does), so nothing reads it from here.
    assert.equal('character' in playingFrom(input()), false);
});

/*
 * The line under the title (B-251 follow-up): what the queue IS, never the autoplay state. The
 * Autoplay switch beside the title says on / off, so toggling it must not add or remove the line.
 */

const KIND_CASES: ReadonlyArray<null | string> = [
    null,
    'album',
    'journey',
    'manual',
    'moodFlow',
    'playlist',
    'radio',
];

const AUTOPLAY_CASES: ReadonlyArray<Partial<PlayingFromInput>> = [
    { autoplay: false, engine: true, stationState: 'absent' },
    { autoplay: true, engine: true, stationState: 'absent' },
    { autoplay: true, engine: true, stationState: 'bound' },
    { autoplay: false, engine: true, stationState: 'stopped' },
    { autoplay: true, engine: false, stationState: 'absent' },
    { autoplay: false, engine: false, stationState: 'absent' },
];

test('noKindHasNoSentence', () => {
    for (const over of AUTOPLAY_CASES) {
        const from = playingFrom(input({ ...over, kind: null, name: 'R8 scratch queue' }));
        assert.equal(playingFromLine(from), null, JSON.stringify(over));
    }
});

test('autoplayDoesNotChangeTheSentence', () => {
    for (const kind of KIND_CASES) {
        for (const device of [null, 'Pixel 8']) {
            const lines = AUTOPLAY_CASES.map((over) =>
                playingFromLine(playingFrom(input({ ...over, device, kind }))),
            );
            for (const line of lines) assert.deepEqual(line, lines[0], `${kind} ${device}`);
        }
    }
});

test('aKindNamesTheKind', () => {
    assert.deepEqual(playingFromLine(playingFrom(input({ kind: 'album' }))), { kind: 'album' });
    assert.deepEqual(playingFromLine(playingFrom(input({ kind: 'radio' }))), { kind: 'radio' });
    assert.equal(playingFromLine(playingFrom(input({ kind: 'manual' }))), null);
});

test('deviceQueueNamesTheDevice', () => {
    for (const kind of KIND_CASES) {
        assert.deepEqual(playingFromLine(playingFrom(input({ device: 'Pixel 8', kind }))), {
            device: 'Pixel 8',
        });
    }
});
