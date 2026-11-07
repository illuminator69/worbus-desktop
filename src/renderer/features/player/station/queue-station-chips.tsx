import { useTranslation } from 'react-i18next';

import styles from './queue-station-chips.module.css';

import { SidewaysRow } from '/@/renderer/components/sideways-row/sideways-row';
import {
    ChipId,
    chipLine,
    chipsFor,
    selectedChip,
} from '/@/renderer/features/player/station/station-chips';
import { tapStationChip } from '/@/renderer/features/player/station/use-station-autoplay';
import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { describeQueueSource } from '/@/renderer/features/sonic/audio-muse-palette';
import { Button } from '/@/shared/components/button/button';
import { Text } from '/@/shared/components/text/text';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

/**
 * The queue's autoplay chips (I-041), one row under the queue's header as YouTube Music has
 * them: Off, Close, Balanced, Explore with the hub's station engine, Off and Auto DJ without it.
 * The selected one is filled. A queue that belongs to a station shows that station's state,
 * which every device shares; any other queue shows this device's preference.
 *
 * A tap acts on the queue now (station-chips.ts). With a hub that edits stations itself the tap
 * only signals and the queue changes through the session; otherwise this client edits it.
 *
 * Under the row, one line says what built the queue ("Moon Song radio · Balanced", "Auto DJ")
 * and what happens next, cut with an ellipsis and whole in its tooltip (B-146: as a badge in the
 * toolbar a long radio name made the side queue scroll sideways). The row scrolls inside
 * itself (`SidewaysRow`, the wheel included: it sits in the queue's fixed head, B-285), and the
 * line is always there, so it coming and going never moves the queue. It is text only: no
 * coloured dot before it (B-152).
 */
export const QueueStationChips = () => {
    const { t } = useTranslation();
    const words = useStationWords();
    const selected = selectedChip({
        autoplay: words.autoplay,
        bound: words.bound,
        mode: words.mode,
        preferred: words.preferred,
    });

    const origin = describeQueueSource({
        autoplay: words.autoplay,
        bound: words.bound,
        characterLabel: words.characterLabel,
        labels: {
            autoDj: t('setting.autoDJ'),
            viaNavidrome: t('naviConnect.station.viaNavidrome'),
        },
        mode: words.mode,
        stationName: words.stationName,
    });
    const line = chipLine(origin?.label ?? null, words.status);

    const labelOf = (chip: ChipId): string => {
        if (chip === 'off') return t('naviConnect.station.chipOff');
        if (chip === 'autoDj') return t('setting.autoDJ');
        return words.characterLabel(chip);
    };
    const descriptionOf = (chip: ChipId): string | undefined =>
        chip === 'off' || chip === 'autoDj'
            ? undefined
            : words.characters.find((row) => row.id === chip)?.description;

    return (
        <div className={styles.root}>
            <SidewaysRow className={styles.row} role="radiogroup" wheel="chrome">
                {chipsFor(words.mode).map((chip) => {
                    const description = descriptionOf(chip);
                    return (
                        <Button
                            aria-checked={selected === chip}
                            className={styles.chip}
                            key={chip}
                            onClick={() => {
                                if (selected !== chip) tapStationChip(chip);
                            }}
                            radius="xl"
                            role="radio"
                            size="compact-sm"
                            tooltip={
                                description ? { label: description, openDelay: 500 } : undefined
                            }
                            variant={selected === chip ? 'filled' : 'default'}
                        >
                            {labelOf(chip)}
                        </Button>
                    );
                })}
            </SidewaysRow>
            <div className={styles.line}>
                {line && (
                    <Tooltip label={line} multiline openDelay={300} w={320}>
                        <Text className={styles.text} isMuted isNoSelect size="xs">
                            {line}
                        </Text>
                    </Tooltip>
                )}
            </div>
        </div>
    );
};
