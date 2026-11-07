import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DraggableItems } from '/@/renderer/features/settings/components/general/draggable-items';
import {
    sidebarItems as defaultSidebarItems,
    SidebarItem,
    SidebarItemType,
    useGeneralSettings,
    useSettingsStoreActions,
} from '/@/renderer/store';

const SIDEBAR_ITEMS: Array<[string, string]> = [
    [SidebarItem.ALBUMS, 'page.sidebar.albums'],
    [SidebarItem.ARTISTS, 'page.sidebar.albumArtists'],
    [SidebarItem.ARTISTS_ALL, 'page.sidebar.artists'],
    [SidebarItem.FAVORITES, 'page.sidebar.favorites'],
    [SidebarItem.FOLDERS, 'page.sidebar.folders'],
    [SidebarItem.GENRES, 'page.sidebar.genres'],
    [SidebarItem.HOME, 'page.sidebar.home'],
    [SidebarItem.NOW_PLAYING, 'page.sidebar.nowPlaying'],
    [SidebarItem.PLAYLISTS, 'page.sidebar.playlists'],
    [SidebarItem.COLLECTIONS, 'page.sidebar.collections'],
    [SidebarItem.RADIO, 'page.sidebar.radio'],
    [SidebarItem.SEARCH, 'page.sidebar.search'],
    [SidebarItem.SETTINGS, 'page.sidebar.settings'],
    [SidebarItem.TRACKS, 'page.sidebar.tracks'],
];

// F6: these pages are always a chip (or More, for the album artist table) in the Library frame, whatever
// their stored switch says; Genres, Folders, Radio, Favorites and All artists still gate theirs.
const ALWAYS_IN_LIBRARY = [
    SidebarItem.ALBUMS,
    SidebarItem.ARTISTS,
    SidebarItem.PLAYLISTS,
    SidebarItem.TRACKS,
] as const;

export const SidebarReorder = () => {
    const { t } = useTranslation();
    const { sidebarItems } = useGeneralSettings();
    const { setSidebarItems } = useSettingsStoreActions();

    const mergedSidebarItems = useMemo(() => {
        const settingsMap = new Map(sidebarItems.map((item) => [item.id, item]));
        const defaultMap = new Map(defaultSidebarItems.map((item) => [item.id, item]));

        const merged = sidebarItems.map((item) => ({
            ...item,
            id: item.id,
        }));

        SIDEBAR_ITEMS.forEach(([itemId]) => {
            if (!settingsMap.has(itemId)) {
                const defaultItem = defaultMap.get(itemId);
                merged.push({
                    disabled: true,
                    id: itemId,
                    label: defaultItem?.label ?? itemId,
                    route: defaultItem?.route ?? '',
                });
            }
        });

        // Remove any duplicates
        const uniqueMerged = merged.filter(
            (item, index, self) => index === self.findIndex((t) => t.id === item.id),
        );

        return uniqueMerged;
    }, [sidebarItems]);

    const lockedItems = useMemo(
        () =>
            Object.fromEntries(
                ALWAYS_IN_LIBRARY.map((id) => [id, t('page.library.alwaysInLibrary')]),
            ) as Partial<Record<string, string>>,
        [t],
    );

    return (
        <DraggableItems
            description="setting.sidebarConfiguration"
            itemLabels={SIDEBAR_ITEMS}
            items={mergedSidebarItems as unknown as SidebarItemType[]}
            lockedItems={lockedItems}
            setItems={setSidebarItems}
            title="setting.sidebarConfiguration"
        />
    );
};
