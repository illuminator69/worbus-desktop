import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * B-420 (the owner, 2026-11-13):
 *   node --test src/renderer/components/item-list/row-playing-indicator.harness.ts
 *
 * While another device plays (remote-active on the hub), the playing song's row in a list shows
 * the equalizer bars standing still; they move only for local playback. The row knows it is the
 * playing one (the active row follows the session), but its "playing" came from the LOCAL
 * player's status (`usePlayerStatus`), which is paused while the music plays elsewhere. Every
 * row's playing state reads the session's (`useRemoteAwareStatus`: the hub's play/pause while
 * remote-active, the local player's otherwise), as the artist page's track list already does.
 * A source guard over every list hook and component that decides a row's playing state.
 */

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const ROW_STATE = [
    'src/renderer/components/item-list/item-table-list/columns/use-row-play-control.ts',
    'src/renderer/components/item-list/item-detail-list/columns/use-detail-row-play-control.ts',
    'src/renderer/features/artists/components/artist-track-list.tsx',
];

test('a_row_plays_when_the_session_plays_whichever_device_plays_it', () => {
    for (const file of ROW_STATE) {
        const src = read(file);
        assert.match(src, /useRemoteAwareStatus\(\)/, `${file}: the local player's status`);
        assert.doesNotMatch(src, /usePlayerStatus\(\)/, `${file}: still reads the local status`);
    }
});

test('no_list_reads_the_local_status_for_a_row', () => {
    // Every file under the item lists that compares a status with PLAYING.
    const files = execFileSync('git', ['ls-files', 'src/renderer/components/item-list'], {
        cwd: ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.harness.ts'));
    for (const file of files) {
        const src = read(file);
        if (!/PlayerStatus\.PLAYING/.test(src)) continue;
        assert.doesNotMatch(src, /usePlayerStatus\(\)/, `${file}: a row's playing state is local`);
    }
});
