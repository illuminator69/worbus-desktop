import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    autoplayEnabledPatch,
    stationCharacterPatch,
    strategyPatch,
} from '/@/renderer/features/player/station/autoplay-keys';
import { charactersOf } from '/@/renderer/features/player/station/station-logic';
import {
    useStationCatalog,
    useStationMode,
} from '/@/renderer/features/player/station/station-store';
import { KEYWORDS } from '/@/renderer/features/settings/components/settings-keywords';
import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { useSettingSearchStore } from '/@/renderer/features/settings/store/search.store';
import {
    AUTO_DJ_MODE,
    AUTO_DJ_STRATEGY,
    type AutoDJStrategy,
    useAutoDJSettings,
    useGeneralSettings,
    useSettingsStoreActions,
    useStationSettings,
} from '/@/renderer/store/settings.store';
import { Accordion } from '/@/shared/components/accordion/accordion';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Slider } from '/@/shared/components/slider/slider';
import { Switch } from '/@/shared/components/switch/switch';
import { StationCharacterId } from '/@/shared/types/station-types';

/**
 * Autoplay and radio, in one place (F3). The switch is the one the queue chips and the More panel
 * write; the station character is the one a new station starts with. The knobs below them only
 * run when the server's stations are unavailable (use-auto-dj.ts mounts only then), so they sit
 * in a closed fold that says so, and are the same controls the More panel shows.
 */
