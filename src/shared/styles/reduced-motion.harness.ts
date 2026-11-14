import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * B-358 (the Feishin half of B-187; AUDIT-backlog-fixed-unverified-2026-11-09 chunk 7):
 *   node --test src/shared/styles/reduced-motion.harness.ts
 *
 * Reduced motion was honoured only by motion/react (`MotionConfig reducedMotion="user"`): 52 of the
 * 66 CSS modules with a transition or animation had no `prefers-reduced-motion` rule and there was
 * no global one. One global rule now ends every CSS transition and animation at once under the
 * system setting (its end events still fire, so code that waits for them goes on), and stops the
 * looping ones (the playing bars).
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');

test('one_global_rule_covers_every_css_transition_and_animation', () => {
    const css = readFileSync(path.join(ROOT, 'src/shared/styles/global.css'), 'utf8');
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
    assert.ok(at >= 0, 'no global reduced-motion rule');
    const block = css.slice(at, css.indexOf('\n}\n', at));
    assert.match(block, /\*,\s*\*::before,\s*\*::after/);
    for (const declaration of [
        /transition-duration: 0\.01ms !important;/,
        /transition-delay: 0s !important;/,
        /animation-duration: 0\.01ms !important;/,
        /animation-delay: 0s !important;/,
        /animation-iteration-count: 1 !important;/,
        /scroll-behavior: auto !important;/,
    ]) {
        assert.match(block, declaration);
    }
});

test('the_modules_that_move_are_many', () => {
    // The global rule is the cover; this only records the size of what it covers.
    const files = execFileSync('git', ['ls-files', '*.module.css'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .filter((f) => /\b(transition|animation)\s*:/.test(readFileSync(path.join(ROOT, f), 'utf8')));
    assert.ok(files.length >= 60, `${files.length} modules move`);
});
