import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

/**
 * F1:  node --test src/shared/utils/no-upstream-hosts.harness.ts
 *
 * The fork's testers must never be offered upstream's build or have their usage sent to upstream's
 * analytics. This reads the source tree the way grep would, with comments removed, and fails when
 * an upstream host comes back: the updater feed owner, the Umami script, the renderer's poll of
 * upstream's latest release, or an updater that a packaged build can construct.
 * electron-builder.yml (outside src/) keeps its publish block for the rename (S-090 D).
 */

const SRC = new URL('../../', import.meta.url).pathname;

const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (full.includes('/i18n/locales')) continue;
            walk(full, out);
        } else if (
            /\.(ts|tsx|html|css|js)$/.test(entry.name) &&
            !/\.harness\.ts$/.test(entry.name)
        ) {
            out.push(full);
        }
    }
    return out;
};

// Removes // line comments (not the // of a URL), block comments and HTML comments.
const stripComments = (text: string) =>
    text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/(^|[^:'"\w/])\/\/.*$/gm, '$1');

const files = walk(SRC).map((path) => ({
    code: stripComments(readFileSync(path, 'utf8')),
    path: relative(SRC, path),
}));

const hits = (pattern: RegExp) => files.filter((f) => pattern.test(f.code)).map((f) => f.path);

test('theTreeIsReadAndTheCommentStripperKeepsUrls', () => {
    assert.ok(files.length > 500, `expected the whole src tree, got ${files.length} files`);
    assert.equal(
        stripComments("a // gone\nb('https://x.example/y') // gone").trim(),
        "a \nb('https://x.example/y')",
    );
    assert.equal(stripComments("/* owner: 'jeffvli' */ x"), ' x');
});

test('noUpstreamAnalyticsHostIsReachable', () => {
    assert.deepEqual(hits(/jeffvli\.org/), []);
    assert.deepEqual(hits(/umami/i), []);
});

test('noUpdaterFeedNamesUpstreamAsOwner', () => {
    assert.deepEqual(hits(/owner:\s*['"]jeffvli['"]/), []);
});

test('theRendererDoesNotPollUpstreamsLatestRelease', () => {
    assert.deepEqual(hits(/useCheckForUpdates|useGithubLatestRelease/), []);
});

test('aPackagedBuildNeverConstructsTheUpdaterAndForcesTheSettingOff', () => {
    const main = files.find((f) => f.path === 'main/index.ts')!.code;
    assert.match(
        main,
        /if \(\s*!app\.isPackaged\s*&&[\s\S]{0,120}?\)\s*\{\s*new AppUpdater\(\);/,
        'new AppUpdater() must sit behind !app.isPackaged',
    );
    assert.match(
        main,
        /if \(app\.isPackaged\)\s*\{\s*store\.set\('disable_auto_updates', true\);/,
        'disable_auto_updates must be forced true in a packaged build',
    );
    assert.equal(
        (main.match(/new AppUpdater\(/g) ?? []).length,
        1,
        'the updater is constructed in exactly one place',
    );
});

test('theRendererNoLongerWritesDisableAutoUpdatesToMain', () => {
    const sync = files.find((f) => f.path === 'renderer/hooks/use-sync-settings-to-main.ts')!.code;
    assert.ok(
        !sync.includes('disable_auto_updates'),
        'the sync would flip the forced value back and raise a restart toast',
    );
});

test('advancedListsNoUpdateOrAnalyticsSection', () => {
    const advanced = files.find(
        (f) => f.path === 'renderer/features/settings/components/advanced/advanced-tab.tsx',
    )!.code;
    assert.ok(!/UpdateSettings|AnalyticsSettings/.test(advanced));
});

test('noCodePathNamesUpstreamsRepositoryOrCallsGithubsApi', () => {
    // The one allowed mention (Worbus P5, design §6.8): the credit line's link to upstream.
    const strip = (code: string) => code.replace(/^.*is a fork of Feishin by Jeff Li.*$/gm, '');
    const hitsOutsideUserAgent = (pattern: RegExp) =>
        files.filter((f) => pattern.test(strip(f.code))).map((f) => f.path);
    assert.deepEqual(hitsOutsideUserAgent(/api\.github\.com\/repos\/jeffvli/), []);
    assert.deepEqual(hitsOutsideUserAgent(/github\.com\/jeffvli/), []);
    assert.deepEqual(hitsOutsideUserAgent(/api\.github\.com/), []);
});

test('noReleaseNotesModalOrGithubReleasesHookRemains', () => {
    assert.deepEqual(hits(/ReleaseNotesModal|openReleaseNotesModal|useGithubReleases/), []);
    assert.deepEqual(hits(/UpdateAvailableDialog/), []);
    assert.deepEqual(hits(/renderer-open-release-notes|rendererOpenReleaseNotes/), []);
});
