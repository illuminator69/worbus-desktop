import { RefObject, useEffect, useState } from 'react';

import { shellPinnedTop } from '/@/renderer/components/item-list/item-table-list/utils/shell-pinned-top';
import { useWindowSettings } from '/@/renderer/store/settings.store';

/**
 * The viewport top, in px, of the bottom of the page's sticky title row: where the table pins its
 * header. Read from the shell's variables through `ref`, again when the window-bar style changes
 * (the layout's `.windows` / `.macos` class sets `--window-bar-height`).
 *
 * A passive effect on purpose: the table's container is an ancestor of the components that call
 * this, and React attaches an ancestor's ref after its children's layout effects have run, so a
 * layout effect would read a null ref on the first mount. Nothing pins in the first frame (the
 * header starts in view), so reading after paint costs nothing.
 */
export const useShellPinnedTop = (ref: RefObject<HTMLElement | null>): number => {
    const { windowBarStyle } = useWindowSettings();
    const [top, setTop] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        setTop(shellPinnedTop(getComputedStyle(el)));
    }, [ref, windowBarStyle]);

    return top;
};
