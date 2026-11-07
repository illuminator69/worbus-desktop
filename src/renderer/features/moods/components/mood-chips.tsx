import { useTranslation } from 'react-i18next';

import styles from './mood-chips.module.css';

import { SidewaysRow } from '/@/renderer/components/sideways-row/sideways-row';
import { Icon } from '/@/shared/components/icon/icon';
import { MoodEntry } from '/@/shared/types/mood-types';

/**
 * Home's mood chips: the hub's home moods in its order, and a clear chip first while one is
 * selected. A group of buttons (Tab through them, Enter or Space selects); the row scrolls sideways
 * instead of clipping (`SidewaysRow`). It sits in Home's scrolling page, so the plain wheel stays
 * the page's; Shift+wheel and the edge buttons move the row.
 */
export const MoodChips = ({
    moods,
    onClear,
    onSelect,
    selected,
}: {
    moods: MoodEntry[];
    onClear: () => void;
    onSelect: (id: string) => void;
    selected: null | string;
}) => {
    const { t } = useTranslation();
    return (
        <SidewaysRow
            aria-label={t('naviConnect.moods.label')}
            className={styles.row}
            data-mood-chips
            role="group"
            wheel="page"
        >
            {selected && (
                <button
                    aria-label={t('naviConnect.moods.clearMood')}
                    className={styles.clear}
                    data-mood-clear
                    onClick={onClear}
                    title={t('naviConnect.moods.clearMood')}
                    type="button"
                >
                    <Icon icon="x" />
                </button>
            )}
            {moods.map((mood) => (
                <button
                    aria-pressed={mood.id === selected}
                    className={styles.chip}
                    data-mood-chip={mood.id}
                    key={mood.id}
                    onClick={() => onSelect(mood.id)}
                    type="button"
                >
                    {mood.label}
                </button>
            ))}
        </SidewaysRow>
    );
};
