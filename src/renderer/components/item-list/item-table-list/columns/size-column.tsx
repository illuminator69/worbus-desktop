import { useMemo } from 'react';

import {
    ColumnNullFallback,
    ColumnSkeletonFixed,
    ItemTableListInnerColumn,
    TableColumnTextContainer,
} from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { compactSize } from '/@/renderer/utils/compact-number';

/** B-274: three significant digits ("156 KiB"), so it reads whole at the column's floor. */
const SizeColumnBase = (props: ItemTableListInnerColumn) => {
    const rowItem = props.getRowItem?.(props.rowIndex) ?? (props.data as any[])[props.rowIndex];
    const row: number | undefined = (rowItem as any)?.[props.columns[props.columnIndex].id];

    const formattedSize = useMemo(() => {
        return typeof row === 'number' ? compactSize(row) : null;
    }, [row]);

    if (typeof row === 'number') {
        return <TableColumnTextContainer {...props}>{formattedSize}</TableColumnTextContainer>;
    }

    if (row === null) {
        return <ColumnNullFallback {...props} />;
    }

    return <ColumnSkeletonFixed {...props} />;
};

export const SizeColumn = SizeColumnBase;
