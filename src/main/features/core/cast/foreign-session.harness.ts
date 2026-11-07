import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { OwnCast } from './foreign-session.ts';

import { adoptable, streamIdentity, takeoverStep } from './foreign-session.ts';

/**
 * Worbus P2 lane F, F4:  node --test src/main/features/core/cast/foreign-session.harness.ts
 *
 * Chromecasts are per user (design §6.3): two users casting to one speaker, the last one wins.
 * The losing bridge used to notice nothing - it reacted only to IDLE/ERROR and IDLE/FINISHED, and
 * castv2's media controller follows whatever `mediaSessionId` arrives, so a later `do:play` would
 * have resumed the other user's music. Now a status that is not this bridge's session makes it
 * report the speaker released (its user's session pauses), and it never adopts that session.
 *
 * Both users read one library, so a track id can be in both queues: the media session id is the
 * proof, the content id only a second one.
 */

const url = (id: string) =>
    `http://nd.lan:4533/rest/stream.view?id=${id}&u=alice&t=0123456789abcdef0123456789abcdef&s=a1b2c3`;

const own: OwnCast = {
    appSessionId: 'app-session-ours',
    foreignMediaSessions: new Set(),
    mediaSessionId: 7,
    queueIds: ['song-1', 'song-2'],
};
const playing = { loading: false, playing: true };

test('foreign media session releases not adopts', () => {
    // Another sender loaded on the same Default Media Receiver: a new media session id, even for
    // a song that is in this queue too (one library, two users).
    assert.equal(
        takeoverStep({ media: { contentId: url('song-1') }, mediaSessionId: 8 }, own, playing),
        'release',
    );
    // R25 (review I6): the bridge's own media session is never someone else's, whatever it plays -
    // a queue edit that drops the playing track (or a preview swapped for the owned copy) must
    // not release one's own playback. Another sender's LOAD starts a new media session.
    assert.equal(
        takeoverStep({ media: { contentId: url('song-9') }, mediaSessionId: 7 }, own, playing),
        'none',
    );
    // Content is the proof only while no own media session is known (after launch or join,
    // before its LOAD answered).
    assert.equal(
        takeoverStep({ media: { contentId: url('song-9') } }, own, playing),
        'none',
        'a status with no media session id under a known own one: nothing to judge by',
    );
    assert.equal(
        takeoverStep(
            { media: { contentId: url('song-9') }, mediaSessionId: 8 },
            { ...own, mediaSessionId: null },
            playing,
        ),
        'release',
    );
    // checkTakeover never marks the bridge's own session as foreign (it would become
    // un-adoptable after a restart).
    const cast = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    assert.match(
        cast,
        /typeof status\?\.mediaSessionId === 'number' &&\s*status\.mediaSessionId !== this\.ownMediaSessionId\s*\)\s*\{\s*this\.foreignMediaSessions\.add\(status\.mediaSessionId\);/,
    );
    // Not playing (paused, or idle): nothing to report, but the bridge lets go of the player, so
    // a later play loads over it instead of resuming someone else's session.
    assert.equal(
        takeoverStep({ media: { contentId: url('song-9') }, mediaSessionId: 8 }, own, {
            loading: false,
            playing: false,
        }),
        'drop',
    );
    // The receiver no longer runs this bridge's app session: another sender launched over it.
    assert.equal(
        takeoverStep(
            { applications: [{ appId: 'CC1AD845', sessionId: 'someone-elses' }] },
            own,
            playing,
        ),
        'release',
    );

    // A session once released is never adopted again, even when its content proves "ours".
    const after: OwnCast = { ...own, foreignMediaSessions: new Set([8]), mediaSessionId: null };
    assert.equal(
        adoptable({ media: { contentId: url('song-1') }, mediaSessionId: 8 }, after),
        false,
    );
    assert.equal(
        adoptable({ media: { contentId: url('song-1') }, mediaSessionId: 9 }, after),
        true,
    );
    assert.equal(
        adoptable({ media: { contentId: url('song-9') }, mediaSessionId: 9 }, after),
        false,
    );
    assert.equal(adoptable(null, after), false);
});

test('this bridge own statuses are left alone', () => {
    assert.equal(
        takeoverStep({ media: { contentId: url('song-2') }, mediaSessionId: 7 }, own, playing),
        'none',
    );
    // A status with no media (buffering, between tracks) and no id says nothing.
    assert.equal(takeoverStep({ playerState: 'BUFFERING' }, own, playing), 'none');
    assert.equal(takeoverStep(null, own, playing), 'none');
    // While this bridge's own LOAD is in flight, a new media session id is its own.
    assert.equal(
        takeoverStep({ media: { contentId: url('song-2') }, mediaSessionId: 12 }, own, {
            loading: true,
            playing: true,
        }),
        'none',
    );
    // Before any media session is known (just launched), only the content can decide.
    const fresh: OwnCast = { ...own, mediaSessionId: null };
    assert.equal(
        takeoverStep({ media: { contentId: url('song-1') }, mediaSessionId: 3 }, fresh, playing),
        'none',
    );
    // A RECEIVER_STATUS still listing this app session (a volume change), or one without an
    // applications list at all, is not a takeover.
    assert.equal(
        takeoverStep(
            { applications: [{ appId: 'CC1AD845', sessionId: 'app-session-ours' }], volume: {} },
            own,
            playing,
        ),
        'none',
    );
    assert.equal(takeoverStep({ volume: { level: 0.4 } }, own, playing), 'none');
});

test('the identity of a stream is its Subsonic id, not the salted URL', () => {
    assert.equal(streamIdentity(url('song-1')), 'song-1');
    assert.equal(streamIdentity(url('song-1').replace('u=alice', 'u=bob')), 'song-1');
    assert.equal(streamIdentity(null), null);
    assert.equal(streamIdentity('not a url'), 'not a url');
});

test('the bridge runs every status through the check and releases without touching the music', () => {
    const cast = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const body = (name: string) => {
        const at = cast.indexOf(`    private ${name}(`);
        assert.ok(at >= 0, name);
        return cast.slice(at, cast.indexOf('\n    }\n', at));
    };
    // MEDIA_STATUS, before its position is believed.
    const onStatus = body('onCastStatus');
    const judged = onStatus.indexOf('if (this.checkTakeover(status)) return;');
    assert.ok(judged >= 0, 'every MEDIA_STATUS is judged');
    assert.ok(
        judged < onStatus.indexOf('this.lastPositionMs ='),
        'a foreign status is judged before its position is taken',
    );
    // RECEIVER_STATUS and the 1 s poll.
    assert.match(body('watchReceiver'), /this\.checkTakeover\(status\)/);
    assert.match(body('startTicker'), /this\.checkTakeover\(status\)/);
    // Released: a paused report, then `released`, and the player let go - never pause or stop,
    // which would act on the other user's session.
    const release = body('releaseTakenSpeaker');
    const reported = release.indexOf('this.report(');
    assert.ok(reported >= 0, 'the paused report is sent');
    assert.ok(release.indexOf("t: 'released'") > reported, 'then released');
    assert.match(release, /this\.teardownCast\(\)/);
    assert.doesNotMatch(release, /\.pause\(|\.stop\(/);
    // Own ids come from this bridge's own LOAD answer and its proven adoption.
    assert.match(cast, /this\.ownMediaSessionId = status\.mediaSessionId/);
    assert.match(body('adoptRunningSession'), /adoptable\(status, this\.ownCast\(\)\)/);
});
