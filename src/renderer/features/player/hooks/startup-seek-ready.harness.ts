import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as startupSeekModule from './startup-seek.ts';

/**
 * B-349 (Phase B):
 *   node --test src/renderer/features/player/hooks/startup-seek-ready.harness.ts
 *
 * At a fresh start the resumed song played from 0 s for about 90 ms, and the hub read one ~0 s
 * report, because the resume position was applied as a seek 100 ms after the first PLAYING
 * (use-queue-restore's applyStartupSeek). The position has to be on the element before play():
 * the web player's element is up and paused when it reports ready, and a seek then lands before
 * anything is heard. A model of the element: `position` is where play() would start.
 */

const { createStartupSeek } = startupSeekModule;
const hooks = startupSeekModule as unknown as {
    onWebEngineReady?: (listener: (() => void) | null) => void;
    webEngineReady?: () => void;
};

const CLOSED_SEC = 80.2;
const HUB_SEC = 86.683;

const model = () => {
    const seek = createStartupSeek();
    const engine = { position: 0, ready: false };
    const startedAt: number[] = [];
    const engineSeek = (sec: number) => {
        if (engine.ready) engine.position = sec;
    };
    // use-queue-restore's registration: the element of the current song reported ready.
    hooks.onWebEngineReady?.(() => {
        const at = seek.takeOnPlaying('u3');
        if (at !== null) engineSeek(at);
    });
    const ready = () => {
        engine.ready = true;
        hooks.webEngineReady?.();
    };
    // First PLAYING: play() starts at the element's position; then the late seek (today's path).
    const playing = () => {
        startedAt.push(engine.position);
        const at = seek.takeOnPlaying('u3');
        if (at !== null) engineSeek(at);
    };
    return { engine, playing, ready, seek, startedAt };
};

test('the_resume_position_is_on_the_element_before_play', () => {
    const m = model();
    m.seek.arm(CLOSED_SEC, 'u3');
    m.ready();
    m.playing();
    assert.deepEqual(m.startedAt, [CLOSED_SEC], 'play() started at 0 s, the seek came after it');
});

test('a_hub_retarget_before_the_mount_is_on_the_element_before_play', () => {
    const m = model();
    m.seek.arm(CLOSED_SEC, 'u3');
    m.seek.retarget(HUB_SEC, 'u3');
    m.ready();
    m.playing();
    assert.deepEqual(m.startedAt, [HUB_SEC]);
});

test('ready_before_the_restore_leaves_the_first_play_to_carry_it', () => {
    // The element came up before the persisted queue hydrated: nothing to apply yet, and the
    // startup seek stays open for the first PLAYING, as before.
    const m = model();
    m.ready();
    m.seek.arm(CLOSED_SEC, 'u3');
    m.playing();
    assert.equal(m.engine.position, CLOSED_SEC);
    hooks.onWebEngineReady?.(null);
});

test('wired_engine_ready_and_restore', () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    const engine = read('../audio-player/engine/web-player-engine.tsx');
    assert.match(engine, /onCurrentReady\?\.\(\)/, 'the web engine says when its element is ready');
    const restore = read('./use-queue-restore.ts');
    assert.match(restore, /onWebEngineReady\(/, 'use-queue-restore applies the seek at ready');
});

test('only_the_main_web_player_signals_ready', () => {
    // Review minor (fix round 2026-11-12): the radio player renders the same WebPlayerEngine, so a
    // station played first at a fresh start reported ready too; the listener then used up the
    // queue's startup seek on an engine that was not mounted, and the queue later started at 0 s.
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    const engine = read('../audio-player/engine/web-player-engine.tsx');
    assert.doesNotMatch(
        engine,
        /webEngineReady\(\)/,
        'every WebPlayerEngine signals the startup seek, the radio one included',
    );
    assert.match(engine, /onCurrentReady\?\.\(\)/);
    assert.match(
        read('../audio-player/web-player.tsx'),
        /onCurrentReady=\{webEngineReady\}/,
        "the main player does not pass the queue's ready signal",
    );
    assert.doesNotMatch(read('../../radio/components/radio-web-player.tsx'), /onCurrentReady/);
});

