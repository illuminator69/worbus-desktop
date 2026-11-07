import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LbModalLayout } from '/@/renderer/features/lbbot/components/lb-modal-layout';
import { drawMoodMix, usePlayDrawn } from '/@/renderer/features/moods/use-mood-mix';
import { PreviewSongRow } from '/@/renderer/features/shared/components/preview-song-row';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { Song } from '/@/shared/types/domain-types';
import { MoodEntry, MoodVariant } from '/@/shared/types/mood-types';

type Draw = { songs: Song[]; state: 'empty' | 'ready' | 'short' | 'unavailable' };

const length = (songs: Song[]): string => {
    const minutes = Math.round(songs.reduce((sum, s) => sum + (s.duration ?? 0), 0) / 60000);
    const h = Math.floor(minutes / 60);
    return h > 0 ? `${h} h ${minutes % 60} min` : `${minutes} min`;
};

/**
 * A tile's mix before it plays: one draw, shown as the list that will play. "Play these" plays
 * exactly these rows; Retry draws again. Closing the modal aborts a draw in flight (no toast).
 */
export const MoodMixPreview = ({
    mood,
    serverId,
    variant,
}: {
    mood: MoodEntry;
    serverId: null | string;
    variant: MoodVariant;
}) => {
    const { t } = useTranslation();
    const playDrawn = usePlayDrawn();
    const [draw, setDraw] = useState<Draw | null>(null);
    const controller = useRef<AbortController | null>(null);

    const run = useCallback(() => {
        controller.current?.abort();
        const abort = new AbortController();
        controller.current = abort;
        setDraw(null);
        if (!serverId) {
            setDraw({ songs: [], state: 'unavailable' });
            return;
        }
        drawMoodMix({
            depth: mood.depth,
            maxSeconds: mood.maxSeconds,
            mood: mood.id,
            serverId,
            signal: abort.signal,
            variant: variant.id,
        }).then(
            (result) => {
                if (!abort.signal.aborted) setDraw(result);
            },
            () => {
                // Aborted (the modal closed or Retry started another draw): nothing to show.
            },
        );
    }, [mood.depth, mood.id, mood.maxSeconds, serverId, variant.id]);

    useEffect(() => {
        run();
        return () => controller.current?.abort();
    }, [run]);

    const close = (
        <Button onClick={() => closeAllModals()} variant="subtle">
            {t('common.close')}
        </Button>
    );
    const retry = (
        <Button onClick={run} variant="default">
            {t('naviConnect.moods.retry')}
        </Button>
    );

    if (!draw) {
        // Skeleton rows in the dialog's final height, so nothing jumps when the list lands.
        return (
            <LbModalLayout
                footer={<Group justify="flex-end">{close}</Group>}
                header={
                    <Text isMuted size="sm">
                        {t('naviConnect.moods.building', { title: variant.title })}
                    </Text>
                }
            >
                <Stack data-mood-preview="building" gap="xs">
                    {Array.from({ length: 8 }, (_, index) => (
                        <Skeleton height={44} key={index} />
                    ))}
                </Stack>
            </LbModalLayout>
        );
    }

    if (draw.state === 'unavailable' || draw.state === 'empty') {
        return (
            <LbModalLayout
                footer={
                    <Group justify="flex-end">
                        {close}
                        {retry}
                    </Group>
                }
            >
                <Stack data-mood-preview={draw.state} gap="xs">
                    {draw.state === 'unavailable' ? (
                        <>
                            <Text fw={600}>{t('naviConnect.moods.unavailable')}</Text>
                            <Text isMuted size="sm">
                                {t('naviConnect.moods.unavailableBody')}
                            </Text>
                        </>
                    ) : (
                        <Text isMuted size="sm">
                            {t('naviConnect.moods.empty')}
                        </Text>
                    )}
                </Stack>
            </LbModalLayout>
        );
    }

    return (
        <LbModalLayout
            footer={
                <Group justify="flex-end">
                    {close}
                    {draw.state === 'short' && retry}
                    <Button
                        onClick={() => {
                            // Close first: playing may open the app's "Discard the current
                            // queue?" confirm, which closing all modals afterwards would cancel.
                            closeAllModals();
                            playDrawn(draw.songs, variant.title);
                        }}
                        variant="filled"
                    >
                        {t('naviConnect.moods.playThese')}
                    </Button>
                </Group>
            }
            header={
                <Text isMuted size="sm">
                    {draw.state === 'short'
                        ? t('naviConnect.moods.short', { count: draw.songs.length })
                        : t('naviConnect.moods.previewHeader', {
                              count: draw.songs.length,
                              length: length(draw.songs),
                              mood: mood.label,
                          })}
                </Text>
            }
        >
            <Stack data-mood-preview={draw.state} gap={2}>
                {draw.songs.map((song, index) => (
                    <PreviewSongRow
                        imageId={song.imageId}
                        imageUrl={song.imageUrl}
                        key={`${song.id}-${index}`}
                        serverId={song._serverId}
                        subtitle={[song.artistName, song.album].filter(Boolean).join(' · ')}
                        title={song.name}
                    />
                ))}
            </Stack>
        </LbModalLayout>
    );
};
