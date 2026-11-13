import clsx from 'clsx';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import styles from './sidebar-groups.module.css';

import { allows } from '/@/renderer/features/hub/utils/hub-roles';
import {
    useHubSupports,
    useLbBotActivity,
    useLbBotAttention,
    useLbBotAvailable,
    useLbBotDownloadsShown,
    useListeningSupported,
    useOverridesSupported,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { libraryToFixCount } from '/@/renderer/features/lbbot/lb-page-link';
import { useFillLedger } from '/@/renderer/features/lbbot/stores/active-fills.store';
import { needYouCount } from '/@/renderer/features/lbbot/utils/need-you';
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

// B-406: what each badge counts, said on hover and to a screen reader.
const BADGE_KEYS: Record<string, string> = {
    activity: 'page.sidebar.badge.activity',
    libraryMatches: 'page.sidebar.badge.libraryMatches',
};

// Rows whose route is empty or shared get their glyph by name (SidebarIcon's default is Home's).
const ICON_NAMES: Record<string, 'activity' | 'library'> = {
    activity: 'activity',
    library: 'library',
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
    // B-406 (the owner's ruling): Activity's badge is the downloads that need you; lb-bot's imports
    // and folders to file are Library Matches' badge, where its To fix list is.
    const attention = useLbBotAttention().data;
    // The owner, 2026-11-13: Need you is every client's requests, not this device's alone.
    const activity = useLbBotActivity().data ?? null;
    const downloadsOn = useLbBotDownloadsShown();
    const counts = useMemo(
        () => ({
            attentionCount: needYouCount(ledger, activity),
            toFixCount: libraryToFixCount(attention, downloadsOn),
        }),
        [ledger, activity, attention, downloadsOn],
    );

    return useMemo(() => {
        const label = (id: string, fallback?: string) =>
            LABEL_KEYS[id] ? t(LABEL_KEYS[id]) : fallback;
        const relabel = (entry: SidebarEntry): SidebarEntry => ({
            ...entry,
            ...(entry.badge && BADGE_KEYS[entry.id]
                ? { badgeLabel: t(BADGE_KEYS[entry.id], { count: entry.badge }) }
                : {}),
            label: label(entry.id, entry.label) as string,
        });
        const model = sidebarGroups({
            admin: allows(roles, 'needsAttention'),
            attentionCount: counts.attentionCount,
            downloadsShown,
            lbBotAvailable,
            libraryItems: sidebarItems ?? [],
            librarySelectedRoutes: LIBRARY_FRAME_ROUTES,
            listeningSupported,
            narrow,
            overridesSupported,
            routes: ROUTES,
            toFixCount: counts.toFixCount,
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
        counts,
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
            aria-label={
                entry.badge ? `${entry.label}, ${entry.badgeLabel ?? entry.badge}` : undefined
            }
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
                    <span aria-hidden className={styles.badge} title={entry.badgeLabel}>
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
    // B-406: a badge folded into More still shows: a dot on More, the number on its entry.
    const badged = entries.filter((entry) => entry.badge);

    return (
        <DropdownMenu position="right-end">
            <DropdownMenu.Target>
                <button
                    aria-label={
                        badged.length
                            ? `${t('page.sidebar.more')}, ${badged
                                  .map((entry) => entry.badgeLabel ?? entry.badge)
                                  .join(', ')}`
                            : undefined
                    }
                    className={styles.row}
                    type="button"
                >
                    <span className={styles.rowInner}>
                        <Icon icon="ellipsisHorizontal" size="lg" />
                        <span className={styles.rowLabel}>{t('page.sidebar.more')}</span>
                        {badged.length > 0 && <span aria-hidden className={styles.moreDot} />}
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
                        rightSection={
                            entry.badge ? (
                                <span className={styles.badge} title={entry.badgeLabel}>
                                    {entry.badge}
                                </span>
                            ) : undefined
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
