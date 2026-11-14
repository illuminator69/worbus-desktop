import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-321 (S-099's leftovers, the two still real per PLAN-bug-audit-2026-11-09):
 *   node --test src/renderer/features/settings/components/playback/playback-sections.harness.ts
 *
 * - The Equaliser and Compressor sections had no heading: on the Playback tab they ran on from the
 *   section above, and in Settings search a match in them had no heading to open the tab at.
 * - "Only when metered" was offered on the desktop, where the Network Information API reports no
 *   connection type and no data saver: the switch could only ever turn transcoding off, or on over
 *   a slow link by Chromium's estimate, never "on a metered connection".
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the_equaliser_and_compressor_sections_have_headings', () => {
    const src = read('./eq-settings.tsx');
    assert.match(
        src,
        /<SettingsSection\s+options=\{eqOptions\}\s+title=\{t\('setting\.equalizer'\)\}/,
    );
    assert.match(
        src,
        /<SettingsSection\s+options=\{compressorOptions\}\s+title=\{t\('setting\.compressor'\)\}/,
    );
});

test('only_when_metered_is_not_offered_on_the_desktop', () => {
    const src = read('./transcode-settings.tsx');
    const row = src.slice(
        src.indexOf("title: 'Only when metered'") - 900,
        src.indexOf("title: 'Only when metered'"),
    );
    assert.match(row, /isHidden: !transcode\.enabled \|\| isElectron\(\),/);
});

test('a_metered_only_switch_left_on_from_before_does_not_stop_transcoding_on_the_desktop', () => {
    // Hidden, the switch cannot be turned off again: on the desktop it is ignored instead.
    const src = read('../../../player/audio-player/hooks/use-effective-transcode.ts');
    assert.match(src, /if \(!transcode\.meteredOnly \|\| isElectron\(\)\) return transcode;/);
});
