import { memo } from 'react';
import { Fragment } from 'react/jsx-runtime';

import {
    AlbumArtistSettings,
    FullscreenAppearanceSettings,
    HomeAppearanceSettings,
    ListsImagesSettings,
    TextSettings,
} from '/@/renderer/features/settings/components/general/application-settings';
import { PlayerBarSettings } from '/@/renderer/features/settings/components/general/control-settings';
import {
    SidebarSettings,
    SideQueueSettings,
} from '/@/renderer/features/settings/components/general/sidebar-settings';
import { ThemeSettings } from '/@/renderer/features/settings/components/general/theme-settings';
import { Divider } from '/@/shared/components/divider/divider';
import { Stack } from '/@/shared/components/stack/stack';

// One job per section, the colours first (Cover colours is the master switch of that section).
// Every row here is a row General used to carry, moved and not renamed: the keys they write are
// the same (appearance-tab-keys.harness.ts).
const sections = [
    { component: ThemeSettings, key: 'colours' },
    { component: TextSettings, key: 'text' },
    { component: PlayerBarSettings, key: 'playerBar' },
    { component: SideQueueSettings, key: 'sideQueue' },
    { component: SidebarSettings, key: 'sidebar' },
    { component: HomeAppearanceSettings, key: 'home' },
    { component: AlbumArtistSettings, key: 'albumArtist' },
    { component: ListsImagesSettings, key: 'listsImages' },
    { component: FullscreenAppearanceSettings, key: 'fullscreenPlayer' },
];

export const AppearanceTab = memo(() => {
    return (
        <Stack gap="md">
            {sections.map(({ component: Section, key }, index) => (
                <Fragment key={key}>
                    <Section />
                    {index < sections.length - 1 && <Divider />}
                </Fragment>
            ))}
        </Stack>
    );
});
