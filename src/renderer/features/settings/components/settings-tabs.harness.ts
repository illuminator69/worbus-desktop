import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { tabFor, tabsFor } from './settings-tabs.ts';

/**
 * F4:  node --test src/renderer/features/settings/components/settings-tabs.harness.ts
 *
 * The Window tab became Desktop and the tab list changed, but the store keeps the last tab as a
 * free string and is not migrated. A profile that last left Settings on "window" must open on
 * Desktop, and any value that is not a tab (or is a desktop-only tab on the web) on General,
 * never on an empty panel.
 */

test('theTabsAreTheOnesTheAfterTreeNames', () => {
    assert.deepEqual(tabsFor(true), [
        'server',
        'playback',
        'appearance',
        'general',
        'hotkeys',
        'desktop',
        'advanced',
    ]);
    assert.deepEqual(tabsFor(false), ['playback', 'appearance', 'general', 'hotkeys', 'advanced']);
});

test('aStoredWindowTabOpensDesktopOnDesktop', () => {
    assert.equal(tabFor('window', true), 'desktop');
});

test('everyCurrentTabOpensItself', () => {
    for (const tab of tabsFor(true)) assert.equal(tabFor(tab, true), tab);
    for (const tab of tabsFor(false)) assert.equal(tabFor(tab, false), tab);
});

test('aTabThatDoesNotExistHereOpensGeneral', () => {
    assert.equal(tabFor('window', false), 'general');
    assert.equal(tabFor('server', false), 'general');
    assert.equal(tabFor('desktop', false), 'general');
    assert.equal(tabFor('', true), 'general');
    assert.equal(tabFor('nonsense', true), 'general');
});

test('theTabListInSettingsContentMatchesTheList', () => {
    const content = readFileSync(new URL('./settings-content.tsx', import.meta.url), 'utf8');
    const tabs = [...content.matchAll(/<Tabs\.Tab value="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, tabsFor(true));
    const panels = [...content.matchAll(/panel\('(\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(panels, tabsFor(true));
    assert.match(content, /tabFor\(storedTab, desktop\)/);
    for (const tab of ['server', 'desktop']) {
        const at = content.indexOf(`<Tabs.Tab value="${tab}"`);
        assert.match(content.slice(at - 80, at), /desktop && \(/, `${tab} is a desktop-only tab`);
        assert.match(
            content,
            new RegExp(`desktop && panel\\('${tab}'`),
            `${tab} is a desktop-only panel`,
        );
    }
});
