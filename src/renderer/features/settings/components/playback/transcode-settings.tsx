import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { usePlaybackSettings, useSettingsStoreActions } from '/@/renderer/store/settings.store';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { Switch } from '/@/shared/components/switch/switch';
import { TextInput } from '/@/shared/components/text-input/text-input';

export const TranscodeSettings = memo(() => {
    const { t } = useTranslation();
    const { transcode } = usePlaybackSettings();
    const { setTranscodingConfig } = useSettingsStoreActions();
    const note = t('setting.transcodeNote');

    const transcodeOptions: SettingOption[] = [
        {
            control: (
                <Switch
                    aria-label="Toggle transcode"
                    defaultChecked={transcode.enabled}
                    onChange={(e) => {
                        setTranscodingConfig({
                            ...transcode,
                            enabled: e.currentTarget.checked,
                        });
                    }}
                />
            ),
            description:
                t('setting.transcode', {
                    context: 'description',
                }) +
                ' ' +
                t('setting.transcodeThisComputer'),
            note,
            title: t('setting.transcode'),
        },
        {
            control: (
                <Switch
                    aria-label="Transcode only on metered connections"
                    defaultChecked={transcode.meteredOnly ?? false}
                    onChange={(e) => {
                        setTranscodingConfig({
                            ...transcode,
                            meteredOnly: e.currentTarget.checked,
                        });
                    }}
                />
            ),
            description:
                'Apply the transcode profile only while on a metered or constrained connection (cellular, data saver). Full quality otherwise.',
            isHidden: !transcode.enabled,
            note,
            title: 'Only when metered',
        },
        {
            control: (
                <NumberInput
                    aria-label="Transcode bitrate"
                    defaultValue={transcode.bitrate}
                    min={0}
                    onBlur={(e) => {
                        setTranscodingConfig({
                            ...transcode,
                            bitrate: e.currentTarget.value
                                ? Number(e.currentTarget.value)
                                : undefined,
                        });
                    }}
                    w={100}
                />
            ),
            description: t('setting.transcodeBitrate', {
                context: 'description',
            }),
            isHidden: !transcode.enabled,
            note,
            title: t('setting.transcodeBitrate'),
        },
        {
            control: (
                <TextInput
                    aria-label="transcoding format"
                    defaultValue={transcode.format}
                    onBlur={(e) => {
                        setTranscodingConfig({
                            ...transcode,
                            format: e.currentTarget.value || undefined,
                        });
                    }}
                    placeholder="mp3, opus, flac"
                    width={100}
                />
            ),
            description: t('setting.transcodeFormat', {
                context: 'description',
            }),
            isHidden: !transcode.enabled,
            note,
            title: t('setting.transcodeFormat'),
        },
        {
            control: (
                <NumberInput
                    aria-label="Transcode max sample rate"
                    defaultValue={transcode.maxSampleRate}
                    min={0}
                    onBlur={(e) => {
                        setTranscodingConfig({
                            ...transcode,
                            maxSampleRate: e.currentTarget.value
                                ? Number(e.currentTarget.value)
                                : undefined,
                        });
                    }}
                    placeholder="192000"
                    w={100}
                />
            ),
            description: t('setting.transcodeSampleRate', {
                context: 'description',
            }),
            isHidden: !transcode.enabled,
            note,
            title: t('setting.transcodeSampleRate'),
        },
    ];

    return <SettingsSection options={transcodeOptions} title={t('page.setting.transcoding')} />;
});
