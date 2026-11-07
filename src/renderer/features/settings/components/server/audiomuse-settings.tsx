import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { KEYWORDS } from '/@/renderer/features/settings/components/settings-keywords';
import { SettingsSection } from '/@/renderer/features/settings/components/settings-section';
import { useAudioMuseSettings, useSettingsStoreActions } from '/@/renderer/store';
import { PasswordInput } from '/@/shared/components/password-input/password-input';
import { TextInput } from '/@/shared/components/text-input/text-input';

/**
 * The direct route to AudioMuse-AI's core API, for a setup with no Worbus Server (Q-096: it used
 * to sit in the autoplay popover). Through the server, which holds AudioMuse's address and token
 * itself, both stay blank. Radio and autoplay never use this route: they are the server's
 * stations (I-040). What still does is CLAP mood search and the mixes played without them. The
 * Server tab folds it under "Without a Worbus Server".
 */
export const AudioMuseSettings = memo(() => {
    const { t } = useTranslation();
    const audioMuse = useAudioMuseSettings();
    const { setSettings } = useSettingsStoreActions();

    return (
        <SettingsSection
            options={[
                {
                    control: (
                        <TextInput
                            aria-label={t('naviConnect.audioMuse.url')}
                            defaultValue={audioMuse.url}
                            onBlur={(e) => {
                                const url = e.currentTarget.value.trim();
                                if (url !== audioMuse.url) setSettings({ audioMuse: { url } });
                            }}
                            placeholder="http://localhost:8000"
                        />
                    ),
                    description: t('naviConnect.audioMuse.url_description'),
                    keywords: KEYWORDS.audiomuseUrl,
                    title: t('naviConnect.audioMuse.url'),
                },
                {
                    control: (
                        <PasswordInput
                            aria-label={t('naviConnect.audioMuse.token')}
                            defaultValue={audioMuse.token}
                            onBlur={(e) => {
                                const token = e.currentTarget.value.trim();
                                if (token !== audioMuse.token) {
                                    setSettings({ audioMuse: { token } });
                                }
                            }}
                        />
                    ),
                    description: t('naviConnect.audioMuse.token_description'),
                    keywords: KEYWORDS.audiomuseToken,
                    title: t('naviConnect.audioMuse.token'),
                },
            ]}
        />
    );
});
