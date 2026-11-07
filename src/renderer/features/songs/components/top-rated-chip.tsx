import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import styles from './top-rated-chip.module.css';

import { useSortByFilter } from '/@/renderer/features/shared/hooks/use-sort-by-filter';
import { useSortOrderFilter } from '/@/renderer/features/shared/hooks/use-sort-order-filter';
import { FILTER_KEYS } from '/@/renderer/features/shared/utils';
import { useSongListFilters } from '/@/renderer/features/songs/hooks/use-song-list-filters';
import { setMultipleSearchParams } from '/@/renderer/utils/query-params';
import { runInUrlTransition } from '/@/renderer/utils/url-transition';
import { Icon } from '/@/shared/components/icon/icon';
import { SongListSort, SortOrder } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

/**
 * F6 (Call 11): Top rated is "every rated song, best first": Navidrome's `has_rating` filter and the
 * rating sort, descending. Selected while both hold; changing either by hand deselects it, and
 * deselecting puts back the sort it replaced. Only rendered where the server can filter by rating.
 */
export const TopRatedChip = () => {
    const { t } = useTranslation();
    const pageKey = ItemListKey.SONG;
    const [, setSearchParams] = useSearchParams();
    const { query } = useSongListFilters(pageKey);
    const { sortBy } = useSortByFilter<SongListSort>(SongListSort.NAME, pageKey);
    const { sortOrder } = useSortOrderFilter(SortOrder.ASC, pageKey);
    const replaced = useRef<null | { sortBy: SongListSort; sortOrder: SortOrder }>(null);

    const selected =
        query.hasRating === true && sortBy === SongListSort.RATING && sortOrder === SortOrder.DESC;

    // One URL update for all three keys: separate setters in the same tick overwrite each other. Only the
    // URL: the saved sort stays the one you chose, so leaving Tracks and coming back drops Top rated and
    // its sort together (`hasRating` is never saved).
    const apply = (
        hasRating: null | true,
        next: { sortBy: SongListSort; sortOrder: SortOrder },
    ) => {
        runInUrlTransition(() => {
            setSearchParams(
                (prev) =>
                    setMultipleSearchParams(prev, {
                        [FILTER_KEYS.SHARED.SORT_BY]: next.sortBy,
                        [FILTER_KEYS.SHARED.SORT_ORDER]: next.sortOrder,
                        [FILTER_KEYS.SONG.HAS_RATING]: hasRating,
                    }),
                { replace: true },
            );
        });
    };

    const toggle = () => {
        if (selected) {
            apply(
                null,
                replaced.current ?? { sortBy: SongListSort.NAME, sortOrder: SortOrder.ASC },
            );
            replaced.current = null;
            return;
        }
        replaced.current = { sortBy, sortOrder };
        apply(true, { sortBy: SongListSort.RATING, sortOrder: SortOrder.DESC });
    };

    return (
        <button
            aria-pressed={selected}
            className={styles.chip}
            data-top-rated
            onClick={toggle}
            onKeyDown={(event) => {
                // The list binds Enter app-wide and prevents its default; this button keeps it.
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
            }}
            type="button"
        >
            <Icon fill={selected ? 'inherit' : undefined} icon="star" size="sm" />
            {t('page.library.topRated')}
        </button>
    );
};
