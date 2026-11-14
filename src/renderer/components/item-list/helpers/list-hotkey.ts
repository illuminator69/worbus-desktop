import type { HotkeyItem } from '@mantine/hooks';

/**
 * B-195: a list's key binding acts, and prevents the key's default, only while the list has focus.
 * Bound app-wide (Enter plays the selection), it must leave the key to whatever has focus otherwise:
 * a link, a button, a chip.
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
