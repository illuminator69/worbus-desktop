import clsx from 'clsx';
import { CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './mood-tile.module.css';

import { lbModalSettings } from '/@/renderer/features/lbbot/components/lb-modal-layout';
import { MoodMixPreview } from '/@/renderer/features/moods/components/mood-mix-preview';
import { MOOD_MIX_SIZE, tileColors, tilePlayResult } from '/@/renderer/features/moods/mood-mix';
import { drawMoodMix, usePlayDrawn } from '/@/renderer/features/moods/use-mood-mix';
import { ArrivalProps } from '/@/renderer/features/motion/use-arrival';
import { useCurrentServerId } from '/@/renderer/store';
import { Icon } from '/@/shared/components/icon/icon';
import { openModal } from '/@/shared/components/modal/modal';
import { toast } from '/@/shared/components/toast/toast';
import { MoodEntry, MoodVariant } from '/@/shared/types/mood-types';

const hsl = ({ h, l, s }: { h: number; l: number; s: number }, alpha = 1) =>
    `hsl(${h} ${s}% ${l}% / ${alpha})`;

/**
 * One of a mood's prompts as a tile: generated art from its two hues (darkened where white text
 * would fall under 4.5:1), the title, "About 50 songs", and a play button. The tile opens the
 * mix's preview; the play button draws one mix and plays it, ignoring taps while it runs.
 */
export const MoodTile = ({
    arrival,
    mood,
    variant,
}: {
    arrival?: ArrivalProps;
    mood: MoodEntry;
    variant: MoodVariant;
}) => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();
    const playDrawn = usePlayDrawn();
    const [busy, setBusy] = useState(false);
    const { from, to } = tileColors(variant);

    const style = {
        ...arrival?.style,
        // Computed from the variant's hues (the one place colours are not theme roles); the ink is
        // white on every tile, which the colours are chosen for.
        '--tile-from': hsl(from),
        '--tile-ink': 'hsl(0 0% 100%)',
        '--tile-ink-2': 'hsl(0 0% 100% / 0.88)',
        '--tile-shadow': 'hsl(0 0% 0% / 0.3)',
        '--tile-stripe': hsl({ h: to.h, l: 70, s: 80 }, 0.14),
        '--tile-to': hsl(to),
    } as CSSProperties;

    const openPreview = () =>
        openModal(
            lbModalSettings(
                variant.title,
                <MoodMixPreview mood={mood} serverId={serverId} variant={variant} />,
                'lg',
            ),
        );

    const play = async () => {
        if (busy || !serverId) return;
        setBusy(true);
        try {
            const drawn = await drawMoodMix({
                depth: mood.depth,
                maxSeconds: mood.maxSeconds,
                mood: mood.id,
                serverId,
                variant: variant.id,
            });
            const result = tilePlayResult(drawn.state);
            if (!result.play) {
                toast.error({
                    message:
                        result.notice === 'unavailable'
                            ? t('naviConnect.moods.unavailable')
                            : t('naviConnect.moods.empty'),
                    title: t('naviConnect.moods.playFailed', { title: variant.title }),
                });
                return;
            }
            playDrawn(drawn.songs, variant.title);
            // A short mix plays, but never as "About 50 songs" without a word.
            if (result.notice === 'short') {
                toast.info({
                    message: t('naviConnect.moods.short', { count: drawn.songs.length }),
                    title: variant.title,
                });
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className={clsx(styles.tile, arrival?.className)}
            data-arrive={arrival?.['data-arrive']}
            data-mood-tile={`${mood.id}/${variant.id}`}
            style={style}
        >
            <button className={styles.open} onClick={openPreview} type="button">
                <span className={styles.title}>{variant.title}</span>
                <span className={styles.line}>
                    {t('naviConnect.moods.aboutSongs', { count: MOOD_MIX_SIZE })}
                </span>
            </button>
            <button
                aria-busy={busy || undefined}
                aria-label={t('naviConnect.moods.play', { title: variant.title })}
                className={styles.play}
                onClick={() => void play()}
                type="button"
            >
                <Icon animate={busy ? 'spin' : undefined} icon={busy ? 'spinner' : 'mediaPlay'} />
            </button>
        </div>
    );
};
