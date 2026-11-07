import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './mood-body.module.css';

import { SavedQueueCards } from '/@/renderer/features/home/components/continue-listening-row';
import { MoodTile } from '/@/renderer/features/moods/components/mood-tile';
import { queuesFromMood } from '/@/renderer/features/moods/mood-mix';
import { useArrival } from '/@/renderer/features/motion/use-arrival';
import { useContinueListening, useCurrentServerId, useHubSavedQueueId } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { MoodEntry } from '/@/shared/types/mood-types';

/**
 * A selected mood: its heading, its four tiles, and the saved queues its tiles made. While the
 * catalogue cannot be refreshed it says so, with Retry, instead of the tiles.
 */
export const MoodBody = ({
    mood,
    onRetry,
    unavailable,
}: {
    mood: MoodEntry;
    onRetry: () => void;
    unavailable: boolean;
}) => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();
    const activeId = useHubSavedQueueId();
    const queues = useContinueListening(serverId, 200);
    const saved = useMemo(
        () =>
            queuesFromMood(
                queues,
                mood.variants.map((v) => v.title),
            ),
        [mood.variants, queues],
    );
    const { propsFor } = useArrival(mood.variants.length > 0 && !unavailable, undefined, {
        once: false,
    });
    const arrivals = useMemo(
        () => mood.variants.map((_, index) => propsFor(index)),
        [mood.variants, propsFor],
    );

    return (
        <section className={styles.body} data-mood-body={mood.id}>
            <div className={styles.heading}>
                <TextTitle className={styles.label} order={2}>
                    {mood.label}
                </TextTitle>
                <Text isMuted size="sm">
                    {t('naviConnect.moods.ownedOnly')}
                </Text>
            </div>
            {unavailable ? (
                <div className={styles.state} data-mood-state="unavailable">
                    <Text fw={600}>{t('naviConnect.moods.unavailable')}</Text>
                    <Text isMuted size="sm">
                        {t('naviConnect.moods.unavailableBody')}
                    </Text>
                    <Button onClick={onRetry} size="compact-sm" variant="default">
                        {t('naviConnect.moods.retry')}
                    </Button>
                </div>
            ) : mood.variants.length === 0 ? (
                <Text data-mood-state="empty" isMuted size="sm">
                    {t('naviConnect.moods.empty')}
                </Text>
            ) : (
                <div className={styles.tiles}>
                    {mood.variants.map((variant, index) => (
                        <MoodTile
                            arrival={arrivals[index]}
                            key={`${mood.id}/${variant.id}`}
                            mood={mood}
                            variant={variant}
                        />
                    ))}
                </div>
            )}
            {saved.length > 0 && (
                <div className={styles.saved}>
                    <TextTitle className={styles.savedTitle} order={3}>
                        {t('naviConnect.moods.savedFrom')}
                    </TextTitle>
                    <SavedQueueCards activeId={activeId} entries={saved} />
                </div>
            )}
        </section>
    );
};
