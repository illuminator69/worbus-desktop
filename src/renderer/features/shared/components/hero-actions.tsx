import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
    heroActionsMode,
    type HeroActionsMode,
    type HeroActionsWidths,
    naturalRowWidth,
    rememberWidth,
} from './hero-actions-fit';
import styles from './hero-actions.module.css';

import { useIsMutatingCreateFavorite } from '/@/renderer/features/shared/mutations/create-favorite-mutation';
import { useIsMutatingDeleteFavorite } from '/@/renderer/features/shared/mutations/delete-favorite-mutation';
import { useIsMutatingRating } from '/@/renderer/features/shared/mutations/set-rating-mutation';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { AppIconSelection, Icon } from '/@/shared/components/icon/icon';
import { Rating } from '/@/shared/components/rating/rating';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

/** One labelled button in the row: a link when it has `to`, a button otherwise. */
export interface HeroAction {
    /** Disabled with a spinner in place of its icon (the player fetching a radio). */
    busy?: boolean;
    /** Required: a narrow column folds the button to it (B-284). */
    icon: AppIconSelection;
    key: string;
    label: string;
    onClick?: () => void;
    to?: string;
    variant: 'accent-outline' | 'filled' | 'outline';
}

interface HeroActionsProps {
    actions: HeroAction[];
    favorite?: boolean;
    onFavorite?: () => void;
    onMore?: (e: MouseEvent<HTMLButtonElement>) => void;
    onPlay: () => void;
    onRating?: (n: number) => void;
    rating?: number;
}

/**
 * The board's action row under a hero header (`.cta`): the round Play on the accent, the labelled
 * buttons, then rating, favourite and more at the right.
 *
 * B-284: it keeps one line as long as it can, because the hero sits its photo on the text column's
 * bottom edge and a second line hangs the photo below the title. A column narrower than the row
 * folds the labelled buttons to their icons (the label stays their name and their tooltip); only a
 * column narrower than that wraps, the end group then starting its line at the left. The mode comes
 * from the row's own measured widths (`hero-actions-fit.ts`), re-measured whenever the row or an
 * item changes size, a mode is shown or a web font arrives, and set before paint, so a resize never
 * shows a wrapped row first. The full row never wraps, so folding it leaves the row's height alone
 * (no "ResizeObserver loop" error); only a folded row wraps, in layout, when even it does not fit.
 */
export const HeroActions = ({
    actions,
    favorite,
    onFavorite,
    onMore,
    onPlay,
    onRating,
    rating,
}: HeroActionsProps) => {
    const { t } = useTranslation();
    const isMutatingRating = useIsMutatingRating();
    const isMutatingCreateFavorite = useIsMutatingCreateFavorite();
    const isMutatingDeleteFavorite = useIsMutatingDeleteFavorite();
    const isMutatingFavorite = isMutatingCreateFavorite || isMutatingDeleteFavorite;

    // A web font arriving after the first measure: the labels' width changes even while they are
    // hidden (icons), where no observer can see it, so both widths are measured again.
    const [fontsLoaded, setFontsLoaded] = useState(0);
    useEffect(() => {
        const onLoaded = () => setFontsLoaded((count) => count + 1);
        document.fonts.addEventListener('loadingdone', onLoaded);
        return () => document.fonts.removeEventListener('loadingdone', onLoaded);
    }, []);

    // What the row holds: a change (a language, the rating switched on, a font) invalidates both
    // widths.
    const contentKey = JSON.stringify([
        actions.map((action) => [action.label, action.icon]),
        !!onRating,
        !!onFavorite,
        !!onMore,
        fontsLoaded,
    ]);
    const rowRef = useRef<HTMLDivElement>(null);
    const [fit, setFit] = useState<{ mode: HeroActionsMode; widths: HeroActionsWidths }>(() => ({
        mode: 'full',
        widths: { key: contentKey },
    }));
    const { mode } = fit;
    const folded = mode !== 'full';

    // Measures what is on screen (the mode last committed) and decides again. Read from effects
    // only, through a ref, so the observer below always runs the latest one.
    const measureRef = useRef<() => void>(() => {});
    useLayoutEffect(() => {
        measureRef.current = () => {
            const row = rowRef.current;
            if (!row) return;
            const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
            const items = Array.from(row.children, (item) => item.getBoundingClientRect().width);
            const available = row.getBoundingClientRect().width;
            setFit((previous) => {
                const widths = rememberWidth(
                    previous.widths,
                    contentKey,
                    previous.mode,
                    naturalRowWidth(items, gap),
                );
                const next = heroActionsMode(available, widths);
                return widths === previous.widths && next === previous.mode
                    ? previous
                    : { mode: next, widths };
            });
        };
        // A new mode or new contents is measured before the browser paints it. Not on every
        // render: a parent re-rendering (the player) must not force a layout read.
        measureRef.current();
    }, [mode, contentKey]);

    useEffect(() => {
        const row = rowRef.current;
        if (!row) return undefined;
        // The column resizing, and an item resizing (a font arriving, the rating appearing).
        // Flushed at once so the new mode is laid out in the same frame as the resize.
        const observer = new ResizeObserver(() => flushSync(() => measureRef.current()));
        observer.observe(row);
        for (const item of Array.from(row.children)) observer.observe(item);
        return () => observer.disconnect();
    }, [contentKey]);

    return (
        <div className={styles.row} data-mode={mode} ref={rowRef}>
            <button
                aria-label={t('player.play')}
                className={styles.play}
                onClick={onPlay}
                type="button"
            >
                <Icon icon="mediaPlay" size={22} />
            </button>
            {actions.map((action) => {
                const content = (
                    <>
                        {action.busy ? (
                            <Spinner size={16} />
                        ) : (
                            <Icon icon={action.icon} size={16} />
                        )}
                        <span className={styles.label}>{action.label}</span>
                    </>
                );
                return (
                    <Tooltip disabled={!folded} key={action.key} label={action.label}>
                        {action.to ? (
                            <Link
                                aria-label={folded ? action.label : undefined}
                                className={styles.button}
                                data-variant={action.variant}
                                onClick={action.onClick}
                                to={action.to}
                            >
                                {content}
                            </Link>
                        ) : (
                            <button
                                aria-busy={action.busy || undefined}
                                aria-label={folded ? action.label : undefined}
                                className={styles.button}
                                data-variant={action.variant}
                                disabled={action.busy}
                                onClick={action.onClick}
                                type="button"
                            >
                                {content}
                            </button>
                        )}
                    </Tooltip>
                );
            })}
            {(onRating || onFavorite || onMore) && (
                <div className={styles.end}>
                    {onRating && (
                        <Rating
                            onChange={onRating}
                            readOnly={isMutatingRating}
                            size="md"
                            value={rating || 0}
                        />
                    )}
                    {onFavorite && (
                        <ActionIcon
                            aria-label={t(
                                favorite ? 'action.removeFromFavorites' : 'action.addToFavorites',
                            )}
                            disabled={isMutatingFavorite}
                            icon="favorite"
                            iconProps={{ fill: favorite ? 'primary' : undefined }}
                            onClick={onFavorite}
                            size="lg"
                            variant="transparent"
                        />
                    )}
                    {onMore && (
                        <ActionIcon
                            aria-label={t('page.library.more')}
                            icon="ellipsisHorizontal"
                            onClick={onMore}
                            size="lg"
                            variant="transparent"
                        />
                    )}
                </div>
            )}
        </div>
    );
};
