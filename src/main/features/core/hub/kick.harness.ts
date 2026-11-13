import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { KickState, ResyncState } from './kick.ts';

import {
    afterClose,
    KICK_FLOOR_MS,
    kickAction,
    RESYNC_CLOSE_WAIT_MS,
    resyncAction,
} from './kick.ts';

/** node --test src/main/features/core/hub/kick.harness.ts */

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;

const kicked = (patch: Partial<KickState>) =>
    kickAction({ readyState: undefined, shouldRun: true, sinceLastKick: 60_000, ...patch });

test('waiting out the backoff: connect now', () => {
    assert.equal(kicked({}), 'connect');
});

test('a handshake in flight is replaced', () => {
    assert.equal(kicked({ readyState: CONNECTING }), 'replace');
});

test('an open socket is only ever probed - never replaced, never reconnected', () => {
    assert.equal(kicked({ readyState: OPEN }), 'probe');
});

test('a socket already closing is left to its own close', () => {
    assert.equal(kicked({ readyState: CLOSING }), 'none');
});

test('switched off, or refused by the hub: nothing, whatever the socket', () => {
    for (const readyState of [undefined, CONNECTING, OPEN, CLOSING]) {
        assert.equal(kicked({ readyState, shouldRun: false }), 'none', String(readyState));
    }
});

test('a second kick inside the floor does nothing; one after it does', () => {
    for (const readyState of [undefined, CONNECTING, OPEN]) {
        assert.equal(kicked({ readyState, sinceLastKick: 0 }), 'none');
        assert.equal(kicked({ readyState, sinceLastKick: KICK_FLOOR_MS - 1 }), 'none');
        assert.notEqual(kicked({ readyState, sinceLastKick: KICK_FLOOR_MS }), 'none');
    }
});

test('a wake fires resume and online together: one attempt, not two', () => {
    // resume at 0 finds the backoff pending and connects; online 40 ms later would otherwise
    // find that attempt CONNECTING and replace it.
    let lastKickAt = -60_000;
    const kickAt = (now: number, readyState: number | undefined) => {
        const action = kickAction({ readyState, shouldRun: true, sinceLastKick: now - lastKickAt });
        if (action !== 'none') lastKickAt = now;
        return action;
    };
    assert.equal(kickAt(0, undefined), 'connect');
    assert.equal(kickAt(40, CONNECTING), 'none');
    assert.equal(kickAt(40 + KICK_FLOOR_MS, CONNECTING), 'replace', 'still hanging later: replace');
});

test('a clock set back since the last kick does not silence the next one', () => {
    assert.equal(kicked({ sinceLastKick: -3_600_000 }), 'connect');
});

// B-421: a renderer reload (Ctrl+R, Vite's full reload) left the hub state gone for minutes. The
// main process kept its socket, so no new `welcome` came, and the reloaded page only learns that
// it is connected - and the session, the devices, lb-bot - from one.
const resynced = (patch: Partial<ResyncState>) =>
    resyncAction({ readyState: OPEN, shouldRun: true, welcomed: true, ...patch });

test('B-421: a page that subscribes after this socket welcomed another one gets a fresh connection', () => {
    assert.equal(resynced({}), 'reconnect');
});

test('B-421: a socket not yet welcomed is left alone - its welcome reaches the new page', () => {
    assert.equal(resynced({ welcomed: false }), 'none');
});

test('B-421: connecting, waiting out the backoff or closing - the next welcome reaches the page', () => {
    for (const readyState of [undefined, CONNECTING, CLOSING]) {
        assert.equal(resynced({ readyState }), 'none', String(readyState));
        assert.equal(resynced({ readyState, welcomed: false }), 'none', String(readyState));
    }
});

test('B-421: switched off, refused or signed out - nothing to resync', () => {
    for (const readyState of [undefined, CONNECTING, OPEN, CLOSING]) {
        assert.equal(resynced({ readyState, shouldRun: false }), 'none', String(readyState));
    }
});

// Review L5: the new socket's hello must not reach the hub before the old socket's close, or the
// hub's `_disconnect` skips the old one (`dev.ws is not ws`) and the device stays active and
// "playing" under a reloaded, paused page. The replacement dials once the old socket has closed.
class FakeSocket extends EventEmitter {
    closed = 0;
    terminated = 0;
    close() {
        this.closed += 1;
    }
    terminate() {
        this.terminated += 1;
        this.emit('close', 1006);
    }
}

test('L5: the replacement waits for the old socket to close, then goes once', () => {
    const old = new FakeSocket();
    let went = 0;
    afterClose(old, 1000, () => (went += 1));
    assert.equal(old.closed, 1, 'closed at once');
    assert.equal(went, 0, 'not before its close');
    old.emit('close', 1000);
    assert.equal(went, 1);
    old.emit('close', 1000);
    assert.equal(went, 1, 'once');
});

test('L5: an old socket that never closes is terminated after the wait, and the replacement goes', async () => {
    const old = new FakeSocket();
    let went = 0;
    afterClose(old, 5, () => (went += 1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(old.terminated, 1);
    assert.equal(went, 1);
    assert.ok(RESYNC_CLOSE_WAIT_MS > 0 && RESYNC_CLOSE_WAIT_MS <= 3000);
});

test('L5/L6: the resync replaces the socket on the address that works, after the old one closed', () => {
    const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("ipcMain.on('hub-resync'"));
    const body = handler.slice(0, handler.indexOf('\n});'));
    assert.doesNotMatch(body, /stop\(\);\s*start\(\);/, 'not a settings restart: that re-chooses');
    assert.match(body, /resyncSocket\(\)/);
    const fn = main.slice(main.indexOf('function resyncSocket'));
    const fnBody = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(fnBody, /const url = activeAddress\.active\(\)/, 'L6: the working address');
    assert.doesNotMatch(fnBody, /activeAddress\.reset\(\)/);
    assert.match(fnBody, /afterClose\(/, 'L5: after the old close');
    assert.match(fnBody, /dial\(url, gen\)/);
});
