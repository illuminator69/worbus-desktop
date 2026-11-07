import { type KeyboardEvent, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './filter-bar.module.css';

import {
    chipCounts,
    type DiscographyItem,
    type DiscographyView,
    type Ownership,
} from '/@/renderer/features/discography/discography-model';
import { RELEASE_KINDS, type ReleaseKind } from '/@/renderer/features/discography/release-kind';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { TextInput } from '/@/shared/components/text-input/text-input';

const OWNERSHIPS: Ownership[] = ['owned', 'partly', 'missing', 'syncing'];
const SORTS: DiscographyView['sort'][] = ['year', 'title', 'plays', 'added'];

// The artist page binds Enter to "play the selection"; a chip keeps its own keys.
const keepKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};

interface FilterBarProps {
    /** Everything the artist has, before any filter: what the chips count. */
    items: DiscographyItem[];
    /** lb-bot knows the artist: the ownership filter means something. */
    known: boolean;
    /** The Rescan control (Task 4), at the right end. */
    rescan?: ReactNode;
    search: string;
    searchRef?: RefObject<HTMLInputElement | null>;
    setSearch: (value: string) => void;
    setView: (patch: Partial<DiscographyView>) => void;
    view: DiscographyView;
}

/**
 * The discography's filters (B-165, Call 1): a chip per release kind the artist has with its count,
 * the ownership filter, the sort and its direction. Every control writes the page's URL view and
 * nothing else; the search is the page's own and is not in the URL.
 */
export const FilterBar = ({
    items,
    known,
    rescan,
    search,
    searchRef,
    setSearch,
    setView,
    view,
}: FilterBarProps) => {
    const { t } = useTranslation();
    const counts = chipCounts(items);
    const kinds = RELEASE_KINDS.filter((kind) => (counts.byKind[kind] ?? 0) > 0);
    const ownedCount = (state: Ownership) =>
        items.filter((item) => item.ownership === state).length;
    const kindLabel = (kind: 'all' | ReleaseKind) => t(`naviConnect.discography.kind.${kind}`);
    const ownLabel = (own: 'all' | Ownership) => t(`naviConnect.discography.own.${own}`);
    const sortLabel = (sort: DiscographyView['sort']) => t(`naviConnect.discography.sort.${sort}`);

    const chip = (kind: 'all' | ReleaseKind, count: number) => (
        <button
            aria-pressed={view.type === kind}
            className={styles.chip}
            data-kind-chip={kind}
            key={kind}
            onClick={() => setView({ type: kind })}
            onKeyDown={keepKeys}
            type="button"
        >
            {kindLabel(kind)}
            <small>{count}</small>
        </button>
    );

    return (
        <div className={styles.bar} data-discography-bar="">
            <TextInput
                aria-label={t('common.search')}
                className={styles.search}
                leftSection={<Icon icon="search" />}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('common.search')}
                ref={searchRef}
                rightSection={
                    search ? (
                        <ActionIcon
                            aria-label={t('common.clear', { defaultValue: 'Clear' })}
                            icon="x"
                            onClick={() => setSearch('')}
                            size="sm"
                            variant="transparent"
                        />
                    ) : null
                }
                size="xs"
                value={search}
            />
            {chip('all', counts.all)}
            {kinds.map((kind) => chip(kind, counts.byKind[kind] ?? 0))}
            <span aria-hidden="true" className={styles.divider} />
            {known && (
                <DropdownMenu position="bottom-start">
                    <DropdownMenu.Target>
                        <button
                            className={styles.chip}
                            data-own-filter={view.own}
                            onKeyDown={keepKeys}
                            type="button"
                        >
                            <Icon icon="filter" size="sm" />
                            {t('naviConnect.discography.ownershipChip', {
                                value: ownLabel(view.own),
                            })}
                            <Icon icon="arrowDownS" size="sm" />
                        </button>
                    </DropdownMenu.Target>
                    <DropdownMenu.Dropdown>
                        {(['all', ...OWNERSHIPS] as const).map((own) => (
                            <DropdownMenu.Item
                                // A state the artist has nothing in is disabled, not hidden.
                                disabled={
                                    own !== 'all' && ownedCount(own) === 0 && view.own !== own
                                }
                                isSelected={view.own === own}
                                key={own}
                                onClick={() => setView({ own })}
                            >
                                {ownLabel(own)}
                            </DropdownMenu.Item>
                        ))}
                    </DropdownMenu.Dropdown>
                </DropdownMenu>
            )}
            <DropdownMenu position="bottom-start">
                <DropdownMenu.Target>
                    <button
                        className={styles.chip}
                        data-sort-select={view.sort}
                        onKeyDown={keepKeys}
                        type="button"
                    >
                        <Icon icon="sort" size="sm" />
                        {t('naviConnect.discography.sortChip', { value: sortLabel(view.sort) })}
                        <Icon icon="arrowDownS" size="sm" />
                    </button>
                </DropdownMenu.Target>
                <DropdownMenu.Dropdown>
                    {SORTS.map((sort) => (
                        <DropdownMenu.Item
                            isSelected={view.sort === sort}
                            key={sort}
                            onClick={() => setView({ sort })}
                        >
                            {sortLabel(sort)}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Dropdown>
            </DropdownMenu>
            <button
                aria-label={t(
                    view.dir === 'desc'
                        ? 'naviConnect.discography.dirDesc'
                        : 'naviConnect.discography.dirAsc',
                )}
                className={`${styles.chip} ${styles.iconChip}`}
                data-sort-dir={view.dir}
                onClick={() => setView({ dir: view.dir === 'desc' ? 'asc' : 'desc' })}
                onKeyDown={keepKeys}
                title={t(
                    view.dir === 'desc'
                        ? 'naviConnect.discography.dirDesc'
                        : 'naviConnect.discography.dirAsc',
                )}
                type="button"
            >
                <Icon icon={view.dir === 'desc' ? 'sortDesc' : 'sortAsc'} size="sm" />
            </button>
            {rescan && <div className={styles.end}>{rescan}</div>}
        </div>
    );
};
