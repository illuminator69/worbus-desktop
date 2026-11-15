import type { SegmentedControlProps as MantineSegmentedControlProps } from '@mantine/core';

import { SegmentedControl as MantineSegmentedControl } from '@mantine/core';
import clsx from 'clsx';
import { forwardRef } from 'react';

import styles from './segmented-control.module.css';

import chipStyles from '/@/shared/components/chip/chip.module.css';

type SegmentedControlProps = MantineSegmentedControlProps;

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
    ({ classNames, size = 'sm', ...props }: SegmentedControlProps, ref) => {
        const ownLabel = (classNames as undefined | { label?: string })?.label;
        return (
            <MantineSegmentedControl
                classNames={{
                    control: styles.control,
                    indicator: styles.indicator,
                    root: styles.root,
                    ...classNames,
                    // B-293: every label reacts to the pointer as the fork's chips do; a caller's
                    // own label class replaces this one's look, never the response. A read-only
                    // control offers no choice, so it does not react.
                    label: clsx(!props.readOnly && chipStyles.chip, ownLabel ?? styles.label),
                }}
                ref={ref}
                size={size}
                transitionDuration={250}
                transitionTimingFunction="linear"
                {...props}
            />
        );
    },
);
