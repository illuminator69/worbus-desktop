import { memo } from 'react';
import { Fragment } from 'react/jsx-runtime';

import { QueueSettings } from '/@/renderer/features/settings/components/general/application-settings';
import { ExternalLinksSettings } from '/@/renderer/features/settings/components/general/external-links-settings';
import { LyricSettings } from '/@/renderer/features/settings/components/general/lyric-settings';
import { Divider } from '/@/shared/components/divider/divider';
import { Stack } from '/@/shared/components/stack/stack';

// What is left once the looks have gone to Appearance: how the queue behaves, the links shown on
// album and artist pages, and lyrics.
const sections = [
    { component: QueueSettings, key: 'queue' },
    { component: ExternalLinksSettings, key: 'externalLinks' },
    { component: LyricSettings, key: 'lyrics' },
];

export const GeneralTab = memo(() => {
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
