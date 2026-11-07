import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import styles from '../routes/lbbot-downloads-route.module.css';

import { useLbBotAttention, useLbBotWebUrl } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { attentionImports, importsRow, lbPageLink } from '/@/renderer/features/lbbot/lb-page-link';
import { Fold } from '/@/renderer/features/motion/fold';
import { useHubStore } from '/@/renderer/store/hub.store';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { isPrivateAddress } from '/@/shared/utils/hub-addresses';

/**
 * Worbus P4 (design §6.5): "N imports need you", the albums lb-bot could not finish filing, with
 * Open in lb-bot at the page's list. No import actions here; the page has them. Away from home
 * with no `webUrl` there is nowhere to open, and the line says so instead of offering a button.
 * The button is a `_blank` link, which main hands to the system browser (`setWindowOpenHandler`).
 */
export const ImportsRow = () => {
    const { t } = useTranslation();
    const attention = useLbBotAttention().data;
    const webUrl = useLbBotWebUrl();
    const activeAddress = useHubStore((s) => s.server?.activeAddress ?? null);
    const current = importsRow(
        attentionImports(attention),
        lbPageLink(webUrl, activeAddress, isPrivateAddress),
    );
    // While the row folds closed the last one stays drawn, so the fold has something to close over.
    const last = useRef(current);
    if (current) last.current = current;
    const drawn = current ?? last.current;

    return (
        <Fold name="imports-row" open={current !== null}>
            {drawn && (
                <div className={styles.row} data-imports-row="">
                    <Stack className={styles.body} gap="0.15rem">
                        <Text isNoSelect lineClamp={1}>
                            {t('naviConnect.imports.title', { count: drawn.count })}
                        </Text>
                        <Text isMuted size="sm">
                            {t(
                                drawn.link
                                    ? 'naviConnect.imports.line'
                                    : 'naviConnect.imports.lineAway',
                            )}
                        </Text>
                    </Stack>
                    {drawn.link && (
                        <Button
                            component="a"
                            href={drawn.link}
                            rel="noreferrer"
                            target="_blank"
                            variant="subtle"
                        >
                            {t('naviConnect.imports.open')}
                        </Button>
                    )}
                </div>
            )}
        </Fold>
    );
};
