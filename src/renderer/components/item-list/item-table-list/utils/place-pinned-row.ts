import { pinnedRowBox } from '/@/renderer/components/item-list/item-table-list/utils/shell-pinned-top';
import { setWashOrigin } from '/@/renderer/features/shared/components/wash-underlay';

const write = (row: HTMLElement, name: 'left' | 'top' | 'width', px: number) => {
    const value = `${px}px`;
    // Unchanged values are not written again: a scroll places every frame and most frames move nothing.
    if (row.style[name] !== value) row.style[name] = value;
};

/**
 * Write a pinned row (`position: fixed`) so it sits at viewport `top`, spanning `table`. The block it
 * is fixed to is read off the row itself: its on-screen corner minus its own `left` / `top`, so the
 * row lands right whether that block is the viewport or a transformed ancestor (B-221).
 */
export const placePinnedRow = (row: HTMLElement, table: HTMLElement, top: number) => {
    const style = getComputedStyle(row);
    const rect = row.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const box = pinnedRowBox({
        blockOrigin: {
            x: rect.left - (Number.parseFloat(style.left) || 0),
            y: rect.top - (Number.parseFloat(style.top) || 0),
        },
        table: { left: tableRect.left, width: tableRect.width },
        top,
    });
    write(row, 'top', box.top);
    write(row, 'left', box.left);
    write(row, 'width', box.width);
    // Its viewport corner, for the wash drawn under it (WashUnderlay): the page's colour at that spot.
    setWashOrigin(row, tableRect.left, top);
};
