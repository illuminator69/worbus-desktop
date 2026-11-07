import clsx from 'clsx';
import { ReactNode, useState } from 'react';

import styles from './mood-section.module.css';

import { MoodBody } from '/@/renderer/features/moods/components/mood-body';
import { MoodChips } from '/@/renderer/features/moods/components/mood-chips';
import { useMoodCatalogue } from '/@/renderer/features/moods/mood-client';
import { chipsVisible, findMood, homeMoods, toggleMood } from '/@/renderer/features/moods/mood-mix';
import { Fold } from '/@/renderer/features/motion/fold';
import { MoodEntry } from '/@/shared/types/mood-types';

/**
 * Home's moods: the chips, and under them either a selected mood's body or everything else on
 * Home (`children`: the feature carousel, Continue listening and the shelves). Selecting a chip
 * folds the shelves closed and the body open; clearing reverses it; both stay mounted, so
 * nothing refetches. With no chips (no hub, an older hub, mood search off) only the shelves
 * show, exactly as Home is without moods. The selection is local: leaving Home resets it, and
 * so does a hub that stops having moods.
 */
export const MoodSection = ({ children }: { children: ReactNode }) => {
    const { catalogue, isError, refetch } = useMoodCatalogue();
    const visible = chipsVisible(catalogue);
    const [selected, setSelected] = useState<null | string>(null);
    // The body keeps showing the last mood while it folds closed.
    const [shown, setShown] = useState<MoodEntry | null>(null);

    const mood = visible && selected ? (findMood(catalogue, selected) ?? null) : null;
    if (!visible && selected !== null) setSelected(null);
    if (mood && mood !== shown) setShown(mood);

    // One tree whether or not the chips show, so the shelves never remount when the catalogue
    // arrives or goes. Without chips the mood fold is closed (no height) and the shelves sit
    // where they would without moods.
    return (
        <div className={styles.section}>
            {visible && catalogue && (
                <MoodChips
                    moods={homeMoods(catalogue)}
                    onClear={() => setSelected(null)}
                    onSelect={(id) => setSelected(toggleMood(selected, id))}
                    selected={mood ? mood.id : null}
                />
            )}
            <Fold name="mood" open={!!mood}>
                <div className={styles.space}>
                    {/* Keyed by mood: each mood's tiles arrive once when it opens. */}
                    {shown && (
                        <MoodBody
                            key={shown.id}
                            mood={shown}
                            onRetry={refetch}
                            unavailable={isError}
                        />
                    )}
                </div>
            </Fold>
            <Fold name="shelves" open={!mood} tall>
                <div className={clsx(visible && styles.space)}>{children}</div>
            </Fold>
        </div>
    );
};
