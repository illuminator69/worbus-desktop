import { DragControls, Reorder, useDragControls } from 'motion/react';
import { CSSProperties } from 'react';

import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

const DragHandle = ({
    dragControls,
    styles,
}: {
    dragControls: DragControls;
    styles?: CSSProperties;
}) => {
    return (
        <ActionIcon
            icon="dragVertical"
            iconProps={{
                size: 'md',
            }}
            onPointerDown={(event) => dragControls.start(event)}
            size="xs"
            style={{ cursor: 'grab', ...styles }}
            variant="transparent"
        />
    );
};

export interface DraggableItemProps {
    handleChangeDisabled: (id: string, e: boolean) => void;
    isReorderable?: boolean;
    item: SidebarItem;
    /** A row whose switch no longer does anything: shown on, disabled, with this note under it. */
    lockedNote?: string;
    value: string;
}

interface SidebarItem {
    disabled: boolean;
    id: string;
}

export const DraggableItem = ({
    handleChangeDisabled,
    isReorderable = true,
    item,
    lockedNote,
    value,
}: DraggableItemProps) => {
    const dragControls = useDragControls();

    const content = (
        <Group py="md" style={{ boxShadow: '0 1px 3px rgba(0,0,0,.1)' }} wrap="nowrap">
            <Checkbox
                checked={lockedNote ? true : !item.disabled}
                disabled={Boolean(lockedNote)}
                onChange={(e) => handleChangeDisabled(item.id, e.target.checked)}
                size="xs"
            />
            <DragHandle
                dragControls={dragControls}
                styles={{ visibility: isReorderable ? 'visible' : 'hidden' }}
            />
            {lockedNote ? (
                <Stack gap={0}>
                    <Text>{value}</Text>
                    <Text isMuted size="sm">
                        {lockedNote}
                    </Text>
                </Stack>
            ) : (
                <Text>{value}</Text>
            )}
        </Group>
    );

    if (!isReorderable) {
        return <div>{content}</div>;
    }

    return (
        <Reorder.Item as="div" dragControls={dragControls} dragListener={false} value={item}>
            {content}
        </Reorder.Item>
    );
};
