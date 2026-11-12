import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Fix round 4 (2026-11-12), from the VM walk:
 *   node --test src/renderer/features/hub/utils/queue-playing.harness.ts
 *
 * Starting an internet radio station sets the player store to PLAYING (the radio drives the same
 * status), and the hub layer read that as the QUEUE playing: it published `setQueue … play=True`
 * at the paused queue's offset, and the hub and every other device showed the queue's track
 * playing while the station played. A station is not the queue (the session's `isPlaying` is the
 * queue's): while one plays, the queue is paused as far as the hub is told.
 */

const load = async () =>
    (await import('./queue-playing.ts').catch(() => null)) as null | {
        queuePlaysHere: (status: string, radioActive: boolean) => boolean;
    };

test('a_station_playing_is_not_the_queue_playing', async () => {
    const mod = await load();
    assert.ok(mod, 'the hub reads a station playing as the queue playing');
    assert.equal(mod.queuePlaysHere('playing', true), false);
    assert.equal(mod.queuePlaysHere('playing', false), true);
    assert.equal(mod.queuePlaysHere('paused', false), false);
    assert.equal(mod.queuePlaysHere('paused', true), false);
});

test('the_hub_layer_reads_the_queue_through_it', () => {
    const hub = readFileSync(new URL('../hooks/use-hub.tsx', import.meta.url), 'utf8');
    assert.match(hub, /isPlaying: queuePlaysHere\(state\.player\.status, radioActiveNow\(\)\)/);
    assert.match(
        hub,
        /playing\.current = queuePlaysHere\(properties\.status, radioActiveNow\(\)\);/,
    );
    assert.match(hub, /playing: queuePlaysHere\(state\.player\.status, radioActiveNow\(\)\)/);
    // A station starting while the queue played here must tell the hub the queue paused.
    assert.match(hub, /useRadioStore\.subscribe\(/);
});
