import { Rating as MantineRating, RatingProps as MantineRatingProps } from '@mantine/core';
import clsx from 'clsx';
import debounce from 'lodash/debounce';
import { useEffect, useMemo, useRef } from 'react';

import styles from './rating.module.css';

import { arrowMoveValue, nextRating } from '/@/shared/components/rating/rating-logic';

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
    // B-368: one debounce per Rating, so quick changes merge across renders, deciding with the
    // props of the moment it fires (a star chosen again clears against the value then).
    const latest = useRef({ busy, onChange, value: props.value });
    latest.current = { busy, onChange, value: props.value };
    const change = useMemo(
        () =>
            debounce((rating: number, toggles: boolean) => {
                const now = latest.current;
                if (now.busy || !now.onChange) return;
                now.onChange(toggles ? nextRating(rating, now.value) : rating);
            }, 100),
        [],
    );
    // A change made just before the stars go away still counts.
    useEffect(() => () => change.flush(), [change]);

    // B-259: the last key pressed on the stars, to tell an arrow's move from any other click.
    const lastKey = useRef<null | string>(null);

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
            onChange={(rating) => change(rating, true)}
            onClick={(e) => {
                const moved = arrowMoveValue(e.target as HTMLInputElement, lastKey.current);
                lastKey.current = null;
                if (moved !== null) {
                    // The stars are a radio group: an arrow selects (Mantine only previews it),
                    // and the move is the browser's, so its default stays.
                    change(moved, false);
                } else if (preventDefault) {
                    e.preventDefault();
                }
                if (stopPropagation) {
                    e.stopPropagation();
                }
            }}
            onKeyDownCapture={(e) => {
                lastKey.current = e.key;
            }}
            onPointerDownCapture={() => {
                lastKey.current = null;
            }}
        />
    );
};
