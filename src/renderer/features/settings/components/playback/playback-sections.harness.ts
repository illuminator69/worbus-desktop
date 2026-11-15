import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-321 (S-099's leftovers, the two still real per PLAN-bug-audit-2026-11-09):
 *   node --test src/renderer/features/settings/components/playback/playback-sections.harness.ts
 *
 * - The Equaliser and Compressor sections had no heading: on the Playback tab they ran on from the
 *   section above, and in Settings search a match in them had no heading to open the tab at.
 * - "Only when metered" on the desktop, where the Network Information API reports no connection
 *   type and no data saver: a desktop is never metered, so the switch can only hold transcoding
 *   off. It keeps doing that for whoever has it on, and is shown there only while it is on.
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

// m1 (review 2026-11-15): hiding the switch and ignoring a stored `meteredOnly` on the desktop turned
// transcoding ON for a user who had Transcode + Only when metered, which played full quality on a
// desktop before (it is never metered). The effective rule is restored; the switch is shown on the
// desktop only while it is on, so it can be turned off, and hidden otherwise.

test('only_when_metered_shows_on_the_desktop_only_while_it_is_on', () => {
    const src = read('./transcode-settings.tsx');
    const row = src.slice(
        src.indexOf("title: 'Only when metered'") - 1400,
        src.indexOf("title: 'Only when metered'"),
    );
    assert.match(
        row,
        /isHidden: !transcode\.enabled \|\| \(isElectron\(\) && !transcode\.meteredOnly\),/,
    );
});

test('a_desktop_is_never_metered_so_only_when_metered_keeps_full_quality', async () => {
    const { effectiveTranscode } =
        await import('../../../player/audio-player/hooks/effective-transcode.ts');
    const on = { bitrate: 128, enabled: true, format: 'mp3', meteredOnly: true };
    // The desktop: the user's choice "transcode only when metered" never transcodes, as before.
    assert.equal(effectiveTranscode(on, { isDesktop: true, isMetered: false }).enabled, false);
    assert.equal(effectiveTranscode(on, { isDesktop: true, isMetered: true }).enabled, false);
    // The web build on a metered link transcodes; off it, full quality.
    assert.equal(effectiveTranscode(on, { isDesktop: false, isMetered: true }).enabled, true);
    assert.equal(effectiveTranscode(on, { isDesktop: false, isMetered: false }).enabled, false);
    // Without the switch, the stored config is the effective one everywhere.
    const always = { ...on, meteredOnly: false };
    assert.deepEqual(effectiveTranscode(always, { isDesktop: true, isMetered: false }), always);
    const off = { ...on, enabled: false };
    assert.equal(effectiveTranscode(off, { isDesktop: false, isMetered: true }).enabled, false);
    // The rest of the profile is carried as stored.
    assert.equal(effectiveTranscode(on, { isDesktop: true, isMetered: false }).bitrate, 128);
});

test('the_player_engines_read_the_effective_rule', () => {
    const src = read('../../../player/audio-player/hooks/use-effective-transcode.ts');
    assert.match(
        src,
        /effectiveTranscode\(transcode, \{ isDesktop: isElectron\(\), isMetered \}\)/,
    );
    assert.doesNotMatch(src, /\|\| isElectron\(\)\) return transcode/);
});
