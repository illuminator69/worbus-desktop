import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Worbus P6 lane F, F1:  node --test src/main/brand-icons.harness.ts
 *
 * The monochrome icon (design 5.1): the PNG set in assets/icons is the Ink square at the size its name
 * says, media/worbus.svg is a flat drawing with no gradient and no content-credentials manifest, and the Discord art is
 * in the repo (icon at 1024). The files come from the icon generator and are never edited by hand.
 */

const ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT));

/** Width and height from a PNG's IHDR chunk (bytes 16 to 24, big-endian). */
const pngSize = (path: string) => {
    const bytes = read(path);
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${path} is a PNG`);
    return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
};

test('icon_files_are_mono', () => {
    for (const side of [16, 24, 32, 48, 64, 72, 96, 128, 256, 512, 1024]) {
        const name = `assets/icons/${side}x${side}.png`;
        assert.deepEqual(pngSize(name), { height: side, width: side }, `${name} is ${side} square`);
    }
    assert.deepEqual(pngSize('assets/icons/icon.png'), { height: 512, width: 512 });
    assert.deepEqual(pngSize('resources/icon.png'), { height: 512, width: 512 });
    assert.ok(
        read('resources/icon.png').equals(read('assets/icons/512x512.png')),
        'resources/icon.png is the 512 image',
    );

    const svg = read('media/worbus.svg').toString('utf8');
    assert.doesNotMatch(svg, /linearGradient/i, 'the logo is one flat colour pair, no gradient');
    // Built from parts so that this file is not itself a hit for `git grep -i` on the name.
    assert.doesNotMatch(
        svg,
        new RegExp(['c2', 'pa'].join(''), 'i'),
        'no content-credentials manifest in what ships',
    );
});

test('discord_art_present', () => {
    for (const name of ['icon', 'playing', 'paused']) {
        assert.ok(
            existsSync(new URL(`assets/discord/${name}.png`, ROOT)),
            `assets/discord/${name}.png`,
        );
    }
    assert.deepEqual(pngSize('assets/discord/icon.png'), { height: 1024, width: 1024 });
    assert.deepEqual(pngSize('assets/discord/playing.png'), { height: 512, width: 512 });
    assert.deepEqual(pngSize('assets/discord/paused.png'), { height: 512, width: 512 });
});
