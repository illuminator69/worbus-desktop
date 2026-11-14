import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-294 (R18 workstation walk, 2026-10-30): one shelf, two titles: "Fresh" on Home, "Fresh releases"
 * on Discover (and on the Fresh page the shelf opens). The owner asked for the UI to read the same
 * from page to page: Home's shelf takes Discover's title.
 *   node --test src/renderer/features/home/fresh-title.harness.ts
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the_fresh_shelf_has_one_title', () => {
    const en = JSON.parse(read('../../../i18n/locales/en.json'));
    const discover = /id: 'fresh',[\s\S]*?title: '([^']+)'/.exec(
        read('../discover/discover-rows.ts'),
    );
    assert.ok(discover, 'the Discover row');
    assert.equal(en.page.home.fresh, discover[1]);
});
