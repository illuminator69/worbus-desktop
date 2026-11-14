import type { HotkeyItem } from '@mantine/hooks';

/**
 * B-195: a list's key binding acts, and prevents the key's default, only while the list takes the
 * key. Bound app-wide (Enter plays the selection), it must leave the key to whatever has focus
 * otherwise: a link, a button, a chip.
 */
export const listHotkey = (
    hotkey: string,
    isListFocused: () => boolean,
    act: () => void,
): HotkeyItem => [
    hotkey,
    (event) => {
        if (!isListFocused()) return;
        event.preventDefault();
        act();
    },
    { preventDefault: false },
];

/** A focused element that answers Enter (and Space) itself. */
const CONTROL =
    'a[href], button, input, select, textarea, [contenteditable=""], [contenteditable="true"], ' +
    '[role="button"], [role="checkbox"], [role="link"], [role="menuitem"], [role="radio"], ' +
    '[role="slider"], [role="switch"], [role="tab"]';
/** A focused element whose select-all is its own text's. */
const TEXT_FIELD = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

/**
 * The stage 2 review's m3 and n3: whether a list binding takes the key, given the list's container
 * and the focused element. Only focus within the list counts; within it, a focused control keeps its
 * key (`'control'`: Enter on an artist link follows it, on the row's "…" opens the menu), or only a
 * focused text field does (`'text'`: select-all, which selects the field's text there).
 */
export const listTakesKey = (
    container: Element,
    active: Element | null,
    keepFor: 'control' | 'text',
): boolean => {
    if (!active || !container.contains(active)) return false;
    if (active === container) return true;
    const own = active.closest(keepFor === 'control' ? CONTROL : TEXT_FIELD);
    return !own || !container.contains(own);
};
