import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-340 (Worbus P6 lane F walk, 2026-11-07):  node --test src/main/window-icon.harness.ts
 *
 * A packaged AppImage started without a desktop entry showed GNOME's generic gear: the window's
 * `_NET_WM_ICON` was empty under Xwayland although `BrowserWindow({ icon })` named `icon.png`, which
 * decodes (512 x 512). Measured on the sandbox VM with Electron 43.7.0 (Chromium 150), `xprop
 * _NET_WM_ICON` on a test window: 512 px (16- or 8-bit) and 256 px set nothing, 128, 129 and 192 px set
 * the icon. So the window icon on Linux is the 128 px file of the same set.
 */

const ROOT = new URL('../../', import.meta.url);
const pngSide = (rel: string) => {
    const buf = readFileSync(new URL(rel, ROOT));
    return Math.max(buf.readUInt32BE(16), buf.readUInt32BE(20));
};

test('the_linux_window_icon_is_small_enough_for_x11', () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const line = src.match(/\n\s*icon: isWindows\(\)[^\n]*/);
    assert.ok(line, 'the main window names its icon');
    const linux = line[0].match(/:\s*getAssetPath\('([^']+)'\),?\s*$/);
    assert.ok(linux, `the non-Windows icon is one asset: ${line[0].trim()}`);
    const side = pngSide(`assets/${linux[1]}`);
    assert.ok(
        side <= 192,
        `assets/${linux[1]} is ${side} px: Chromium sets no _NET_WM_ICON for it`,
    );
});
