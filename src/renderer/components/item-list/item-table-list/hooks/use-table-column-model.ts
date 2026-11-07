import { useMemo } from 'react';

import { parseTableColumns } from '/@/renderer/components/item-list/helpers/parse-table-columns';
import { fitColumnWidths } from '/@/renderer/components/item-list/item-table-list/utils/fit-column-widths';
import { ItemTableListColumnConfig } from '/@/renderer/components/item-list/types';

export const useTableColumnModel = ({
    autoFitColumns,
    centerContainerWidth,
    columns,
    totalContainerWidth,
}: {
    autoFitColumns: boolean;
    centerContainerWidth: number;
    columns: ItemTableListColumnConfig[];
    totalContainerWidth: number;
}) => {
    const parsedColumns = useMemo(() => parseTableColumns(columns), [columns]);

    const calculatedColumnWidths = useMemo(() => {
        const baseWidths = parsedColumns.map((c) => c.width);

        // When autoSizeColumns is enabled, treat unpinned widths as proportions and scale to fit
        // the container, never below a column's minimum (B-264): when the minimums overflow by
        // one column's minimum or more, the table scrolls sideways; by less, it shrinks to fit
        // (B-267). Pinned columns keep their base width.
        if (autoFitColumns) {
            return fitColumnWidths(parsedColumns, totalContainerWidth);
        }

        // Original behavior: distribute extra space to auto-size columns
        const distributed = baseWidths.slice();
        const unpinnedIndices: number[] = [];
        const autoUnpinnedIndices: number[] = [];

        parsedColumns.forEach((col, idx) => {
            if (col.pinned === null) {
                unpinnedIndices.push(idx);
                if (col.autoSize) {
                    autoUnpinnedIndices.push(idx);
                }
            }
        });

        if (unpinnedIndices.length === 0 || autoUnpinnedIndices.length === 0) {
            return distributed.map((width) => Math.round(width));
        }

        const unpinnedBaseTotal = unpinnedIndices.reduce((sum, idx) => sum + baseWidths[idx], 0);
        const extra = Math.max(0, centerContainerWidth - unpinnedBaseTotal);
        if (extra <= 0) {
            return distributed.map((width) => Math.round(width));
        }

        const extraPer = extra / autoUnpinnedIndices.length;
        autoUnpinnedIndices.forEach((idx) => {
            distributed[idx] = Math.round(baseWidths[idx] + extraPer);
        });

        return distributed.map((width) => Math.round(width));
    }, [autoFitColumns, centerContainerWidth, parsedColumns, totalContainerWidth]);

    const pinnedLeftColumnCount = useMemo(
        () => parsedColumns.filter((col) => col.pinned === 'left').length,
        [parsedColumns],
    );
    const pinnedRightColumnCount = useMemo(
        () => parsedColumns.filter((col) => col.pinned === 'right').length,
        [parsedColumns],
    );

    const columnCount = parsedColumns.length;
    const totalColumnCount = columnCount - pinnedLeftColumnCount - pinnedRightColumnCount;

    return useMemo(
        () => ({
            calculatedColumnWidths,
            columnCount,
            parsedColumns,
            pinnedLeftColumnCount,
            pinnedRightColumnCount,
            totalColumnCount,
        }),
        [
            calculatedColumnWidths,
            columnCount,
            parsedColumns,
            pinnedLeftColumnCount,
            pinnedRightColumnCount,
            totalColumnCount,
        ],
    );
};
