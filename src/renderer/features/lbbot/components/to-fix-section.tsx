import { useTranslation } from 'react-i18next';

import styles from '../routes/lbbot-downloads-route.module.css';

import { ImportsRow } from '/@/renderer/features/lbbot/components/imports-row';
import {
    useLbBotAttention,
    useLbBotDownloadsShown,
    useLbBotWebUrl,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    folderDetail,
    folderTitle,
    lbPlaceLink,
    toFixSection,
} from '/@/renderer/features/lbbot/lb-page-link';
import { useHubStore } from '/@/renderer/store/hub.store';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { isPrivateAddress } from '/@/shared/utils/hub-addresses';

/**
 * B-406 (the desktop half): the phone's "To fix" (PROTOCOL §15.6): the imports row, then the
 * download folders lb-bot is waiting to have filed, each as what lb-bot identified it as and how
 * many files (never a name or a path) with Open in lb-bot on its Placement (`#/place/<id>`), since
 * filing moves and retags files. The heading's number is lb-bot's `imports + folders`, the phone's.
 * Nothing here writes to lb-bot. Not built: the phone's Albums section (failed gaps and requests,
 * picks) and its artists to check.
 */
export const ToFixSection = () => {
    const { t } = useTranslation();
    const attention = useLbBotAttention().data;
    const downloadsOn = useLbBotDownloadsShown();
    const webUrl = useLbBotWebUrl();
    const activeAddress = useHubStore((s) => s.server?.activeAddress ?? null);
    const section = toFixSection(attention, downloadsOn);

    if (section.count === 0) return <ImportsRow />;

    return (
        <Stack data-to-fix="" gap="sm">
            <Text fw={600}>{t('naviConnect.toFix.title', { count: section.count })}</Text>
            <ImportsRow />
            {section.folders.map((folder) => {
                const link = lbPlaceLink(webUrl, activeAddress, isPrivateAddress, folder.id);
                return (
                    <div className={styles.row} data-to-fix-folder="" key={folder.id}>
                        <Stack className={styles.body} gap="0.15rem">
                            <Text isNoSelect lineClamp={1}>
                                {folderTitle(folder)}
                            </Text>
                            <Text isMuted size="sm">
                                {link
                                    ? folderDetail(folder)
                                    : `${folderDetail(folder)} · ${t('naviConnect.toFix.folderAway')}`}
                            </Text>
                        </Stack>
                        {link && (
                            <Button
                                component="a"
                                href={link}
                                rel="noreferrer"
                                target="_blank"
                                variant="subtle"
                            >
                                {t('naviConnect.toFix.folderOpen')}
                            </Button>
                        )}
                    </div>
                );
            })}
            {section.moreFolders > 0 && (
                <Text isMuted size="sm">
                    {t('naviConnect.toFix.more', { count: section.moreFolders })}
                </Text>
            )}
        </Stack>
    );
};
