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
        preventDefault: () => {
            prevented = true;
        },
        get prevented() {
            return prevented;
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
    const [, handler, options] = listHotkey(
        'enter',
        () => false,
        () => (played += 1),
    );
    const e = event();
    handler(e);
    assert.equal(options?.preventDefault, false);
    assert.equal(e.prevented, false);
    assert.equal(played, 0);
});

test('enter_on_the_focused_list_plays_and_keeps_the_key', () => {
    let played = 0;
    const [, handler] = listHotkey(
        'enter',
        () => true,
        () => (played += 1),
    );
    const e = event();
    handler(e);
    assert.equal(e.prevented, true);
    assert.equal(played, 1);
});

test('every_list_binding_is_a_list_hotkey', () => {
    const src = readFileSync(new URL('./use-list-hotkeys.ts', import.meta.url), 'utf8');
    const list = src.slice(src.indexOf('useHotkeys(['));
    assert.doesNotMatch(
        list,
        /if \(!isListFocused\(\)\) return;/,
        'a binding prevents while unfocused',
    );
});

/**
 * The stage 2 review's m3: B-195 was fixed for focus outside the list, not inside it. "The list has
 * focus" was `container.contains(document.activeElement)`, so with focus on a link or a button inside
 * a row (an artist link, the row's "…", the heart, a rating star) Enter still played the selection
 * instead of following the link or pressing the button. A list binding now takes the key only when
 * the focus is the list itself (or something in it that is not a control); select-all (mod+a) gives
 * way only to a text field, where it selects the field's text.
 */
type Fake = { closest: (sel: string) => Fake | null; contains: (el: unknown) => boolean };
const el = (opts: { control?: boolean; inside?: Fake; text?: boolean } = {}): Fake => {
    const self: Fake = {
        closest: (sel: string) => {
            if (sel.includes('textarea') && !sel.includes('button')) return opts.text ? self : null;
            return opts.control || opts.text ? self : null;
        },
        contains: (other) => other === self,
    };
    return self;
};
const containerOf = (...kids: Fake[]): Fake => {
    const c: Fake = {
        closest: () => null,
        contains: (other) => other === c || kids.includes(other as Fake),
    };
    return c;
};

const takes = async () => (await import('./list-hotkey.ts')).listTakesKey;

test('m3: enter on a control inside a row is the control’s', async () => {
    const listTakesKey = await takes();
    const link = el({ control: true });
    const cell = el();
    const field = el({ text: true });
    const outside = el({ control: true });
    const list = containerOf(link, cell, field);
    assert.equal(listTakesKey(list as never, list as never, 'control'), true, 'the list itself');
    assert.equal(listTakesKey(list as never, cell as never, 'control'), true, 'a plain cell');
    assert.equal(listTakesKey(list as never, link as never, 'control'), false, 'a link in a row');
    assert.equal(
        listTakesKey(list as never, outside as never, 'control'),
        false,
        'outside the list',
    );
    assert.equal(listTakesKey(list as never, null, 'control'), false);
});

test('n3: select-all gives way only to a text field', async () => {
    const listTakesKey = await takes();
    const link = el({ control: true });
    const field = el({ text: true });
    const list = containerOf(link, field);
    assert.equal(listTakesKey(list as never, link as never, 'text'), true, 'a link in a row');
    assert.equal(listTakesKey(list as never, field as never, 'text'), false, 'a text field');
    assert.equal(listTakesKey(list as never, list as never, 'text'), true);
});

test('m3: the play and open bindings leave a focused control its key', () => {
    const src = readFileSync(new URL('./use-list-hotkeys.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(
        src,
        /return container\.contains\(document\.activeElement\);/,
        'any focus inside the list counts as the list’s',
    );
    assert.match(src, /listTakesKey\(/);
});
