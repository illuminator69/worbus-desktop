import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * R5:  node --test src/shared/components/animations/one-clock.harness.ts
 *
 * One gesture, one animation clock (audit A-06, B-206). Upstream's motion layer must not run beside
 * the kit's on the same gesture: lists fade once (the page's fade), the sidebar crossfade keeps the
 * grid tween's clock, the carousel pages by the kit's rise, the player bar projects no layout.
 */

const src = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, src), 'utf8');

test('listsHaveNoOwnFade', () => {
    for (const path of [
        'renderer/components/item-list/item-grid-list/item-grid-list.tsx',
        'renderer/components/item-list/item-table-list/item-table-list.tsx',
    ]) {
        assert.ok(!read(path).includes('animationProps.fadeIn'), path);
    }
});

test('sidebarHasNoSecondClock', () => {
    const sidebar = read('renderer/layouts/default-layout/left-sidebar.tsx');
    assert.ok(!sidebar.includes('DURATION.medium1'));
    assert.ok(!sidebar.includes('EASING.emphasized'));
});

test('motionClockParsesTheCssVariables', async () => {
    const { FALLBACK_CLOCK, parseCssBezier, parseCssTime } = await import('./motion-tokens.ts');
    assert.equal(parseCssTime('300ms'), 300);
    assert.equal(parseCssTime(' 0.3s '), 300);
    assert.equal(parseCssTime('var(--x)'), undefined);
    assert.deepEqual(parseCssBezier('cubic-bezier(0.3, 0.7, 0.2, 1)'), [0.3, 0.7, 0.2, 1]);
    assert.deepEqual(parseCssBezier(' cubic-bezier(.3,.7,.2,1)'), [0.3, 0.7, 0.2, 1]);
    assert.equal(parseCssBezier('var(--fold-ease)'), undefined);
    // The fallback is the value global.css sets, so a failed read changes nothing.
    const css = read('shared/styles/global.css');
    assert.ok(css.includes(`--fold-ease: cubic-bezier(${FALLBACK_CLOCK.ease.join(', ')});`));
    assert.ok(css.includes(`--motion-duration: ${FALLBACK_CLOCK.ms}ms;`));
    // The crossfade and the grid tween both read --motion-ease, so it must stay the fold's curve.
    assert.ok(css.includes('--motion-ease: var(--fold-ease);'));
});

test('carouselSlidesEightPx', () => {
    const carousel = read('renderer/components/grid-carousel/grid-carousel-v2.tsx');
    const variants = carousel.slice(
        carousel.indexOf('interface PageCustom'),
        carousel.indexOf('function BaseGridCarousel'),
    );
    assert.ok(variants.length > 0);
    assert.ok(!/\b100\b/.test(variants), 'no 100 px offset');
    assert.ok(/KIT_RISE_PX/.test(variants) && /KIT_MS/.test(variants) && /KIT_EASE/.test(variants));
    assert.ok(carousel.includes("/@/shared/components/animations/motion-tokens'"));
});

test('kitTokensMatchTheCssKit', async () => {
    const { KIT_EASE, KIT_MS, KIT_RISE_PX } = await import('./motion-tokens.ts');
    const css = read('shared/styles/global.css');
    assert.ok(css.includes(`--arrive-ease: cubic-bezier(${KIT_EASE.join(', ')});`));
    assert.ok(css.includes(`--arrive-ms: ${KIT_MS}ms;`));
    assert.ok(
        read('renderer/features/motion/arrival.module.css').includes(
            `translateY(${KIT_RISE_PX}px)`,
        ),
    );
});

test('barHasNoLayoutProjection', () => {
    const bar = read('renderer/features/player/components/left-controls.tsx');
    assert.ok(!bar.includes('LayoutGroup'));
    assert.ok(!bar.includes('layout='));
    // The cover mounts when the sidebar collapses, so a CSS fade on it would be a second clock.
    const barCss = read('renderer/features/player/components/left-controls.module.css');
    assert.ok(!barCss.includes('fadein'));
    assert.ok(!/\banimation\s*:/.test(barCss));
});
