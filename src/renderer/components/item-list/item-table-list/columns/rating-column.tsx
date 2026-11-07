import {
    ItemTableListInnerColumn,
    TableColumnContainer,
} from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import styles from '/@/renderer/components/item-list/item-table-list/item-table-list-column.module.css';
import { ItemListItem } from '/@/renderer/components/item-list/types';
import { useIsMutatingRating } from '/@/renderer/features/shared/mutations/set-rating-mutation';
import { Rating } from '/@/shared/components/rating/rating';

export const RatingColumn = (props: ItemTableListInnerColumn) => {
    const rowItem = props.getRowItem?.(props.rowIndex) ?? (props.data as any[])[props.rowIndex];
    const row: null | number | undefined = rowItem?.[props.columns[props.columnIndex].id];

    const isMutatingRating = useIsMutatingRating();

    if (typeof row === 'number' || row === null) {
        return (
            <TableColumnContainer {...props} className={styles.ratingCell}>
                <Rating
                    busy={isMutatingRating}
                    className={row ? undefined : 'hover-only-flex'}
                    onChange={(rating) => {
                        const item = rowItem as ItemListItem;
                        const rowId = props.internalState.extractRowId(item);
                        const index = rowId ? props.internalState.findItemIndex(rowId) : -1;
                        props.controls.onRating?.({
                            event: null,
                            index,
                            internalState: props.internalState,
                            item,
                            itemType: props.itemType,
                            rating,
                        });
                    }}
                    size="xs"
                    value={row || 0}
                />
            </TableColumnContainer>
        );
    }

    return <TableColumnContainer {...props}>&nbsp;</TableColumnContainer>;
};
