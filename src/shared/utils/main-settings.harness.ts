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
