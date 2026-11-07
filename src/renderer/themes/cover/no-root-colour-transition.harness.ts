import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * R1 Task 3:  node --test src/renderer/themes/cover/no-root-colour-transition.harness.ts
 *
 * The cover colours must never be transitioned as inherited custom properties again: easing 22 of
 * them on `:root` restyled every element on every frame of a track change (audit A-01, about 284 ms
 * of style work per change). The wash's backdrop cross-fades its own layers instead.
 */

const src = new URL('../../../', import.meta.url);

test('globalCssTransitionsNoColourRole', () => {
    const css = readFileSync(new URL('shared/styles/global.css', src), 'utf8');
    for (const match of css.matchAll(/transition-property\s*:([^;]*);/g)) {
        assert.ok(!/--theme-colors-|--wash-/.test(match[1]), match[0]);
    }
    for (const match of css.matchAll(/transition\s*:([^;]*);/g)) {
        assert.ok(!/--theme-colors-|--wash-/.test(match[1]), match[0]);
    }
});

test('noFileSetsTheEaseAttribute', () => {
    const hits = (readdirSync(src, { recursive: true }) as string[]).filter((path) => {
        if (!/\.(css|ts|tsx)$/.test(path) || path.endsWith('.harness.ts')) return false;
        return readFileSync(new URL(path, src), 'utf8').includes('data-cover-wash-ease');
    });
    assert.deepEqual(hits, []);
});
