import clsx from 'clsx';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router';

import styles from './collapsed-sidebar.module.css';

import { CollapsedSidebarItem } from '/@/renderer/features/sidebar/components/collapsed-sidebar-item';
import { getCollectionTo } from '/@/renderer/features/sidebar/components/sidebar-collection-list';
import { useSidebarModel } from '/@/renderer/features/sidebar/components/sidebar-groups';
import { SidebarIcon } from '/@/renderer/features/sidebar/components/sidebar-icon';
import { type SidebarEntry } from '/@/renderer/features/sidebar/utils/sidebar-groups';
import { AppRoute } from '/@/renderer/router/routes';
import { useCollections, useWindowSettings } from '/@/renderer/store';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Flex } from '/@/shared/components/flex/flex';
import { Icon } from '/@/shared/components/icon/icon';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Stack } from '/@/shared/components/stack/stack';
import { LibraryItem } from '/@/shared/types/domain-types';
import { Platform } from '/@/shared/types/types';

const RAIL_ICON_NAMES: Record<string, 'activity' | 'attention' | 'library'> = {
    activity: 'activity',
    library: 'library',
};

export const CollapsedSidebar = () => {
    const { t } = useTranslation();
    const collections = useCollections();
    const { windowBarStyle } = useWindowSettings();
    // The rail lists every group: no More here.
    const { groups } = useSidebarModel({ fold: false });

    const entryItem = (entry: SidebarEntry) => {
        const icon = (active: boolean) => (
            <span className={styles.iconWrap}>
                <SidebarIcon
                    active={active}
                    name={RAIL_ICON_NAMES[entry.id]}
                    route={entry.route}
                    size="25"
                />
                {entry.badge ? (
                    <span aria-hidden className={styles.badgeDot}>
                        {entry.badge}
                    </span>
                ) : null}
            </span>
        );
        const selected = entry.selectedRoute ?? entry.route;
        return (
            <CollapsedSidebarItem
                activeIcon={icon(true)}
                aria-label={entry.badge ? `${entry.label}, ${entry.badge}` : undefined}
                component={NavLink}
                icon={icon(false)}
                key={entry.id}
                label={entry.label}
                route={selected || undefined}
                selectedRoutes={entry.selectedRoutes}
                to={entry.route}
            />
        );
    };

    const main = groups.find((group) => group.id === 'main');
    const mainItems = main?.entries ?? [];
    const lowerGroups = groups.filter((group) => group.id !== 'main');

    return (
        <motion.div
            className={clsx({
                [styles.linux]: windowBarStyle === Platform.LINUX,
                [styles.sidebarContainer]: true,
                [styles.web]: windowBarStyle === Platform.WEB,
            })}
        >
            <ScrollArea>
                {mainItems.map(entryItem)}
                {collections && collections.length > 0 ? (
                    <DropdownMenu offset={0} position="right-end">
                        <DropdownMenu.Target>
                            <CollapsedSidebarItem
                                activeIcon={null}
                                component={Flex}
                                icon={<Icon color="muted" icon="collection" size="3xl" />}
                                label={t('page.sidebar.collections')}
                                style={{
                                    cursor: 'pointer',
                                    padding: 'var(--theme-spacing-md) 0',
                                }}
                            />
                        </DropdownMenu.Target>
                        <DropdownMenu.Dropdown>
                            <ScrollArea style={{ maxHeight: '50vh' }}>
                                <Stack gap={0} p="xs">
                                    {collections.map((collection) => {
                                        const to = getCollectionTo(collection);
                                        return (
                                            <DropdownMenu.Item
                                                component={Link}
                                                key={collection.id}
                                                leftSection={
                                                    <SidebarIcon
                                                        route={
                                                            collection.type === LibraryItem.ALBUM
                                                                ? AppRoute.LIBRARY_ALBUMS
                                                                : AppRoute.LIBRARY_SONGS
                                                        }
                                                    />
                                                }
                                                to={to}
                                            >
                                                {collection.name}
                                            </DropdownMenu.Item>
                                        );
                                    })}
                                </Stack>
                            </ScrollArea>
                        </DropdownMenu.Dropdown>
                    </DropdownMenu>
                ) : null}
                {/* The rail has no playlist list of its own; this is its way to the Playlists page
                    (unless the model already lists it, when the sidebar's playlist section is off). */}
                {!mainItems.some((entry) => entry.id === 'Playlists') &&
                    entryItem({
                        id: 'Playlists',
                        label: t('page.sidebar.playlists'),
                        route: AppRoute.PLAYLISTS,
                    })}
                {lowerGroups.map((group) => (
                    <div className={styles.group} key={group.id}>
                        {group.entries.map(entryItem)}
                    </div>
                ))}
            </ScrollArea>
        </motion.div>
    );
};