/**
 * B-402 (owner walk, 2026-11-13): a transfer from the phone to a freshly opened desktop restarted
 * the song at 0:00. The transfer's load calls mediaPlay() at once, so its first PLAYING is the
 * store's, before the web element has reported ready: the startup seek (retargeted to the hub's
 * position by B-339) is taken on that PLAYING and sent 100 ms later, and a load to another row
 * sends its landing seek 150 ms after the song change. Before the element is up the web player's
 * seek goes to a null ref (react-player not loaded) and is lost; the element then plays from 0 s.
 * B-339's and B-349's models had the first PLAYING come from a person pressing play on an element
 * already up. A seek the element cannot take yet is held for its ready, on its own source.
 */
type HeldSeek = {
    ready: (readySrc: string, currentSrc: string, seek: (sec: number) => void) => void;
    send: (sec: number, engineUp: boolean, seek: (sec: number) => void) => void;
};
const held = startupSeekModule as unknown as { createHeldSeek?: () => HeldSeek };

const freshDesktop = () => {
    const seek = createStartupSeek();
    const hold = held.createHeldSeek?.();
    const engine = { position: 0, ready: false, src: 'song-a' };
    const toElement = (sec: number) => {
        engine.position = sec;
    };
    // web-player.tsx onPlayerSeekToTimestamp: today, a seek before the element is up is lost.
    const engineSeek = (sec: number) => {
        if (hold) hold.send(sec, engine.ready, toElement);
        else if (engine.ready) toElement(sec);
    };
    hooks.onWebEngineReady?.(() => {
        const at = seek.takeOnPlaying('u3');
        if (at !== null) engineSeek(at);
    });
    // The element of `src` reports ready (canplay); `current` is the source the current song plays.
    const ready = (src = engine.src, current = engine.src) => {
        engine.ready = true;
        hold?.ready(src, current, toElement);
        if (src === current) hooks.webEngineReady?.();
    };
    // The store's PLAYING (use-queue-restore's applyStartupSeek, its 100 ms timer folded in).
    const playing = () => {
        const at = seek.takeOnPlaying('u3');
        if (at !== null) engineSeek(at);
    };
    return { engine, engineSeek, playing, ready, seek };
};

test('a_transfer_that_plays_before_the_mount_starts_at_the_hub_position', () => {
    // Same queue, same row: armSeekStep retargets the startup seek (engine not up), then the
    // load's mediaPlay() is the first PLAYING; the element reports ready after it.
    const d = freshDesktop();
    d.seek.arm(CLOSED_SEC, 'u3');
    d.seek.retarget(HUB_SEC, 'u3');
    d.playing();
    d.ready();
    assert.equal(d.engine.position, HUB_SEC, 'the element plays from 0 s');
    hooks.onWebEngineReady?.(null);
});

test('a_landing_seek_before_the_mount_is_held_for_the_ready', () => {
    // Another row (or another queue): the startup seek is withdrawn and the hub's position lands
    // 150 ms after the song change, still before the element is up.
    const d = freshDesktop();
    d.seek.arm(CLOSED_SEC, 'u3');
    d.seek.withdraw();
    d.engine.src = 'song-b';
    d.engineSeek(HUB_SEC);
    // The persisted song's element reports ready first: not the source the seek was for.
    d.ready('song-a', 'song-b');
    assert.equal(d.engine.position, 0, "the hub's position went to the previous song's element");
    d.ready('song-b', 'song-b');
    assert.equal(d.engine.position, HUB_SEC, 'the seek before the mount is lost');
    hooks.onWebEngineReady?.(null);
});

test('a_seek_once_the_element_is_up_goes_at_once', () => {
    const d = freshDesktop();
    d.ready();
    d.engineSeek(120);
    assert.equal(d.engine.position, 120);
    d.ready(); // a later canplay (after a seek) applies nothing held
    assert.equal(d.engine.position, 120);
    hooks.onWebEngineReady?.(null);
});

test('wired_the_web_player_holds_a_seek_for_its_ready', () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    const player = read('../audio-player/web-player.tsx');
    assert.match(player, /createHeldSeek\(/, "the web player's seek before the mount is dropped");
    const seek = player.slice(player.indexOf('onPlayerSeekToTimestamp'));
    assert.match(seek.slice(0, seek.indexOf('onPlayerStatus')), /\.send\(/);
    const start = player.slice(player.indexOf('const applyPendingSeekIfNeeded'));
    assert.match(start.slice(0, start.indexOf('const handlePlayer2Start')), /\.ready\(/);
});
