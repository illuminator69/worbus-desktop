import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Fragment } from 'react/jsx-runtime';

import { AudioMuseSettings } from '/@/renderer/features/settings/components/server/audiomuse-settings';
import { RemoteSettings } from '/@/renderer/features/settings/components/server/remote-settings';
import {
    CastingSettings,
    WorbusServerSettings,
} from '/@/renderer/features/settings/components/server/worbus-server-settings';
import { KEYWORDS } from '/@/renderer/features/settings/components/settings-keywords';
import { extraShown } from '/@/renderer/features/settings/components/settings-search';
import { useSettingSearchStore } from '/@/renderer/features/settings/store/search.store';
import { Accordion } from '/@/shared/components/accordion/accordion';
import { Divider } from '/@/shared/components/divider/divider';
import { Stack } from '/@/shared/components/stack/stack';

// Closed: someone with a Worbus Server never needs these (the server holds AudioMuse itself), and
// opening with them would suggest everyone does. In the search results it is drawn only when a
// row inside matches, and then open, since the match would otherwise be hidden in the fold.
const WithoutServerSettings = memo(() => {
    const { t } = useTranslation();
    const keyword = useSettingSearchStore((state) => state.search);
    const label = 'Without a Worbus Server';

    if (
        !extraShown(keyword, label, [
            t('naviConnect.audioMuse.url'),
            t('naviConnect.audioMuse.token'),
            ...KEYWORDS.audiomuseUrl,
            ...KEYWORDS.audiomuseToken,
        ])
    ) {
        return null;
    }

    return (
        <Accordion
            data-settings-section
            defaultValue={keyword !== '' ? 'without-server' : undefined}
            variant="separated"
        >
            <Accordion.Item value="without-server">
                <Accordion.Control>{label}</Accordion.Control>
                <Accordion.Panel>
                    <AudioMuseSettings />
                </Accordion.Panel>
            </Accordion.Item>
        </Accordion>
    );
});

/** The tab a new user is sent to: the connection first, then the pieces that depend on it. */
export const ServerTab = memo(() => {
    const sections = [
        { element: <WorbusServerSettings />, key: 'worbus-server' },
        { element: <CastingSettings />, key: 'casting' },
        { element: <WithoutServerSettings />, key: 'without-server' },
        { element: <RemoteSettings />, key: 'browser-remote' },
    ];

    return (
        <Stack gap="md">
            {sections.map(({ element, key }, index) => (
                <Fragment key={key}>
                    {element}
                    {index < sections.length - 1 && <Divider />}
                </Fragment>
            ))}
        </Stack>
    );
});
