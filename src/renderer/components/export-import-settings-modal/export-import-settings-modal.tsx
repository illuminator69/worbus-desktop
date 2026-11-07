import { t } from 'i18next';
import { useCallback, useState } from 'react';
import { ZodError } from 'zod';

import { DiffVisualiser } from '/@/renderer/components/settings-diff-visualiser/settings-diff-visualiser';
import {
    keepCurrentSecrets,
    migrateSettings,
    omitExportSecrets,
    type SettingsState,
    useSettingsForExport,
    useSettingsStore,
    useSettingsStoreActions,
    ValidationSettingsStateSchema,
    VersionedSettings,
} from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { DragDropZone } from '/@/shared/components/drag-drop-zone/drag-drop-zone';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

enum SCREENS {
    FILE_PICKER,
    DIFF_VISUALS,
    IMPORT_COMPLETE,
}

export const ExportImportSettingsModal = () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Version needs to be omitted from the settings object
    const { version, ...settings } = useSettingsForExport();
    const { setSettings } = useSettingsStoreActions();

    const [currentScreen, setCurrentScreen] = useState<SCREENS>(SCREENS.FILE_PICKER);
    const [selectedSettingsFile, setSettingsFile] = useState<SettingsState>();

    const onItemSelected = useCallback((itemContents: string) => {
        const settingsFile = JSON.parse(itemContents) as VersionedSettings;
        // An export carries no secrets (F1): where the file has none, keep what is set now.
        const { version, ...settings } = keepCurrentSecrets(
            settingsFile,
            useSettingsStore.getState(),
        );
        // Apply the migrated copy, the one validateItemSelected checked: an old export must
        // land with every later migration (Home's four rows, F5) and not as it was written.
        const parsedResult = migrateSettings(settings as SettingsState, version || 0);
        setSettingsFile(parsedResult);
        setCurrentScreen(SCREENS.DIFF_VISUALS);
    }, []);

    const validateItemSelected = useCallback(
        (itemContents: string): { error?: string; isValid: boolean } => {
            try {
                JSON.parse(itemContents);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars -- "err" is not useful and the catch cannot be empty
            } catch (err) {
                return {
                    error: t('setting.exportImportSettings_notValidJSON'),
                    isValid: false,
                };
            }

            const content = keepCurrentSecrets(
                JSON.parse(itemContents),
                useSettingsStore.getState(),
            );

            const migratedSettings = migrateSettings(content, content?.version || 0);
            const validationRes = ValidationSettingsStateSchema.safeParse(migratedSettings);

            if (!validationRes.success) {
                const error = validationRes.error as ZodError;
                const firstError = error.errors.pop();

                const dotPath = firstError?.path.join('.');
                const reason = firstError?.message;

                return {
                    error: t('setting.exportImportSettings_offendingKeyError', {
                        offendingKey: dotPath,
                        reason,
                    }),
                    isValid: false,
                };
            }

            return {
                isValid: true,
            };
        },
        [],
    );

    const onImportClick = useCallback(() => {
        if (selectedSettingsFile) {
            setSettings(selectedSettingsFile);
            setCurrentScreen(SCREENS.IMPORT_COMPLETE);
        }
    }, [selectedSettingsFile, setSettings]);

    return (
        <>
            {currentScreen === SCREENS.FILE_PICKER ? (
                <Stack>
                    <DragDropZone
                        icon="fileJson"
                        onItemSelected={onItemSelected}
                        validateItem={validateItemSelected}
                    />
                </Stack>
            ) : null}
            {currentScreen === SCREENS.DIFF_VISUALS ? (
                <Stack>
                    <DiffVisualiser
                        newSettings={omitExportSecrets(selectedSettingsFile!)}
                        originalSettings={settings}
                    />
                    <Text size="sm" ta="center">
                        {t('setting.exportImportSettings_destructiveWarning').toString()}
                    </Text>
                    <Button onClick={onImportClick} variant="state-info">
                        {t('setting.exportImportSettings_importBtn').toString()}
                    </Button>
                </Stack>
            ) : null}
            {currentScreen === SCREENS.IMPORT_COMPLETE ? (
                <Text py="md" ta="center">
                    {t('setting.exportImportSettings_importSuccess').toString()}
                </Text>
            ) : null}
        </>
    );
};
