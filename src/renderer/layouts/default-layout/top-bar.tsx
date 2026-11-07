import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import styles from './top-bar.module.css';

import { useScanStatus } from '/@/renderer/features/shared/hooks/use-scan-status';
import { AppMenu } from '/@/renderer/features/titlebar/components/app-menu';
import { useCommandPalette, useHotkeySettings } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { Kbd } from '/@/shared/components/kbd/kbd';
import { TextInput } from '/@/shared/components/text-input/text-input';

// `mod` is the command key on macOS and Ctrl elsewhere (Mantine's hotkey convention).
const MOD_LABEL = /Mac/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

export const TopBar = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { open } = useCommandPalette();
    const { isScanning } = useScanStatus();
    const { bindings } = useHotkeySettings();
    // A rebound palette key would make the hint a lie, so it shows only for the default.
    const showHint = bindings.globalSearch?.hotkey === 'mod+k';

    return (
        <div className={styles.topBar} id="top-bar">
            <div className={styles.arrows}>
                <ActionIcon
                    aria-label={t('common.back')}
                    className={styles.iconButton}
                    icon="arrowLeftS"
                    iconProps={{ size: 'lg' }}
                    onClick={() => navigate(-1)}
                    size="compact-md"
                    variant="subtle"
                />
                <ActionIcon
                    aria-label={t('common.forward')}
                    className={styles.iconButton}
                    icon="arrowRightS"
                    iconProps={{ size: 'lg' }}
                    onClick={() => navigate(1)}
                    size="compact-md"
                    variant="subtle"
                />
            </div>
            <TextInput
                aria-label={t('common.search')}
                className={styles.search}
                classNames={{ input: styles.searchInput }}
                leftSection={<Icon icon="search" />}
                onClick={open}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        open();
                    }
                }}
                placeholder={t('common.search')}
                readOnly
                rightSection={showHint ? <Kbd className={styles.hint}>{MOD_LABEL}</Kbd> : null}
                rightSectionWidth={showHint ? 64 : undefined}
            />
            <div className={styles.spacer} />
            <DropdownMenu position="bottom-end">
                <DropdownMenu.Target>
                    <ActionIcon
                        aria-label={t('common.menu')}
                        className={styles.iconButton}
                        size="compact-md"
                        variant="subtle"
                    >
                        <Icon
                            animate={isScanning ? 'spin' : undefined}
                            icon={isScanning ? 'spinner' : 'menu'}
                            size="lg"
                        />
                    </ActionIcon>
                </DropdownMenu.Target>
                <DropdownMenu.Dropdown>
                    <AppMenu />
                </DropdownMenu.Dropdown>
            </DropdownMenu>
        </div>
    );
};
