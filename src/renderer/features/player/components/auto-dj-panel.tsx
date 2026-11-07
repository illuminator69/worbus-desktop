import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    autoplayEnabledPatch,
    strategyPatch,
} from '/@/renderer/features/player/station/autoplay-keys';
import {
    ListConfigBooleanControl,
    ListConfigTable,
} from '/@/renderer/features/shared/components/list-config-menu';
import {
    AUTO_DJ_MODE,
    AUTO_DJ_STRATEGY,
    type AutoDJStrategy,
    useAutoDJSettings,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { Paper } from '/@/shared/components/paper/paper';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Slider } from '/@/shared/components/slider/slider';
import { Stack } from '/@/shared/components/stack/stack';

/** Auto DJ's settings, inside the player bar's More menu (F1). */
export const AutoDjPanel = () => {
    const { t } = useTranslation();
    const settings = useAutoDJSettings();
    const { setSettings } = useSettingsStoreActions();

    const strategySelectData = useMemo(
        () => [
            {
                label: t('setting.autoDJ_strategy_option_similar'),
                value: AUTO_DJ_STRATEGY.SIMILAR,
            },
            {
                label: t('setting.autoDJ_strategy_option_library_random'),
                value: AUTO_DJ_STRATEGY.LIBRARY_RANDOM,
            },
        ],
        [t],
    );

    const strategyTitle =
        settings.mode === AUTO_DJ_MODE.ALBUMS
            ? t('setting.autoDJ_albumStrategy')
            : t('setting.autoDJ_songStrategy');

    const strategyValue =
        settings.mode === AUTO_DJ_MODE.ALBUMS
            ? (settings.albumStrategy ?? AUTO_DJ_STRATEGY.SIMILAR)
            : (settings.songStrategy ?? AUTO_DJ_STRATEGY.SIMILAR);

    const enabledOptions = useMemo(
        () => [
            {
                component: (
                    <ListConfigBooleanControl
                        onChange={(value) => {
                            setSettings(autoplayEnabledPatch(value));
                        }}
                        value={settings.enabled}
                    />
                ),
                id: 'enabled',
                label: t('setting.autoDJ_enabled'),
            },
        ],
        [setSettings, settings.enabled, t],
    );

    const configOptions = useMemo(
        () => [
            {
                component: (
                    <Select
                        comboboxProps={{ withinPortal: false }}
                        data={strategySelectData}
                        onChange={(value) => {
                            if (!value) return;
                            setSettings(strategyPatch(settings.mode, value as AutoDJStrategy));
                        }}
                        size="sm"
                        value={strategyValue}
                        variant="filled"
                        w="160px"
                    />
                ),
                id: 'strategy',
                label: strategyTitle,
            },
            {
                component: (
                    <NumberInput
                        aria-label={t('setting.autoDJ_itemCount')}
                        hideControls={false}
                        max={50}
                        min={1}
                        onChange={(e) =>
                            setSettings({
                                autoDJ: {
                                    itemCount: Number(e),
                                },
                            })
                        }
                        size="sm"
                        value={Number(settings.itemCount)}
                        variant="filled"
                        w="96px"
                    />
                ),
                description: t('setting.autoDJ_itemCount_description'),
                id: 'itemCount',
                label: t('setting.autoDJ_itemCount'),
            },
            {
                component: (
                    <Slider
                        aria-label={t('setting.autoDJ_timing')}
                        marks={[
                            { label: '1', value: 1 },
                            { label: '2', value: 2 },
                            { label: '3', value: 3 },
                            { label: '4', value: 4 },
                            { label: '5', value: 5 },
                        ]}
                        max={5}
                        min={1}
                        onChange={(e) =>
                            setSettings({
                                autoDJ: {
                                    timing: Number(e),
                                },
                            })
                        }
                        size="sm"
                        value={Number(settings.timing)}
                        variant="filled"
                        w="144px"
                    />
                ),
                description: t('setting.autoDJ_timing_description'),
                id: 'timing',
                label: t('setting.autoDJ_timing'),
            },
        ],
        [
            setSettings,
            settings.itemCount,
            settings.mode,
            settings.timing,
            strategySelectData,
            strategyTitle,
            strategyValue,
            t,
        ],
    );

    const toggleOptions = useMemo(
        () => [
            {
                component: (
                    <ListConfigBooleanControl
                        onChange={(value) => {
                            setSettings({
                                autoDJ: {
                                    allowDuplicates: value,
                                },
                            });
                        }}
                        value={settings.allowDuplicates}
                    />
                ),
                description: t('setting.autoDJ_allowDuplicates_description'),
                id: 'allowDuplicates',
                label: t('setting.autoDJ_allowDuplicates'),
            },
            {
                component: (
                    <ListConfigBooleanControl
                        onChange={(value) => {
                            setSettings({
                                autoDJ: {
                                    onlySimilar: value,
                                },
                            });
                        }}
                        value={settings.onlySimilar}
                    />
                ),
                description: t('setting.autoDJ_onlySimilar_description'),
                id: 'onlySimilar',
                label: t('setting.autoDJ_onlySimilar'),
            },
        ],
        [setSettings, settings.allowDuplicates, settings.onlySimilar, t],
    );

    return (
        <Stack gap="sm">
            <Paper p="md" radius="md">
                <ListConfigTable options={enabledOptions} />
            </Paper>
            <SegmentedControl
                data={[
                    { label: t('setting.autoDJ_mode_songs'), value: AUTO_DJ_MODE.SONGS },
                    {
                        label: t('setting.autoDJ_mode_albums'),
                        value: AUTO_DJ_MODE.ALBUMS,
                    },
                ]}
                onChange={(value) =>
                    setSettings({
                        autoDJ: {
                            mode: value as 'albums' | 'songs',
                        },
                    })
                }
                value={settings.mode}
                w="100%"
            />
            <Paper p="md" radius="md">
                <ListConfigTable options={configOptions} />
            </Paper>
            <Paper p="md" radius="md">
                <ListConfigTable options={toggleOptions} />
            </Paper>
        </Stack>
    );
};
