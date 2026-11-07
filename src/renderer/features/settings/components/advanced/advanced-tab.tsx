import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Fragment } from 'react/jsx-runtime';

import { ExportImportSettings } from '/@/renderer/features/settings/components/advanced/export-import-settings';
import { LoggerSettings } from '/@/renderer/features/settings/components/advanced/logger-settings';
import { ResetSettings } from '/@/renderer/features/settings/components/advanced/reset-settings';
import { StylesSettings } from '/@/renderer/features/settings/components/advanced/styles-settings';
import { PathSettings } from '/@/renderer/features/settings/components/general/path-settings';
import { QueryBuilderSettings } from '/@/renderer/features/settings/components/general/query-builder-settings';
import { SettingsSection } from '/@/renderer/features/settings/components/settings-section';
import { CacheSettings } from '/@/renderer/features/settings/components/window/cache-settngs';
import { useCurrentServer } from '/@/renderer/store';
import { hasFeature } from '/@/shared/api/utils';
import { Divider } from '/@/shared/components/divider/divider';
import { Stack } from '/@/shared/components/stack/stack';
import { ServerFeature } from '/@/shared/types/features-types';

// No Update and no Analytics section: this build has no update feed of its own and sends no usage
// data anywhere. The power-user settings that sat in General (custom CSS, query builder fields,
// file path replacement) are here. Reset to default is last so it is not one click from the others.
export const AdvancedTab = memo(() => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const supportsSmartPlaylists = hasFeature(server, ServerFeature.PLAYLISTS_SMART);

    const sections = useMemo(
        () => [
            { element: <ExportImportSettings />, key: 'export-import' },
            {
                element: (
                    <SettingsSection
                        extra={<StylesSettings />}
                        extraKeywords={['css', 'stylesheet', 'style']}
                        options={[]}
                        title={t('page.setting.customCss')}
                    />
                ),
                key: 'css',
            },
            ...(supportsSmartPlaylists
                ? [{ element: <QueryBuilderSettings />, key: 'queryBuilder' }]
                : []),
            {
                element: (
                    <SettingsSection
                        extra={<PathSettings />}
                        extraKeywords={['path replace', 'replace path', 'music folder']}
                        options={[]}
                        title={t('page.setting.pathReplace')}
                    />
                ),
                key: 'paths',
            },
            { element: <LoggerSettings />, key: 'logger' },
            { element: <CacheSettings />, key: 'cache' },
            { element: <ResetSettings />, key: 'reset' },
        ],
        [supportsSmartPlaylists, t],
    );

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
