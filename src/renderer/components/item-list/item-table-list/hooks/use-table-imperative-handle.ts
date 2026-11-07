import { useEffect, useImperativeHandle, useMemo } from 'react';

import { ItemListStateActions } from '/@/renderer/components/item-list/helpers/item-list-state';
import { dataRowIndex } from '/@/renderer/components/item-list/item-table-list/utils/group-row-index';
import { ItemListHandle } from '/@/renderer/components/item-list/types';

interface UseTableImperativeHandleProps {
    autoScrollToActiveRow: boolean;
    enableHeader: boolean;
    /** The groups' sizes: each group has a header row above it. */
    groupCounts: readonly number[];
    handleRef: React.RefObject<ItemListHandle | null>;
    internalState: ItemListStateActions;
    ref?: React.Ref<ItemListHandle>;
    scrollToTableIndex: (
        index: number,
        options?: { align?: 'bottom' | 'center' | 'top'; followActiveRow?: boolean },
    ) => void;
    scrollToTableOffset: (offset: number) => void;
}

/**
 * Hook to set up the imperative handle for ItemTableList, providing scroll methods and internal state.
 */
export const useTableImperativeHandle = ({
    autoScrollToActiveRow,
    enableHeader,
    groupCounts,
    handleRef,
    internalState,
    ref,
    scrollToTableIndex,
    scrollToTableOffset,
}: UseTableImperativeHandleProps) => {
    const imperativeHandle: ItemListHandle = useMemo(
        () => ({
            internalState,
            scrollToIndex: (index: number, options?: { align?: 'bottom' | 'center' | 'top' }) => {
                const row = dataRowIndex(groupCounts, index);
                scrollToTableIndex(enableHeader ? row + 1 : row, {
                    ...options,
                    followActiveRow: autoScrollToActiveRow,
                });
            },
            scrollToOffset: (offset: number) => {
                scrollToTableOffset(offset);
            },
        }),
        [
            autoScrollToActiveRow,
            enableHeader,
            groupCounts,
            internalState,
            scrollToTableIndex,
            scrollToTableOffset,
        ],
    );

    useImperativeHandle(ref, () => imperativeHandle);

    useEffect(() => {
        handleRef.current = imperativeHandle;
    }, [handleRef, imperativeHandle]);
};
