import { Rating as MantineRating, RatingProps as MantineRatingProps } from '@mantine/core';
import clsx from 'clsx';
import debounce from 'lodash/debounce';
import { useCallback } from 'react';

import styles from './rating.module.css';

interface RatingProps extends MantineRatingProps {
    /**
     * A save is in flight: a change is dropped, but the stars keep their inputs, so a keyboard user's
     * focus stays on them (`readOnly` removes the inputs, and focus falls to the page).
     */
    busy?: boolean;
    preventDefault?: boolean;
    stopPropagation?: boolean;
}

export const Rating = ({
    busy = false,
    classNames,
    onChange,
    preventDefault = true,
    size,
    stopPropagation = true,
    style,
    ...props
}: RatingProps) => {
    const valueChange = useCallback(
        (rating: number) => {
            if (busy) return;
            if (onChange) {
                if (rating === props.value) {
                    onChange(0);
                } else {
                    onChange(rating);
                }
            }
        },
        [busy, onChange, props.value],
    );

    const debouncedOnChange = debounce(valueChange, 100);

    return (
        <MantineRating
            classNames={{
                root: clsx(styles.root, {
                    [styles.lg]: size === 'lg',
                    [styles.md]: size === 'md',
                    [styles.sm]: size === 'sm',
                    [styles.xl]: size === 'xl',
                    [styles.xs]: size === 'xs',
                }),
                symbolBody: styles.symbolBody,
                ...classNames,
            }}
            style={{
                ...style,
            }}
            {...props}
            onChange={(e) => {
                debouncedOnChange(e);
            }}
            onClick={(e) => {
                if (preventDefault) {
                    e.preventDefault();
                }
                if (stopPropagation) {
                    e.stopPropagation();
                }
            }}
        />
    );
};
