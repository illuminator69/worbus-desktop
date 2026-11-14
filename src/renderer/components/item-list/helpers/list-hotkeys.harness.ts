import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { withPhysicalKeys } from '../../../../shared/utils/hotkeys.ts';
import { listHotkey } from './list-hotkey.ts';

/**
 * B-195 (VM 2026-10-22, F6 walk):
 *   node --test src/renderer/components/item-list/helpers/list-hotkeys.harness.ts
 *
 * Enter did nothing on a focused link or button while any list page was mounted: `listPlayDefault`
 * is bound to Enter app-wide, the handler returns early when the list is not focused, and the
 * default was prevented anyway (Mantine's `preventDefault`, forced on for every binding by
 * `withPhysicalKeys`). A list hotkey now prevents the default only when the list takes the key.
 */

const event = () => {
    let prevented = false;
    return {
        get prevented() {
            return prevented;
        },
        preventDefault: () => {
            prevented = true;
        },
    } as unknown as KeyboardEvent & { prevented: boolean };
};

test('a_binding_may_leave_the_default_alone', () => {
    const [[, , kept], [, , other]] = withPhysicalKeys([
        ['enter', () => {}, { preventDefault: false }],
        ['mod+k', () => {}],
    ]);
    assert.equal(kept?.preventDefault, false, 'withPhysicalKeys forces preventDefault on');
    assert.equal(other?.preventDefault, true, 'the other bindings keep preventing');
});

test('enter_reaches_a_focused_link_when_the_list_is_not_focused', () => {
    let played = 0;
    const [, handler, options] = listHotkey('enter', () => false, () => (played += 1));
    const e = event();
    handler(e);
    assert.equal(options?.preventDefault, false);
    assert.equal(e.prevented, false);
    assert.equal(played, 0);
});

test('enter_on_the_focused_list_plays_and_keeps_the_key', () => {
    let played = 0;
    const [, handler] = listHotkey('enter', () => true, () => (played += 1));
    const e = event();
    handler(e);
    assert.equal(e.prevented, true);
    assert.equal(played, 1);
});

test('every_list_binding_is_a_list_hotkey', () => {
    const src = readFileSync(new URL('./use-list-hotkeys.ts', import.meta.url), 'utf8');
    const list = src.slice(src.indexOf('useHotkeys(['));
    assert.doesNotMatch(list, /if \(!isListFocused\(\)\) return;/, 'a binding prevents while unfocused');
});
