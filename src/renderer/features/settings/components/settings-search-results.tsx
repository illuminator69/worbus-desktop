import isElectron from 'is-electron';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './settings-search-results.module.css';

import { AdvancedTab } from '/@/renderer/features/settings/components/advanced/advanced-tab';
import { AppearanceTab } from '/@/renderer/features/settings/components/appearance/appearance-tab';
import { GeneralTab } from '/@/renderer/features/settings/components/general/general-tab';
import { HotkeysTab } from '/@/renderer/features/settings/components/hotkeys/hotkeys-tab';
import { PlaybackTab } from '/@/renderer/features/settings/components/playback/playback-tab';
import { ServerTab } from '/@/renderer/features/settings/components/server/server-tab';
import { SettingsTabContext } from '/@/renderer/features/settings/components/settings-context';
import { tabsFor } from '/@/renderer/features/settings/components/settings-tabs';
import { WindowTab } from '/@/renderer/features/settings/components/window/window-tab';
import { useSettingSearchStore } from '/@/renderer/features/settings/store/search.store';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { useSettingsStoreActions } from '/@/renderer/store/settings.store';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

const TAB_BODIES: Record<string, ReactNode> = {
    advanced: <AdvancedTab />,
    appearance: <AppearanceTab />,
    desktop: <WindowTab />,
    general: <GeneralTab />,
    hotkeys: <HotkeysTab />,
    playback: <PlaybackTab />,
    server: <ServerTab />,
};

/**
 * While a query is typed, one list instead of the tabs: every tab's sections, each section drawn
 * only if it has a match (SettingsSection), under a "Tab › Section" heading that opens that tab
 * at that section and ends the search. The rows are the real ones, so a result can be changed
 * where it is found.
 */
export const SearchResults = () => {
    const { t } = useTranslation();
    const { setPendingScroll, setSearch } = useSettingSearchStore();
    const { setSettings } = useSettingsStoreActions();

    const labelOf = (tab: string): string =>
        t(tab === 'advanced' ? 'page.setting.advanced' : `page.setting.${tab}Tab`);

    const openAt = (tab: string) => (section: string) => {
        setSettings({ tab });
        setPendingScroll({ section, tab });
        setSearch('');
    };

    return (
        <LibraryContainer>
            <ScrollArea>
                <Stack className={styles.results} gap="xl" p="md">
                    {tabsFor(isElectron()).map((tab) => (
                        <SettingsTabContext.Provider
                            key={tab}
                            value={{ label: labelOf(tab), open: openAt(tab), tab }}
                        >
                            <div className={styles.tab}>{TAB_BODIES[tab]}</div>
                        </SettingsTabContext.Provider>
                    ))}
                    <Text className={styles.empty} isMuted>
                        {t('page.setting.noResults')}
                    </Text>
                </Stack>
            </ScrollArea>
        </LibraryContainer>
    );
};
