import { closeAllModals, openModal } from '@mantine/modals';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { useSettingsStoreActions } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { Text } from '/@/shared/components/text/text';

// Moved here from the settings header (F1): one click from Search was too close for a button that
// also clears the Worbus Server connection. The confirmation names what goes.
export const ResetSettings = memo(() => {
    const { t } = useTranslation();
    const { reset } = useSettingsStoreActions();

    const handleResetToDefault = () => {
        reset();
        closeAllModals();
    };

    const openResetConfirmModal = () => {
        openModal({
            children: (
                <ConfirmModal
                    labels={{ confirm: t('common.resetToDefault') }}
                    onConfirm={handleResetToDefault}
                >
                    <Text>{t('setting.resetToDefault', { context: 'confirm' })}</Text>
                </ConfirmModal>
            ),
            title: t('common.resetToDefault'),
        });
    };

    const options: SettingOption[] = [
        {
            control: (
                <Button onClick={openResetConfirmModal} size="compact-md" variant="default">
                    {t('common.resetToDefault')}
                </Button>
            ),
            description: t('setting.resetToDefault', { context: 'description' }),
            title: t('common.resetToDefault'),
        },
    ];

    return <SettingsSection options={options} title={t('page.setting.reset')} />;
});
