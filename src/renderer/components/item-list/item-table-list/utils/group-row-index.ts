// Pure: data index <-> row index in a table with one header row above each group. `counts` are
// the groups' sizes in order. The column header, when the table has one, is the caller's offset.

/** The data index on a row, or null for a header row. */
export function dataIndexOfRow(counts: readonly number[], rowIndex: number): null | number {
    if (counts.length === 0) return rowIndex;
    let row = 0;
    let data = 0;
    for (const count of counts) {
        if (rowIndex === row) return null;
        if (rowIndex <= row + count) return data + (rowIndex - row - 1);
        row += count + 1;
        data += count;
    }
    return data + (rowIndex - row);
}

/** The row a data row lands on: its data index plus the headers of the groups that start at or before it. */
export function dataRowIndex(counts: readonly number[], dataIndex: number): number {
    let headers = 0;
    let start = 0;
    for (const count of counts) {
        if (start > dataIndex) break;
        headers += 1;
        start += count;
    }
    return dataIndex + headers;
}
