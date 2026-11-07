import assert from 'node:assert/strict';
import test from 'node:test';

import type { MoodCatalogue, MoodEntry } from '../../../shared/types/mood-types.ts';

import {
    arrangeMix,
    candidateOrder,
    chipsVisible,
    type DrawSong,
    findMood,
    homeMoods,
    mixState,
    MOOD_ARTIST_GAP,
    moodsShown,
    queuesFromMood,
    tileColors,
    tilePlayResult,
    toggleMood,
    withinLength,
} from './mood-mix.ts';

/**
 * F5:  node --test src/renderer/features/moods/mood-mix.harness.ts
 *
 * The rules of a Home mood mix (spec/mood-contract.md): which moods are chips, the draw, the
 * artist spacing, the states, the saved queues a mood's tiles made, and the tiles' colours.
 */

const mood = (id: string, group: 'extra' | 'home', variants = 4): MoodEntry => ({
    depth: 300,
    filter: false,
    group,
    id,
    label: id,
    maxSeconds: 480,
    variants: Array.from({ length: variants }, (_, i) => ({
        hue: [i * 30, i * 30 + 40] as [number, number],
        id: `v${i}`,
        title: `${id} ${i}`,
    })),
});

const catalogue = (moods: MoodEntry[], available = true): MoodCatalogue => ({
    available,
    configured: true,
    moods,
    ready: true,
    version: 'v',
});

// A small seeded generator (mulberry32), so a draw is repeatable in the harness.
const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('homeMoodsKeepTheHubsOrderAndDropExtra', () => {
    const c = catalogue([
        mood('relax', 'home'),
        mood('pump-up', 'extra', 0),
        mood('sleep', 'home'),
    ]);
    assert.deepEqual(
        homeMoods(c).map((m) => m.id),
        ['relax', 'sleep'],
    );
    assert.equal(findMood(c, 'sleep')?.id, 'sleep');
    assert.equal(findMood(c, 'nope'), undefined);
});

test('chipsVisible', () => {
    assert.equal(chipsVisible(catalogue([mood('relax', 'home')])), true);
    assert.equal(chipsVisible(catalogue([mood('relax', 'home')], false)), false);
    assert.equal(chipsVisible(catalogue([mood('pump-up', 'extra', 0)])), false);
    assert.equal(chipsVisible(null), false);
});

test('toggleMood', () => {
    assert.equal(toggleMood('relax', 'relax'), null);
    assert.equal(toggleMood('relax', 'sleep'), 'sleep');
    assert.equal(toggleMood(null, 'sleep'), 'sleep');
});

test('candidateOrder', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `song-${i}`);
    const a = candidateOrder([...ids, 'song-3'], 300, seeded(1));
    assert.ok(a.length <= 300);
    assert.equal(new Set(a).size, a.length);
    const first = new Set(ids.slice(0, 300));
    assert.ok(a.every((id) => first.has(id)));
    assert.deepEqual(candidateOrder(ids, 300, seeded(1)), a);
    const b = candidateOrder(ids, 300, seeded(2));
    const differ = a.slice(0, 50).filter((id, i) => b[i] !== id).length;
    assert.ok(differ >= 20, `only ${differ} of 50 positions differ`);
    assert.deepEqual(candidateOrder(['x', 'x', 'y'], 300, seeded(3)).sort(), ['x', 'y']);
});

test('withinLength', () => {
    const song = (durationSec: number): DrawSong => ({ artistKey: 'a', durationSec, id: 's' });
    assert.equal(withinLength(song(481), 480), false);
    assert.equal(withinLength(song(480), 480), true);
    assert.equal(withinLength(song(1200), null), true);
});

const pool = (n: number, artists: number): DrawSong[] =>
    Array.from({ length: n }, (_, i) => ({
        artistKey: `artist-${i % artists}`,
        durationSec: 200,
        id: `s${i}`,
    }));

const spacingHolds = (songs: DrawSong[], gap: number) =>
    songs.every((s, i) =>
        songs.slice(Math.max(0, i - gap + 1), i).every((p) => p.artistKey !== s.artistKey),
    );

test('arrangeMixSpacesArtists', () => {
    // Clumped input: all of one artist's songs together.
    const clumped = pool(60, 12).sort((x, y) => x.artistKey.localeCompare(y.artistKey));
    const mix = arrangeMix(clumped);
    assert.equal(mix.length, 50);
    assert.equal(new Set(mix.map((s) => s.id)).size, 50);
    assert.ok(spacingHolds(mix, MOOD_ARTIST_GAP), mix.map((s) => s.artistKey).join(','));
});

test('arrangeMixNeverPads', () => {
    assert.equal(arrangeMix(pool(30, 6)).length, 30);
});

test('arrangeMixWithOneArtistStillReturnsSongs', () => {
    assert.equal(arrangeMix(pool(10, 1)).length, 10);
});

test('mixState', () => {
    const songs = (n: number) => pool(n, 5);
    assert.equal(mixState({ drawn: songs(30), failed: true }), 'unavailable');
    assert.equal(mixState({ drawn: null, failed: false }), 'loading');
    assert.equal(mixState({ drawn: [], failed: false }), 'empty');
    assert.equal(mixState({ drawn: songs(1), failed: false }), 'short');
    assert.equal(mixState({ drawn: songs(19), failed: false }), 'short');
    assert.equal(mixState({ drawn: songs(20), failed: false }), 'ready');
});

