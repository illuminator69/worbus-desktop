import assert from 'node:assert/strict';
import test from 'node:test';

import { getDirectPlayProfiles } from './direct-play-profiles.ts';

/**
 * B-342:  node --test src/renderer/features/player/utils/direct-play-profiles.harness.ts
 *
 * At a fresh start the restored queue's stream URL is resolved by the web player's `useSongUrl`
 * query, which React starts in the web player's own effects. React runs a child's effects before
 * its parent's, so the parent `AudioPlayers`' mount effect, which ran the codec probe, came
 * after: `getStreamUrl` read `getDirectPlayProfiles()` while it was still `[]`, sent
 * `directPlayProfiles: []` to `getTranscodeDecision`, and Navidrome answered "transcode" (watched
 * 2026-11-08 on the packaged 0.7.0). The probe is synchronous (`canPlayType`), so the list must be
 * known whenever it is first asked for, with no mount in between.
 *
 * What it drives: the real `getDirectPlayProfiles` against a stand-in `Audio` whose
 * `canPlayType` answers like Chromium on Linux for the codecs listed in PLAYABLE. What it does not
 * reach: React's effect order itself and the HTTP body Navidrome receives (the walk does).
 */

const PLAYABLE = new Set([
    'audio/flac',
    'audio/mp4; codecs="mp4a.40.2"',
    'audio/mpeg',
    'audio/ogg; codecs="opus"',
    'audio/wav',
]);

let constructed = 0;

class FakeAudio {
    constructor() {
        constructed += 1;
    }

    canPlayType(mime: string): string {
        return PLAYABLE.has(mime) ? 'probably' : '';
    }
}

const g = globalThis as unknown as { Audio?: unknown };

test('withNoAudioElementTheListIsEmptyAndNotRemembered', () => {
    delete g.Audio;
    assert.deepEqual(getDirectPlayProfiles(), []);
});

test('profilesAreKnownBeforeAnyMount', () => {
    g.Audio = FakeAudio;
    const profiles = getDirectPlayProfiles();
    assert.deepEqual(
        profiles.map((p) => `${p.audioCodecs.join('+')}/${p.containers.join('+')}`),
        ['mp3/mp3', 'aac/mp4', 'opus/ogg', 'flac/flac', 'pcm+wav/wav'],
    );
    assert.ok(profiles.every((p) => p.protocols.length === 1 && p.protocols[0] === 'http'));
});

test('probedOnceNoMatterHowOftenAsked', () => {
    g.Audio = FakeAudio;
    const first = getDirectPlayProfiles();
    const length = first.length;
    getDirectPlayProfiles();
    getDirectPlayProfiles();
    assert.equal(constructed, 1, 'one probe for the life of the renderer');
    assert.equal(getDirectPlayProfiles().length, length, 'no duplicate entries');
    assert.ok(length > 0);
});
