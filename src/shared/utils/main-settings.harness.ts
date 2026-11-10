import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
    assert.doesNotMatch(sync, /localSettings\.set\(/, 'the launch sync writes the renderer copy to main');
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
