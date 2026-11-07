import styles from './mobile-sidebar.module.css';

import { ActionBar } from '/@/renderer/features/sidebar/components/action-bar';
import { SidebarCollectionList } from '/@/renderer/features/sidebar/components/sidebar-collection-list';
import {
    SidebarGroups,
    useSidebarModel,
} from '/@/renderer/features/sidebar/components/sidebar-groups';
import {
    SidebarPlaylistAddDragContext,
    SidebarPlaylistList,
    SidebarSharedPlaylistList,
    useSidebarPlaylistAddDragMonitor,
} from '/@/renderer/features/sidebar/components/sidebar-playlist-list';
import { useSidebarPlaylistList } from '/@/renderer/store/settings.store';
import { Accordion } from '/@/shared/components/accordion/accordion';
import { Group } from '/@/shared/components/group/group';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';

const MobileSidebarPlaylistSection = () => {
    const isAddDragActive = useSidebarPlaylistAddDragMonitor();

    return (
        <SidebarPlaylistAddDragContext.Provider value={isAddDragActive}>
            <SidebarPlaylistList />
            <SidebarSharedPlaylistList />
        </SidebarPlaylistAddDragContext.Provider>
    );
};

export const MobileSidebar = () => {
    const sidebarPlaylistList = useSidebarPlaylistList();
    // The drawer is tall: every group, with labels, and no More.
    const { groups } = useSidebarModel({ fold: false });

    return (
        <div className={styles.container} id="mobile-sidebar">
            <Group grow id="global-search-container" style={{ flexShrink: 0 }}>
                <ActionBar />
            </Group>
            <ScrollArea allowDragScroll className={styles.scrollArea}>
                <SidebarGroups groups={groups} />
                <Accordion
                    classNames={{
                        content: styles.accordionContent,
                        control: styles.accordionControl,
                        item: styles.accordionItem,
                        root: styles.accordionRoot,
                    }}
                    defaultValue={['collections', 'playlists']}
                    multiple
                >
                    <SidebarCollectionList />
                    {sidebarPlaylistList && <MobileSidebarPlaylistSection />}
                </Accordion>
            </ScrollArea>
        </div>
    );
};
