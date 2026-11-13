import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as startupSeek from './startup-seek.ts';

/**
 * B-402, the owner's re-walk on `a96a9de17` (2026-11-13):
 *   node --test src/renderer/features/player/hooks/seek-on-source.harness.ts
 *
 * Phone playing, transfer to a freshly opened desktop: the song restarted at 0:00. The VM check
 * passed with a scripted sender that transferred the moment the desktop came online, before the
 * web element was up, so every seek was held for the element's ready (on its own source). The
 * owner transferred later, with the element up, and the desktop's log has a start scrobble for a
 * song change (another row): the landing seek fires 150 ms after the song change, and the web
 * player sent it straight to the element because the element had reported ready once ("up"). But
 * that element still held the previous song's source (or react-player's silent EMPTY_SOURCE, which
 * reports ready too): the new song's stream URL is a react-query that waits for Navidrome's
 * `getTranscodeDecision` round trip (Navidrome 0.64.2 answers it; the VM's stand-in answered 501 in
 * 0 ms, so its URL was there at once). When the URL arrives the element loads it and the position
 * the seek set is reset to 0. "Up" is per element, not per source: a seek is sent to the element
 * only while it holds the current song's source; otherwise it is held for that source's ready.
 */

const HUB_SEC = 86.683;

type HeldSeek = ReturnType<typeof startupSeek.createHeldSeek>;
const helper = startupSeek as unknown as {
    elementTakesSeek?: (engineUp: boolean, elementSrc?: string, currentSrc?: string) => boolean;
};

/** The web player's element, as react-player drives it: a new `src` loads from 0 s. */
const freshDesktop = () => {
    const hold: HeldSeek = startupSeek.createHeldSeek();
    const el = { position: 0, ready: false, src: 'song-a' };
    // The store's current song and its stream URL (undefined while the query is pending).
    const current: { song: string; url: string | undefined } = { song: 'u-a', url: 'song-a' };
    const toElement = (sec: number) => {
        el.position = sec;
    };
    // web-player.tsx's onPlayerSeekToTimestamp.
    const seek = (sec: number) => {
        const up = helper.elementTakesSeek
            ? helper.elementTakesSeek(el.ready, el.src, current.url)
            : el.ready; // the base: up once the element has reported ready, whatever its source
        hold.send(sec, up, toElement, current.song);
    };
    // The element loads a new source (react-player's url prop): from 0 s, then canplay.
    const load = (src: string) => {
        el.src = src;
        el.position = 0;
    };
    // canplay → onReady → handlePlayerNStart's take.
    const ready = () => {
        el.ready = true;
        const at = hold.take(el.src, current.url, current.song);
        if (at !== null) toElement(at);
    };
    const changeSong = (song: string) => {
        current.song = song;
        current.url = undefined; // the stream URL query for the new song is pending
        hold.drop(); // web-player's onCurrentSongChange
    };
    const urlResolved = (url: string) => {
        current.url = url;
        load(url);
    };
    return { changeSong, el, ready, seek, urlResolved };
};

test('a_landing_seek_before_the_new_songs_source_is_held_for_its_ready', () => {
    const d = freshDesktop();
    d.ready(); // the restored song's element is up, paused
    // Transfer to another row: the song changes, its URL waits for getTranscodeDecision.
    d.changeSong('u-b');
    d.seek(HUB_SEC); // the landing seek, 150 ms after the song change
    d.urlResolved('song-b'); // the element loads the new song from 0 s
    d.ready();
    assert.equal(d.el.position, HUB_SEC, "the seek went to the previous song's source: 0:00");
});

test('a_seek_while_the_element_holds_the_silent_placeholder_is_held', () => {
    // Same row: the element came up on EMPTY_SOURCE (it reports ready too) before the restored
    // song's URL resolved; the transfer's seek must wait for the song's own source.
    const d = freshDesktop();
    d.el.src = 'data:audio/mp3;base64,AAAA';
    d.changeSong('u-a');
    d.ready();
    d.seek(HUB_SEC);
    d.urlResolved('song-a');
    d.ready();
    assert.equal(d.el.position, HUB_SEC);
});

test('a_seek_on_the_current_source_still_goes_at_once', () => {
    const d = freshDesktop();
    d.ready();
    d.seek(HUB_SEC);
    assert.equal(d.el.position, HUB_SEC, 'a scrub on a playing song waits');
});

test('the_web_player_asks_whether_its_element_holds_the_current_source', () => {
    assert.equal(typeof helper.elementTakesSeek, 'function', 'no per-source check');
    const take = helper.elementTakesSeek!;
    assert.equal(take(true, 'https://nd/rest/stream?id=b', 'https://nd/rest/stream?id=b'), true);
    assert.equal(take(true, 'https://nd/rest/stream?id=a', 'https://nd/rest/stream?id=b'), false);
    assert.equal(take(true, 'https://nd/rest/stream?id=a', undefined), false, 'URL pending');
    assert.equal(take(false, 'https://nd/x', 'https://nd/x'), false, 'not up');
    const web = readFileSync(new URL('../audio-player/web-player.tsx', import.meta.url), 'utf8');
    assert.match(web, /elementTakesSeek\(/, 'the seek handler sends on "up" alone');
});

test('the_placeholders_ready_while_the_url_is_pending_keeps_the_hold', () => {
    // Another row whose URL is not cached: react-player loads its silent EMPTY_SOURCE first (the
    // element's url is `src || EMPTY_SOURCE`), and that placeholder reports ready while the URL is
    // still pending. The hold is for the song's own source: the placeholder must not take it.
    const d = freshDesktop();
    d.ready();
    d.changeSong('u-b');
    d.seek(HUB_SEC);
    d.el.src = 'data:audio/mp3;base64,AAAA'; // the placeholder loads, from 0 s
    d.el.position = 0;
    d.ready(); // its canplay: the current URL is still unknown
    d.urlResolved('song-b');
    d.ready();
    assert.equal(d.el.position, HUB_SEC, 'the placeholder took the held seek');
});
