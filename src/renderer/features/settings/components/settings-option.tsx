import React, { memo, useEffect, useId, useRef, useState } from 'react';

import styles from './settings-option.module.css';

import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

interface SettingsOptionProps {
    control: React.ReactNode;
    description?: React.ReactNode | string;
    indent?: boolean;
    /** Names people use for this row that appear in no title. Read by the section's search. */
    keywords?: readonly string[];
    note?: string;
    showDescription?: boolean;
    title: React.ReactNode | string;
}

export const SettingsOptions = memo(
    ({
        control,
        description,
        indent,
        note,
        showDescription = true,
        title,
    }: SettingsOptionProps) => {
        const reactId = useId();
        const titleId = `${reactId}-title`;
        const controlRef = useRef<HTMLDivElement>(null);
        const [controlId, setControlId] = useState<string | undefined>(undefined);

        // The title is the label of the row's control. The controls come from many components, so
        // none of them is handed an id: the first text field or switch inside the row gets one if
        // it has none, and a slider or a segmented control (which a label cannot name) is named
        // through aria-labelledby. A control that already carries an aria-label keeps it.
        useEffect(() => {
            const root = controlRef.current;
            if (!root) return;

            const field = root.querySelector<HTMLElement>(
                'input:not([type="hidden"]):not([type="radio"]), textarea, select',
            );
            if (field) {
                if (!field.id) field.id = `${reactId}-control`;
                setControlId(field.id);
                return;
            }
            setControlId(undefined);

            const widget = root.querySelector<HTMLElement>(
                '[role="slider"], [role="radiogroup"], [role="combobox"]',
            );
            if (
                widget &&
                !widget.hasAttribute('aria-label') &&
                !widget.hasAttribute('aria-labelledby')
            ) {
                widget.setAttribute('aria-labelledby', titleId);
            }
            // `control` is a new element whenever the row's owner rendered, which is when the
            // inputs inside it may have been replaced.
        }, [control, reactId, titleId]);

        return (
            <>
                <Group
                    className={indent ? styles.rowIndented : styles.row}
                    justify="space-between"
                    wrap="nowrap"
                >
                    <Stack
                        gap="xs"
                        style={{
                            display: 'flex',
                            maxWidth: '50%',
                        }}
                    >
                        <Group>
                            <Text
                                component="label"
                                htmlFor={controlId}
                                id={titleId}
                                isNoSelect
                                size="md"
                            >
                                {title}
                            </Text>
                            {note && (
                                <Tooltip label={note} openDelay={0}>
                                    <Icon icon="info" />
                                </Tooltip>
                            )}
                        </Group>
                        {showDescription &&
                            (React.isValidElement(description) ? (
                                description
                            ) : (
                                <Text isMuted isNoSelect size="sm">
                                    {description}
                                </Text>
                            ))}
                    </Stack>
                    <Group justify="flex-end" ref={controlRef}>
                        {control}
                    </Group>
                </Group>
            </>
        );
    },
);
