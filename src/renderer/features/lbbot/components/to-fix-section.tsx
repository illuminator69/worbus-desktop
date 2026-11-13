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
 * filing moves and retags files. Nothing here writes to lb-bot. Not built: the phone's Albums
 * section (failed gaps and requests, picks) and its artists to check.
 *
 * Since the owner's ruling (2026-11-13) it is Library Matches' To fix section, not Activity's. Its
 * number is the chip's and the page header's (lb-bot's `imports + folders`, `libraryToFixCount`),
 * and the first line says what it is made of: "41 to fix: 16 imports, 25 downloaded folders to
 * file". Activity's own counts are downloads.
 */
export const ToFixSection = () => {
    const { t } = useTranslation();
    const attention = useLbBotAttention().data;
    const downloadsOn = useLbBotDownloadsShown();
    const webUrl = useLbBotWebUrl();
    const activeAddress = useHubStore((s) => s.server?.activeAddress ?? null);
    const section = toFixSection(attention, downloadsOn);

    const parts = [
        section.imports > 0 ? t('naviConnect.toFix.imports', { count: section.imports }) : '',
        section.count > section.imports
            ? t('naviConnect.toFix.folders', { count: section.count - section.imports })
            : '',
    ].filter(Boolean);

    return (
        <Stack data-to-fix="" gap="sm">
            <Text isMuted size="sm">
                {t('naviConnect.toFix.intro')}
            </Text>
            {section.count === 0 ? (
                <Text isMuted>{t('naviConnect.toFix.nothing')}</Text>
            ) : (
                <Text fw={600}>
                    {t('naviConnect.toFix.summary', {
                        count: section.count,
                        parts: parts.join(', '),
                    })}
                </Text>
            )}
            <ImportsRow />
            {section.folders.map((folder) => {
                const link = lbPlaceLink(webUrl, activeAddress, isPrivateAddress, folder.id);
                const detail = folderDetail(folder, (count) =>
                    t('naviConnect.toFix.files', { count }),
                );
                return (
                    <div className={styles.row} data-to-fix-folder="" key={folder.id}>
                        <Stack className={styles.body} gap="0.15rem">
                            <Text isNoSelect lineClamp={1}>
                                {folderTitle(folder, t('naviConnect.toFix.unidentified'))}
                            </Text>
                            <Text isMuted size="sm">
                                {link ? detail : `${detail} · ${t('naviConnect.toFix.folderAway')}`}
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
