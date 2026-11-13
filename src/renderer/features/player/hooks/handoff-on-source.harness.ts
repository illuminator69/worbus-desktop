import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as startupSeek from './startup-seek.ts';

/**
 * B-401 / B-349, review M2 of the re-walk round (2026-11-13):
 *   node --test src/renderer/features/player/hooks/handoff-on-source.harness.ts
 *
 * Stopping a station (`use-radio-player.ts` stop) or leaving DLNA (`use-dlna-cast.ts`
 * handleDisconnect) writes `playerHandoff.pendingLocalSeek`; the queue's web player mounts again
 * and its first ready applied the handoff, whatever source was ready. A station that played for
 * over 20 s leaves the queue's stream-URL query garbage-collected (the queue's player is unmounted
 * meanwhile), so on the mount the URL is pending (Navidrome's getTranscodeDecision) and the element
 * loads react-player's silent placeholder, which reports ready too: the placeholder took the
 * handoff, then the real URL loaded from 0 s. The queue must come back paused at its position
 * (B-401's ruling). The handoff waits for the song's own source, the way `take()` treats a hold.
 */

const POSITION = 63.1;

type Helpers = {
    readyOnOwnSource?: (readySrc: string | undefined, currentSrc: string | undefined) => boolean;
};
const helper = startupSeek as unknown as Helpers;

/** The remounted queue player (web-player.tsx's applyPendingSeekIfNeeded), on react-player's rules. */
const remountedPlayer = () => {
    const el = { position: 0, src: 'data:audio/mp3;base64,AAAA' };
    const current: { url: string | undefined } = { url: undefined }; // the URL query is pending
    let handoff = POSITION; // playerHandoff.pendingLocalSeek, read at mount
    const ready = () => {
        const own = helper.readyOnOwnSource ? helper.readyOnOwnSource(el.src, current.url) : true; // the tip: any ready of the current slot
        const now = own ? handoff : -1;
        if (own) handoff = -1;
        const at = startupSeek.seekAtReady(null, now);
        if (at !== null) el.position = at;
    };
    const urlResolved = (url: string) => {
        current.url = url;
        el.src = url;
        el.position = 0; // a new source loads from 0 s
    };
    return { el, ready, urlResolved };
};

test('the_placeholders_ready_does_not_take_the_radio_handoff', () => {
    const p = remountedPlayer();
    p.ready(); // EMPTY_SOURCE's canplay, the queue's URL still pending
    p.urlResolved('https://nd/rest/stream.view?id=a');
    p.ready();
    assert.equal(p.el.position, POSITION, 'the placeholder took the handoff: the queue is at 0:00');
});

test('the_handoff_applies_at_once_when_the_url_is_already_there', () => {
    const p = remountedPlayer();
    p.urlResolved('https://nd/rest/stream.view?id=a'); // a station under 20 s: the query was cached
    p.ready();
    assert.equal(p.el.position, POSITION);
});

test('own_source_means_the_ready_source_is_the_current_songs_url', () => {
    assert.equal(typeof helper.readyOnOwnSource, 'function', 'no per-source rule for the handoff');
    const own = helper.readyOnOwnSource!;
    assert.equal(own('https://nd/a', 'https://nd/a'), true);
    assert.equal(
        own('data:audio/mp3;base64,AAAA', undefined),
        false,
        'the placeholder, URL pending',
    );
    assert.equal(own('https://nd/a', 'https://nd/b'), false);
    assert.equal(own(undefined, 'https://nd/a'), false);
});

test('the_web_player_keeps_the_handoff_until_its_own_source_is_ready', () => {
    const web = readFileSync(new URL('../audio-player/web-player.tsx', import.meta.url), 'utf8');
    const apply = web.slice(
        web.indexOf('const applyPendingSeekIfNeeded'),
        web.indexOf('const handlePlayer1Start'),
    );
    assert.match(apply, /readyOnOwnSource\(/, 'the handoff is taken by any ready');
    assert.doesNotMatch(
        apply,
        /const handoff = pendingLocalSeekRef\.current;\s*pendingLocalSeekRef\.current = -1;/,
        'the handoff is cleared at any ready',
    );
});