test('queuesFromMood', () => {
    const q = (
        id: string,
        sourceKind: string,
        sourceName: string | undefined,
        updatedAt: number,
        name?: string,
    ) => ({
        id,
        name,
        sourceKind,
        sourceName,
        updatedAt,
    });
    const queues = [
        q('old', 'radio', 'Soul', 1),
        q('new', 'radio', 'Mellow beats', 5),
        q('renamed', 'radio', 'Soul', 9, 'My soul queue'),
        q('playlist', 'playlist', 'Soul', 8),
        q('other', 'radio', 'Something else', 7),
        q('mid', 'radio', 'Soul', 3),
    ];
    assert.deepEqual(
        queuesFromMood(queues, ['Soul', 'Mellow beats']).map((x) => x.id),
        ['new', 'mid', 'old'],
    );
    assert.deepEqual(
        queuesFromMood(queues, ['Soul', 'Mellow beats'], 2).map((x) => x.id),
        ['new', 'mid'],
    );
});

// ---- tileColors: white text on both ends of the gradient, computed here from the HSL returned ----

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
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

test('tileColorsGiveWhiteTextAtLeast4.5OnBothEnds', () => {
    let worst = { at: '', ratio: Infinity };
    // The light end starts at 44 and the dark end at 24 (the board's): which hues had to go darker.
    const lightEndBelow35 = new Set<number>();
    const darkEndBelow24 = new Set<number>();
    for (let a = 0; a < 360; a += 5) {
        for (const b of [0, 90, 180, 270]) {
            const { from, to } = tileColors({ hue: [a, b], id: 'x', title: 'X' });
            if (from.l < 35) lightEndBelow35.add(from.h);
            if (to.l < 24) darkEndBelow24.add(to.h);
            // The tile paints one stripe (hsl(B 80% 70%) at .14) over both ends; the plan's wording
            // blends each end with the other end's hue: both hues are checked on both ends.
            for (const end of [from, to]) {
                const base = hslToRgb(end.h, end.s, end.l);
                for (const stripe of [from.h, to.h]) {
                    for (const bg of [base, blend(hslToRgb(stripe, 80, 70), 0.14, base)]) {
                        for (const text of [WHITE, blend(WHITE, 0.88, bg)]) {
                            const r = contrast(text, bg);
                            if (r < worst.ratio)
                                worst = {
                                    at: `hue ${a} -> ${b}, end h${end.h} s${end.s} l${end.l}`,
                                    ratio: r,
                                };
                        }
                    }
                }
            }
        }
    }
    console.log(`worst ${worst.ratio.toFixed(2)} at ${worst.at}`);
    const list = (set: Set<number>) => [...set].sort((x, y) => x - y).join(' ') || 'none';
    console.log(`the light end (44) below 35 at hues: ${list(lightEndBelow35)}`);
    console.log(`the dark end (24) below 24 at hues: ${list(darkEndBelow24)}`);
    assert.ok(worst.ratio >= 4.5, `worst ${worst.ratio.toFixed(2)} at ${worst.at}`);
});

test('tileColorsAreStable', () => {
    assert.deepEqual(
        tileColors({ hue: [32, 12], id: 'acoustic', title: 'Acoustic evenings' }),
        tileColors({ hue: [32, 12], id: 'soul', title: 'Soul' }),
    );
    const a = tileColors({ hue: [], id: 'acoustic', title: 'Acoustic evenings' });
    assert.deepEqual(tileColors({ hue: [], id: 'acoustic', title: 'Acoustic evenings' }), a);
    assert.notDeepEqual(tileColors({ hue: [], id: 'indie', title: 'Laid-back indie' }), a);
});

// Review fix: the tile's play button never plays a short mix silently under "About 50 songs".
test('tilePlayResult', () => {
    assert.deepEqual(tilePlayResult('ready'), { notice: 'none', play: true });
    assert.deepEqual(tilePlayResult('short'), { notice: 'short', play: true });
    assert.deepEqual(tilePlayResult('empty'), { notice: 'empty', play: false });
    assert.deepEqual(tilePlayResult('unavailable'), { notice: 'unavailable', play: false });
});

// Review fix: a hub switched off or never configured shows no moods, stored copy or not.
test('moodsShown', () => {
    const hub = { enabled: true, token: 'tok', url: 'ws://hub:4790' };
    assert.equal(moodsShown({ electron: true, hub, serverType: 'navidrome' }), true);
    assert.equal(
        moodsShown({ electron: true, hub: { ...hub, token: '' }, serverType: 'navidrome' }),
        false,
    );
    assert.equal(
        moodsShown({ electron: true, hub: { ...hub, url: '' }, serverType: 'navidrome' }),
        false,
    );
    assert.equal(
        moodsShown({ electron: true, hub: { ...hub, enabled: false }, serverType: 'navidrome' }),
        false,
    );
    assert.equal(moodsShown({ electron: true, hub, serverType: 'jellyfin' }), false);
    assert.equal(moodsShown({ electron: false, hub, serverType: 'navidrome' }), false);
    assert.equal(moodsShown({ electron: true, hub, serverType: undefined }), false);
});