export const AutoDJSettings = memo(() => {
    const { t } = useTranslation();
    const settings = useAutoDJSettings();
    const general = useGeneralSettings();
    const station = useStationSettings();
    const catalog = useStationCatalog();
    const stationMode = useStationMode();
    const { setSettings } = useSettingsStoreActions();
    // Opened when a search is what brought the user here, or the match would sit in a closed fold.
    const keyword = useSettingSearchStore((state) => state.search);

    const characters = useMemo(
        () => charactersOf(catalog).map((row) => ({ label: row.label, value: row.id })),
        [catalog],
    );

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

    const isAlbums = settings.mode === AUTO_DJ_MODE.ALBUMS;
    const strategyValue = isAlbums
        ? (settings.albumStrategy ?? AUTO_DJ_STRATEGY.SIMILAR)
        : (settings.songStrategy ?? AUTO_DJ_STRATEGY.SIMILAR);

    const options: SettingOption[] = [
        {
            control: (
                <Switch
                    aria-label={t('setting.autoplay')}
                    checked={settings.enabled}
                    onChange={(e) => setSettings(autoplayEnabledPatch(e.currentTarget.checked))}
                />
            ),
            description: t('setting.autoplay', { context: 'description' }),
            keywords: KEYWORDS.autoplaySwitch,
            title: t('setting.autoplay'),
        },
        {
            control: (
                <SegmentedControl
                    aria-label={t('setting.stationCharacter')}
                    data={characters}
                    onChange={(value) =>
                        setSettings(stationCharacterPatch(value as StationCharacterId))
                    }
                    size="sm"
                    value={station?.character ?? 'balanced'}
                />
            ),
            description: t('setting.stationCharacter', { context: 'description' }),
            // Without the server's stations no station is started, so there is nothing to set.
            isHidden: stationMode === 'fallback',
            keywords: KEYWORDS.autoplayCharacter,
            title: t('setting.stationCharacter'),
        },
    ];

    const fallbackOptions: SettingOption[] = [
        {
            control: (
                <SegmentedControl
                    aria-label={t('setting.autoDJ_mode')}
                    data={[
                        { label: t('setting.autoDJ_mode_songs'), value: AUTO_DJ_MODE.SONGS },
                        { label: t('setting.autoDJ_mode_albums'), value: AUTO_DJ_MODE.ALBUMS },
                    ]}
                    onChange={(value) => {
                        setSettings({
                            autoDJ: {
                                mode: value as 'albums' | 'songs',
                            },
                        });
                    }}
                    size="sm"
                    value={settings.mode}
                    w="100%"
                />
            ),
            description: t('setting.autoDJ_mode_description'),
            keywords: KEYWORDS.autoplayMode,
            title: t('setting.autoDJ_mode'),
        },
        {
            control: (
                <Select
                    aria-label={
                        isAlbums
                            ? t('setting.autoDJ_albumStrategy')
                            : t('setting.autoDJ_songStrategy')
                    }
                    data={strategySelectData}
                    onChange={(value) =>
                        value && setSettings(strategyPatch(settings.mode, value as AutoDJStrategy))
                    }
                    value={strategyValue}
                    w="100%"
                />
            ),
            description: '',
            keywords: KEYWORDS.autoplayStrategy,
            title: isAlbums ? t('setting.autoDJ_albumStrategy') : t('setting.autoDJ_songStrategy'),
        },
        {
            control: (
                <NumberInput
                    aria-label={t('setting.autoDJ_itemCount')}
                    hideControls={false}
                    max={50}
                    min={1}
                    onChange={(e) => {
                        setSettings({
                            autoDJ: {
                                itemCount: Number(e),
                            },
                        });
                    }}
                    value={Number(settings.itemCount)}
                />
            ),
            description: t('setting.autoDJ_itemCount_description'),
            keywords: KEYWORDS.autoplayItemCount,
            title: t('setting.autoDJ_itemCount'),
        },
        {
            control: (
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
                    w="144px"
                />
            ),
            description: t('setting.autoDJ_timing', { context: 'description' }),
            keywords: KEYWORDS.autoplayTiming,
            title: t('setting.autoDJ_timing'),
        },
        {
            control: (
                <Switch
                    aria-label={t('setting.autoDJ_allowDuplicates')}
                    checked={settings.allowDuplicates}
                    onChange={(e) => {
                        setSettings({
                            autoDJ: {
                                allowDuplicates: e.currentTarget.checked,
                            },
                        });
                    }}
                />
            ),
            description: t('setting.autoDJ_allowDuplicates_description'),
            keywords: KEYWORDS.autoplayDuplicates,
            title: t('setting.autoDJ_allowDuplicates'),
        },
        {
            control: (
                <Switch
                    aria-label={t('setting.autoDJ_onlySimilar')}
                    checked={settings.onlySimilar}
                    onChange={(e) => {
                        setSettings({
                            autoDJ: {
                                onlySimilar: e.currentTarget.checked,
                            },
                        });
                    }}
                />
            ),
            description: t('setting.autoDJ_onlySimilar_description'),
            keywords: KEYWORDS.autoplayOnlySimilar,
            title: t('setting.autoDJ_onlySimilar'),
        },
        {
            control: (
                <NumberInput
                    aria-label={t('setting.autoplayRadioCount')}
                    defaultValue={general.artistRadioCount}
                    max={200}
                    min={10}
                    onBlur={(e) => {
                        if (!e) return;
                        const artistRadioCount = e.currentTarget.value
                            ? Math.min(Math.max(Number(e.currentTarget.value), 10), 100)
                            : general.artistRadioCount;
                        setSettings({ general: { artistRadioCount } });
                    }}
                    width={75}
                />
            ),
            description: t('setting.autoplayRadioCount', { context: 'description' }),
            keywords: KEYWORDS.autoplayRadioCount,
            title: t('setting.autoplayRadioCount'),
        },
    ];

    return (
        <SettingsSection
            extra={
                <Accordion
                    defaultValue={keyword !== '' ? 'fallback' : undefined}
                    variant="separated"
                >
                    <Accordion.Item value="fallback">
                        <Accordion.Control>{t('setting.autoplayFallback')}</Accordion.Control>
                        <Accordion.Panel>
                            <SettingsSection options={fallbackOptions} />
                        </Accordion.Panel>
                    </Accordion.Item>
                </Accordion>
            }
            extraKeywords={[
                t('setting.autoplayFallback'),
                ...fallbackOptions.flatMap((option) => [
                    option.title,
                    typeof option.description === 'string' ? option.description : '',
                    ...(option.keywords ?? []),
                ]),
            ]}
            options={options}
            title={t('page.setting.autoplay')}
        />
    );
});
