import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    MIRRORED_SETTINGS,
    mirroredPatchFrom,
    mirroredWrites,
    rendererMayUse,
} from './main-settings.ts';

/**
 * B-324, B-328 (Phase B, W11):
 *   node --test src/shared/utils/main-settings.harness.ts
 *
 * Thirteen settings live in two stores: the renderer's (localStorage) and main's (electron-store).
 * Main reads every one of them before a window exists (the window frame, tray, start minimized, the
 * password backend, media keys, the playback engine) and is the copy that acts. Yet five seconds
 * after launch the renderer pushed ITS copy over main's and toasted "restart" (B-328): any write
 * that reached only the renderer (a settings import, a partly copied profile, a CDP edit) won over
 * the store main had started with. And main's generic settings IPC let the renderer read or
 * replace any key at all (B-324): the `server` password map, `theme`, `bounds`, `hub.deviceId`.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('main_owns_the_mirrored_settings_the_launch_sync_does_not_push_over_them', () => {
    const sync = read('../../renderer/hooks/use-sync-settings-to-main.ts');
    assert.doesNotMatch(
        sync,
        /localSettings\.set\(/,
        'the launch sync writes the renderer copy to main',
    );
    assert.doesNotMatch(sync, /openRestartRequiredToast/, 'and asks for a restart');
});

test('the_generic_settings_ipc_takes_only_the_keys_the_renderer_uses', () => {
    const main = read('../../main/features/core/settings/index.ts');
    for (const channel of ['settings-get', 'settings-set', 'settings-set-sync']) {
        const at = main.indexOf(`'${channel}'`);
        assert.match(
            main.slice(at, at + 200),
            /if \(!rendererMayUse\(data\.property\)\)/,
            `${channel} serves any key but hubAuth`,
        );
    }
});

test('an_import_writes_main_s_copy_too', () => {
    const modal = read(
        '../../renderer/components/export-import-settings-modal/export-import-settings-modal.tsx',
    );
    assert.match(modal, /writeMirroredToMain\(/, 'an import reaches the renderer store only');
});

test('the_channel_refuses_main_s_own_keys', () => {
    for (const key of ['server', 'hubAuth', 'hubAuth.secret', 'theme', 'bounds', 'hub.deviceId']) {
        assert.equal(rendererMayUse(key), false, key);
    }
    for (const key of ['playbackType', 'mpv_path', 'ignore_ssl', 'window_enable_tray']) {
        assert.equal(rendererMayUse(key), true, key);
    }
    assert.equal(rendererMayUse(undefined), false);
});

test('every_key_the_renderer_names_is_in_the_table', () => {
    // The table is the allow-list: a control writing a key not in it would be refused silently.
    const files = execSync("git ls-files 'src/renderer/*.ts' 'src/renderer/*.tsx'", {
        cwd: new URL('../../..', import.meta.url),
        encoding: 'utf8',
    })
        .split('\n')
        .filter((f) => f && !f.endsWith('.harness.ts'));
    const used = new Set<string>();
    for (const file of files) {
        const code = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
        for (const m of code.matchAll(
            /localSettings[!?]?\.(?:get|set|setSync)\(\s*'([a-zA-Z_.]+)'|property: '([a-zA-Z_.]+)'/g,
        )) {
            used.add(m[1] ?? m[2]);
        }
        const consent = /CONSENT_GRANTED_KEY = '([a-z_]+)'/.exec(code);
        if (consent) used.add(consent[1]);
    }
    assert.ok(used.size >= 15, `found ${used.size}`);
    for (const key of used) assert.equal(rendererMayUse(key), true, key);
});

test('at_launch_the_renderer_adopts_what_main_holds', () => {
    const renderer = {
        font: { custom: null },
        playback: { mediaSession: false, type: 'web' },
        window: { tray: true, windowBarStyle: 'linux' },
    };
    const patch = mirroredPatchFrom(renderer, {
        local_font_path: undefined, // main has no word: the renderer's stays
        mediaSession: false, // the same: nothing to change
        playbackType: 'local', // main started with mpv: the renderer's copy follows
        window_enable_tray: false,
    });
    assert.deepEqual(patch, { playback: { type: 'local' }, window: { tray: false } });
    assert.deepEqual(mirroredPatchFrom(renderer, {}), {});
});

test('an_import_writes_only_what_it_changes', () => {
    const before = { lyrics: { enableNeteaseTranslation: false, sources: ['NetEase'] } };
    const after = { lyrics: { enableNeteaseTranslation: false, sources: ['lrclib.net'] } };
    assert.deepEqual(mirroredWrites(before, after), [{ key: 'lyrics', value: ['lrclib.net'] }]);
    assert.deepEqual(mirroredWrites(before, before), []);
});

test('the_mirrored_keys_are_ones_main_reads', () => {
    const files = execSync("git ls-files 'src/main/*.ts'", {
        cwd: new URL('../../..', import.meta.url),
        encoding: 'utf8',
    })
        .split('\n')
        .filter((f) => f && !f.endsWith('.harness.ts'));
    const main = files
        .map((f) => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8'))
        .join('\n');
    for (const { key } of MIRRORED_SETTINGS) {
        assert.match(main, new RegExp(`store\\.get\\('${key}'`), `main reads ${key}`);
    }
});

/**
 * B-328 (review major, fix round 2026-11-12): "Reset to default" removed only the renderer's
 * localStorage and reloaded. The launch adopt then copied main's OLD values back, so the twelve
 * settings main owns survived a reset that said everything resets. A reset must put main's copies
 * back to main's own defaults first; the adopt after the reload then finds nothing old to copy.
 */

