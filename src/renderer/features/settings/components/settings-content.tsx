import isElectron from 'is-electron';
import { ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { AdvancedTab } from '/@/renderer/features/settings/components/advanced/advanced-tab';
import { AppearanceTab } from '/@/renderer/features/settings/components/appearance/appearance-tab';
import { GeneralTab } from '/@/renderer/features/settings/components/general/general-tab';
import { HotkeysTab } from '/@/renderer/features/settings/components/hotkeys/hotkeys-tab';
import { PlaybackTab } from '/@/renderer/features/settings/components/playback/playback-tab';
import { ServerTab } from '/@/renderer/features/settings/components/server/server-tab';
import { SettingsTabContext } from '/@/renderer/features/settings/components/settings-context';
import { SearchResults } from '/@/renderer/features/settings/components/settings-search-results';
import { tabFor } from '/@/renderer/features/settings/components/settings-tabs';
import { WindowTab } from '/@/renderer/features/settings/components/window/window-tab';
import { useSettingSearchStore } from '/@/renderer/features/settings/store/search.store';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { useSettingsStore, useSettingsStoreActions } from '/@/renderer/store/settings.store';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Tabs } from '/@/shared/components/tabs/tabs';

export const SettingsContent = () => {
    const { t } = useTranslation();
    const storedTab = useSettingsStore((state) => state.tab);
    const { setSettings } = useSettingsStoreActions();
    const search = useSettingSearchStore((state) => state.search);
    const pendingScroll = useSettingSearchStore((state) => state.pendingScroll);
    const setPendingScroll = useSettingSearchStore((state) => state.setPendingScroll);
    const desktop = isElectron();
    // The stored value is left as it is (no migration); it is only read through tabFor.
    const currentTab = tabFor(storedTab, desktop);

    // A search result named a section to scroll to; the section clears this once it has. If it never
    // mounts (it is hidden in this state), the request must not wait for some later visit.
    useEffect(() => {
        if (pendingScroll === null || search !== '') return undefined;
        const timer = setTimeout(() => setPendingScroll(null), 1500);
        return () => clearTimeout(timer);
    }, [pendingScroll, search, setPendingScroll]);

    // A query replaces the tabs with one list across all of them (F5).
    if (search !== '') return <SearchResults />;

    const panel = (tab: string, label: string, body: ReactNode) => (
        <Tabs.Panel value={tab}>
            <SettingsTabContext.Provider value={{ label, tab }}>{body}</SettingsTabContext.Provider>
        </Tabs.Panel>
    );

    return (
        <LibraryContainer>
            <ScrollArea>
                <Tabs
                    keepMounted={false}
                    onChange={(e) => e && setSettings({ tab: e })}
                    orientation="horizontal"
                    value={currentTab}
                    variant="default"
                >
                    <Tabs.List>
                        {desktop && (
                            <Tabs.Tab value="server">{t('page.setting.serverTab')}</Tabs.Tab>
                        )}
                        <Tabs.Tab value="playback">{t('page.setting.playbackTab')}</Tabs.Tab>
                        <Tabs.Tab value="appearance">{t('page.setting.appearanceTab')}</Tabs.Tab>
                        <Tabs.Tab value="general">{t('page.setting.generalTab')}</Tabs.Tab>
                        <Tabs.Tab value="hotkeys">{t('page.setting.hotkeysTab')}</Tabs.Tab>
                        {desktop && (
                            <Tabs.Tab value="desktop">{t('page.setting.desktopTab')}</Tabs.Tab>
                        )}
                        <Tabs.Tab value="advanced">{t('page.setting.advanced')}</Tabs.Tab>
                    </Tabs.List>
                    {desktop && panel('server', t('page.setting.serverTab'), <ServerTab />)}
                    {panel('playback', t('page.setting.playbackTab'), <PlaybackTab />)}
                    {panel('appearance', t('page.setting.appearanceTab'), <AppearanceTab />)}
                    {panel('general', t('page.setting.generalTab'), <GeneralTab />)}
                    {panel('hotkeys', t('page.setting.hotkeysTab'), <HotkeysTab />)}
                    {desktop && panel('desktop', t('page.setting.desktopTab'), <WindowTab />)}
                    {panel('advanced', t('page.setting.advanced'), <AdvancedTab />)}
                </Tabs>
            </ScrollArea>
        </LibraryContainer>
    );
};
