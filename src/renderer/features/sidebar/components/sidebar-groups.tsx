import clsx from 'clsx';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import styles from './sidebar-groups.module.css';

import { allows } from '/@/renderer/features/hub/utils/hub-roles';
import {
    useHubSupports,
    useLbBotAttention,
    useLbBotAvailable,
    useLbBotDownloadsShown,
    useListeningSupported,
    useOverridesSupported,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { toFixCount } from '/@/renderer/features/lbbot/lb-page-link';
import { useFillLedger } from '/@/renderer/features/lbbot/stores/active-fills.store';
import { LIBRARY_FRAME_ROUTES } from '/@/renderer/features/library/library-routes';
import { SidebarIcon } from '/@/renderer/features/sidebar/components/sidebar-icon';
import { SidebarItem } from '/@/renderer/features/sidebar/components/sidebar-item';
import {
    type SidebarEntry,
    type SidebarGroup,
    sidebarGroups,
    type SidebarRoutes,
} from '/@/renderer/features/sidebar/utils/sidebar-groups';
import { AppRoute } from '/@/renderer/router/routes';
import { useHubRoles } from '/@/renderer/store/hub.store';
import { useSidebarItems } from '/@/renderer/store/settings.store';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { useMediaQuery } from '/@/shared/hooks/use-media-query';

const ROUTES: SidebarRoutes = {
    activity: AppRoute.DOWNLOADS,
    fresh: AppRoute.FRESH,
    home: AppRoute.HOME,
    library: AppRoute.LIBRARY,
    libraryMatches: AppRoute.LIBRARY_MATCHES,
    listening: AppRoute.LISTENING,
    savedQueues: AppRoute.SAVED_QUEUES,
    settings: AppRoute.SETTINGS,
    wishlist: AppRoute.WISHLIST,
};

// Entry and group ids to their keys.
const LABEL_KEYS: Record<string, string> = {
    activity: 'page.sidebar.activity',
    Albums: 'page.sidebar.albums',
    app: 'page.sidebar.app',
    Artists: 'page.sidebar.albumArtists',
    'Artists-all': 'page.sidebar.artists',
    Favorites: 'page.sidebar.favorites',
    Folders: 'page.sidebar.folders',
    fresh: 'page.sidebar.fresh',
    Genres: 'page.sidebar.genres',
    home: 'page.sidebar.home',
    library: 'page.sidebar.library',
    libraryMatches: 'page.sidebar.libraryMatches',
    libraryTools: 'page.sidebar.libraryTools',
    listening: 'page.sidebar.listening',
    needsAttention: 'page.sidebar.needsAttention',
    'Now Playing': 'page.sidebar.nowPlaying',
    Playlists: 'page.sidebar.playlists',
    Radio: 'page.sidebar.radio',
    savedQueues: 'page.sidebar.savedQueues',
    Search: 'page.sidebar.search',
    settings: 'page.sidebar.settings',
    statistics: 'page.sidebar.statistics',
    Tracks: 'page.sidebar.tracks',
    wishlist: 'page.sidebar.wishlist',
    you: 'page.sidebar.you',
};

// Rows whose route is empty or shared get their glyph by name (SidebarIcon's default is Home's).
const ICON_NAMES: Record<string, 'activity' | 'attention' | 'library'> = {
    activity: 'activity',
    library: 'library',
    needsAttention: 'attention',
};

/**
 * The sidebar model for the three sidebar surfaces, translated. The only place their gates are read.
 * `fold` folds the lower groups into More; it defaults to the 1100px query (the expanded sidebar),
 * and the collapsed rail and the mobile drawer pass `{ fold: false }`.
 */
export const useSidebarModel = (options?: {
    fold?: boolean;
}): { groups: SidebarGroup[]; more: SidebarEntry[] } => {
    const { t } = useTranslation();
    const narrowQuery = useMediaQuery('(max-width: 1100px)');
    const narrow = options?.fold ?? narrowQuery;
    const lbBotAvailable = useLbBotAvailable();
    const downloadsShown = useLbBotDownloadsShown();
    const listeningSupported = useListeningSupported();
    const overridesSupported = useOverridesSupported();
    const wishlistSupported = useHubSupports('GET /lb/wishlist');
    const ledger = useFillLedger();
    const sidebarItems = useSidebarItems();
    // Worbus P2: `hub.store.user`; no user (an older hub) shows everything, as today.
    const roles = useHubRoles();
    // Worbus P4: lb-bot's imports that need you count in the badge with the ledger's failures.
    const attention = useLbBotAttention().data;
    const count = useMemo(() => toFixCount(ledger, attention), [ledger, attention]);

    return useMemo(() => {
        const label = (id: string, fallback?: string) =>
            LABEL_KEYS[id] ? t(LABEL_KEYS[id]) : fallback;
        const relabel = (entry: SidebarEntry): SidebarEntry => ({
            ...entry,
            label: label(entry.id, entry.label) as string,
        });
        const model = sidebarGroups({
            admin: allows(roles, 'needsAttention'),
            attentionCount: count,
            downloadsShown,
            lbBotAvailable,
            libraryItems: sidebarItems ?? [],
            librarySelectedRoutes: LIBRARY_FRAME_ROUTES,
            listeningSupported,
            narrow,
            overridesSupported,
            routes: ROUTES,
            wishlistSupported,
        });
        return {
            groups: model.groups.map((g) => ({
                ...g,
                entries: g.entries.map(relabel),
                label: g.label && label(g.id, g.label),
            })),
            more: model.more.map(relabel),
        };
    }, [
        count,
        downloadsShown,
        lbBotAvailable,
        listeningSupported,
        narrow,
        overridesSupported,
        roles,
        sidebarItems,
        t,
        wishlistSupported,
    ]);
};

/** Whether a path selects an entry: one of its `selectedRoutes` (the Library row), or its one route. */
export const entrySelected = (entry: SidebarEntry, pathname: string): boolean => {
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    if (entry.selectedRoutes) return entry.selectedRoutes.includes(path);
    const selected = entry.selectedRoute ?? entry.route;
    return selected !== '' && path === selected;
};

const useIsSelected = () => {
    const { pathname } = useLocation();
    return (entry: SidebarEntry) => entrySelected(entry, pathname);
};

const EntryRow = ({ entry }: { entry: SidebarEntry }) => {
    const isSelected = useIsSelected();
    const active = isSelected(entry);

    return (
        <SidebarItem
            aria-label={entry.badge ? `${entry.label}, ${entry.badge}` : undefined}
            className={clsx(styles.row, { [styles.selected]: active })}
            selectedRoutes={entry.selectedRoutes}
            selectedTo={entry.selectedRoute}
            to={entry.route}
        >
            <span className={styles.rowInner}>
                <SidebarIcon
                    active={active}
                    name={ICON_NAMES[entry.id]}
                    route={entry.route}
                    size="20"
                />
                <span className={styles.rowLabel}>{entry.label}</span>
                {entry.badge ? (
                    <span aria-hidden className={styles.badge}>
                        {entry.badge}
                    </span>
                ) : null}
            </span>
        </SidebarItem>
    );
};

/** The rows of the given groups, with a small-caps label per labelled group. */
export const SidebarGroups = ({ groups }: { groups: SidebarGroup[] }) => (
    <>
        {groups.map((group) => (
            <div className={styles.group} key={group.id}>
                {group.label && <div className={styles.groupLabel}>{group.label}</div>}
                {group.entries.map((entry) => (
                    <EntryRow entry={entry} key={entry.id} />
                ))}
            </div>
        ))}
    </>
);

/** The folded lower groups behind one row, at 1100px and under. */
export const SidebarMore = ({ entries }: { entries: SidebarEntry[] }) => {
    const { t } = useTranslation();
    const isSelected = useIsSelected();

    return (
        <DropdownMenu position="right-end">
            <DropdownMenu.Target>
                <button className={styles.row} type="button">
                    <span className={styles.rowInner}>
                        <Icon icon="ellipsisHorizontal" size="lg" />
                        <span className={styles.rowLabel}>{t('page.sidebar.more')}</span>
                        <Icon className={styles.moreChevron} icon="arrowRightS" size="md" />
                    </span>
                </button>
            </DropdownMenu.Target>
            <DropdownMenu.Dropdown>
                {entries.map((entry) => (
                    <DropdownMenu.Item
                        component={Link}
                        key={entry.id}
                        leftSection={
                            <SidebarIcon
                                active={isSelected(entry)}
                                name={ICON_NAMES[entry.id]}
                                route={entry.route}
                                size="18"
                            />
                        }
                        to={entry.route}
                    >
                        {entry.label}
                    </DropdownMenu.Item>
                ))}
            </DropdownMenu.Dropdown>
        </DropdownMenu>
    );
};
