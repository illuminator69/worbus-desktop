import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Worbus P6 lane F, F2:  node --test src/main/release-slots.harness.ts
 *
 * The places a release is described: the AppStream metainfo (two screenshots at the fixed raw URLs and
 * a 0.6.0 release above 0.5.0's), the web manifest (one wide screenshot that is ours, not upstream's
 * preview) and the release job (a SHA256SUMS over the release files, written before the release is
 * created and not listing itself).
 */

const ROOT = new URL('../../', import.meta.url);
const text = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

const SHOT_URL = (n: number) =>
    `https://raw.githubusercontent.com/illuminator69/worbus/main/docs/screenshots/0.6/desktop-${n}.png`;

test('metainfo_has_screenshots', () => {
    const xml = text('app.worbus.desktop.metainfo.xml');

    const block = xml.match(/<screenshots>([\s\S]*?)<\/screenshots>/);
    assert.ok(block, 'a <screenshots> element');
    const shots = [...block[1].matchAll(/<screenshot\b([^>]*)>([\s\S]*?)<\/screenshot>/g)];
    assert.equal(shots.length, 2, 'two screenshots');
    assert.match(shots[0][1], /type="default"/, 'the first one is the default');
    assert.doesNotMatch(shots[1][1], /type="default"/, 'only the first one is the default');
    shots.forEach((shot, i) => {
        const image = shot[2].match(/<image\b[^>]*>([^<]*)<\/image>/);
        assert.ok(image, `screenshot ${i + 1} has an <image>`);
        assert.equal(image[1].trim(), SHOT_URL(i + 1));
        const caption = shot[2].match(/<caption>([^<]+)<\/caption>/);
        assert.ok(caption && caption[1].trim().length > 0, `screenshot ${i + 1} has a <caption>`);
    });

    const versions = [...xml.matchAll(/<release\b[^>]*\bversion="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(versions.slice(0, 2), ['0.6.0', '0.5.0'], '0.6.0 sits above 0.5.0');
    assert.equal(JSON.parse(text('package.json')).version, '0.6.0', 'package.json is 0.6.0');
});

test('manifest_screenshot_is_ours', () => {
    const config = text('web.vite.config.ts');
    assert.doesNotMatch(config, /preview_/, 'no upstream preview shot in the web build');
    assert.match(config, /src:\s*'screenshot-wide\.webp'/, 'the manifest names our shot');
    assert.match(config, /sizes:\s*'1440x900'/);
    assert.match(config, /form_factor:\s*'wide'/);
    assert.match(
        config,
        /Worbus for desktop: an artist page with its missing albums/,
        'the manifest label',
    );
    assert.match(config, /media\/screenshot-wide\.webp/, 'the build copies it from media/');
    assert.ok(
        existsSync(new URL('media/screenshot-wide.webp', ROOT)),
        'media/screenshot-wide.webp exists',
    );
});

test('release_attaches_checksums', () => {
    const yml = text('.github/workflows/release.yml');
    const sums = yml.search(/sha256sum\b/);
    const create = yml.search(/gh release create\b/);
    assert.ok(sums >= 0, 'the release job runs sha256sum');
    assert.ok(create >= 0, 'the release job creates the release');
    assert.ok(sums < create, 'the sums are written before the release is created');

    // The sums go outside files/ (so the file never lists itself) and are attached by name.
    assert.match(
        yml,
        /sha256sum[^\n]*>\s*\.\.\/SHA256SUMS/,
        'sums written beside files/, not into it',
    );
    const createCommand = yml.slice(create).split(/\n\s*--/)[0];
    assert.match(createCommand, /files\/\*/, 'every release file is attached');
    assert.match(createCommand, /\bSHA256SUMS\b/, 'and SHA256SUMS with them');
});
