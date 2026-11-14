import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-422, the stage 2 review's m2:  node --test src/main/termination.harness.ts
 *
 * A session logout or shutdown, `systemctl --user stop`, an AppImage updater and `kill` all end the app
 * with SIGTERM. The main process answered it with `process.exit(0)` after killing mpv, which skips
 * Electron's quit (no `before-quit`, no window close, no Chromium shutdown), and Chromium writes DOM
 * storage to disk lazily: the VM walk lost localStorage writes 25 ms, 15 s and 40 s old to a SIGTERM
 * (the downloads ledger, `store_lbbot_fills`) while a graceful close kept them. A termination signal
 * now asks Chromium to write DOM storage out and quits the app the ordinary way (mpv is cleaned up in
 * `before-quit`, as on every quit), with a hard exit only as a fallback when the quit hangs, or at once
 * on a second signal.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** The body of every `process.on('<signal>', ...)` handler in `src`. */
const signalHandlers = (src: string, signal: string) => {
    const out: string[] = [];
    const re = new RegExp(`process\\.on\\(\\s*'${signal}'`, 'g');
    for (const m of src.matchAll(re)) {
        out.push(src.slice(m.index, src.indexOf('\n});', m.index) + 4));
    }
    return out;
};

test('no_signal_handler_exits_without_quitting', () => {
    for (const file of ['./features/core/player/index.ts', './index.ts']) {
        const src = read(file);
        for (const signal of ['SIGTERM', 'SIGINT']) {
            for (const body of signalHandlers(src, signal)) {
                assert.doesNotMatch(
                    body,
                    /process\.exit\(/,
                    `${file}: the ${signal} handler exits without Electron's quit (DOM storage is lost)`,
                );
            }
        }
    }
});

test('sigterm_and_sigint_quit_the_app_gracefully', () => {
    const src = read('./index.ts');
    for (const signal of ['SIGTERM', 'SIGINT']) {
        assert.match(
            src,
            new RegExp(`process\\.on\\(\\s*'${signal}',\\s*onTerminationSignal\\s*\\)`),
            `main registers the graceful handler for ${signal}`,
        );
    }
    assert.match(src, /flushStorageData\(\)/, 'the handler writes DOM storage out');
});

type Call = [string, ...unknown[]];

const harness = async () => {
    const { createTerminationHandler, HARD_EXIT_MS } = await import('./termination.ts');
    const calls: Call[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    let flushThrows = false;
    const handler = createTerminationHandler({
        exit: (code) => calls.push(['exit', code]),
        flushStorage: () => {
            calls.push(['flush']);
            if (flushThrows) throw new Error('no session yet');
        },
        log: () => {},
        quit: () => calls.push(['quit']),
        setTimer: (fn, ms) => {
            timers.push({ fn, ms });
            calls.push(['timer', ms]);
        },
    });
    return {
        calls,
        failFlush: () => {
            flushThrows = true;
        },
        handler,
        HARD_EXIT_MS,
        timers,
    };
};

test('a_signal_flushes_storage_then_quits_with_a_fallback', async () => {
    const h = await harness();
    h.handler('SIGTERM');
    assert.deepEqual(h.calls, [['flush'], ['timer', h.HARD_EXIT_MS], ['quit']]);
    assert.ok(h.HARD_EXIT_MS >= 3000 && h.HARD_EXIT_MS <= 10000, 'a short but not hasty fallback');
    // The quit hangs: the fallback ends the process.
    h.timers[0].fn();
    assert.deepEqual(h.calls.at(-1), ['exit', 0]);
});

test('a_second_signal_exits_at_once', async () => {
    const h = await harness();
    h.handler('SIGINT');
    h.handler('SIGINT');
    assert.deepEqual(h.calls, [['flush'], ['timer', h.HARD_EXIT_MS], ['quit'], ['exit', 0]]);
});

test('a_flush_that_throws_still_quits', async () => {
    const h = await harness();
    h.failFlush();
    h.handler('SIGTERM');
    assert.deepEqual(h.calls, [['flush'], ['timer', h.HARD_EXIT_MS], ['quit']]);
});
