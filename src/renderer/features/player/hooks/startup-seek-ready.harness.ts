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
    assert.match(engine, /webEngineReady\(\)/, 'the web engine says when its element is ready');
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