/** electron-store 8 / conf 10 as the reset sees it: defaults merged at creation, `reset(key)` sets
 *  a key that has a default back to it, `delete` removes it. */
const fakeMainStore = (defaults: Record<string, unknown>, held: Record<string, unknown>) => {
    const data: Record<string, unknown> = { ...defaults, ...held };
    return {
        data,
        delete: (key: string) => void delete data[key],
        get: (key: string) => data[key],
        reset: (...keys: string[]) => {
            for (const key of keys) if (defaults[key] !== undefined) data[key] = defaults[key];
        },
    };
};

test('a_reset_puts_main_s_copies_back_to_its_defaults', async () => {
    const mod = (await import('./main-settings.ts')) as Record<string, unknown>;
    assert.equal(
        typeof mod.resetMirroredIn,
        'function',
        "a reset reaches only the renderer's localStorage; main keeps the old values",
    );
    const resetMirroredIn = mod.resetMirroredIn as (store: unknown) => boolean;
    const store = fakeMainStore(
        { playbackType: 'web', window_enable_tray: true },
        { local_font_path: '/fonts/old.ttf', playbackType: 'local', window_enable_tray: false },
    );
    assert.equal(resetMirroredIn(store), true, 'main acted on other values: a restart is owed');
    assert.equal(store.get('window_enable_tray'), true);
    assert.equal(store.get('playbackType'), 'web');
    assert.equal(store.get('local_font_path'), undefined, 'a key with no default is removed');
    // After the reload the renderer holds its defaults, and the adopt copies nothing old back.
    const values = Object.fromEntries(MIRRORED_SETTINGS.map(({ key }) => [key, store.get(key)]));
    const patch = mirroredPatchFrom(
        {
            font: { custom: null },
            playback: { type: 'web' },
            window: { tray: true },
        },
        values,
    );
    assert.deepEqual(patch.window, undefined, 'the old tray switch came back');
    assert.deepEqual(patch.playback, undefined, 'the old playback engine came back');
    assert.deepEqual(patch.font, undefined, 'the old font came back');
    // Nothing to put back: no restart owed.
    assert.equal(resetMirroredIn(fakeMainStore({ playbackType: 'web' }, {})), false);
});

test('the_reset_reaches_main_before_the_reload', () => {
    const store = read('../../renderer/store/settings.store.ts');
    // The implementation, not the slice type's `reset: () => ...;` line.
    const start = store.search(/reset: (async )?\(\) => \{/);
    const body = store.slice(start, store.indexOf('resetSampleRate: () => {', start));
    const toMain = body.indexOf('resetMirrored(');
    assert.ok(toMain > 0, 'reset() never tells main');
    assert.ok(toMain < body.indexOf('window.location.reload()'), 'main is told after the reload');
    const main = read('../../main/features/core/settings/index.ts');
    assert.match(main, /'settings-reset-mirrored'[\s\S]{0,120}resetMirroredIn\(store\)/);
});

test('a_reset_that_owed_a_restart_asks_once_after_its_reload', async () => {
    const { noteRestartOwedAfterReset, takeRestartOwedAfterReset } =
        await import('../../renderer/store/reset-restart.ts');
    const kept = new Map<string, string>();
    const storage = {
        getItem: (k: string) => kept.get(k) ?? null,
        removeItem: (k: string) => void kept.delete(k),
        setItem: (k: string, v: string) => void kept.set(k, v),
    };
    assert.equal(takeRestartOwedAfterReset(storage), false);
    noteRestartOwedAfterReset(storage);
    assert.equal(takeRestartOwedAfterReset(storage), true);
    assert.equal(takeRestartOwedAfterReset(storage), false, 'asked again at the next reload');
    // Storage refused (a private window): the reset goes on, nothing is asked.
    const refused = {
        getItem: () => {
            throw new Error('blocked');
        },
        removeItem: () => undefined,
        setItem: () => {
            throw new Error('blocked');
        },
    };
    noteRestartOwedAfterReset(refused);
    assert.equal(takeRestartOwedAfterReset(refused), false);
    const app = read('../../renderer/app.tsx');
    assert.match(app, /takeRestartOwedAfterReset\(window\.sessionStorage\)/);
});

test('every_key_the_preload_asks_main_for_is_served', () => {
    // Fix round 2026-11-12: the preload reads `maximized` at start (the window bar's maximise
    // button), through the same generic channel; B-324's allow-list refused it, so the button
    // always started as "not maximised".
    const preload = read('../../preload/local-settings.ts');
    const asked = [...preload.matchAll(/^get\('([a-zA-Z_.]+)'\)/gm)].map((m) => m[1]);
    assert.ok(asked.includes('maximized'), `found ${asked.join(', ')}`);
    for (const key of asked) assert.equal(rendererMayUse(key), true, key);
});

test('a_font_main_cannot_load_is_cleared_in_main_too', () => {
    // Review minor (fix round 2026-11-12): main reports a bad custom font file; the handler cleared
    // the renderer's copy only, so main kept `local_font_path`, the adopt copied it back at the next
    // launch and the error came again, at every launch.
    const settings = read(
        '../../renderer/features/settings/components/general/application-settings.tsx',
    );
    const at = settings.indexOf('const onFontError');
    const handler = settings.slice(at, settings.indexOf('useEffect(', at));
    assert.match(handler, /custom: null/);
    assert.match(
        handler,
        /localSettings\??\.setSync\('local_font_path', null\)/,
        "the bad path is cleared in the renderer only; main's copy brings it back",
    );
});
