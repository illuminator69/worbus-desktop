import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './index-progress-bar.module.css';

import {
    indexBarState,
    IndexBarState,
    indexBarText,
} from '/@/renderer/features/home/index-progress';
import { useLbBotIndexProgress } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Fold } from '/@/renderer/features/motion/fold';
import { Progress } from '/@/shared/components/progress/progress';

/**
 * Home's index bar (Worbus P1, F5): lb-bot's index build, "Indexing your library · N of M artists
 * left · <artist>", over the shared Progress.
 *
 * The only subscriber to the progress (`useLbBotIndexProgress`): a push every few seconds
 * re-renders this and nothing else on Home. It is always mounted, inside a `Fold` (the shared
 * motion clock: its row track eases 0fr to 1fr with the opacity, and no transition under reduced
 * motion), so it unfolds when a build starts and folds away at 0. While folding away it keeps its
 * last words rather than going blank. Nothing on the path sets `overflow-anchor`, so with Home
 * scrolled Chromium's scroll anchoring keeps the shelves in view as it opens and closes.
 */
export const IndexProgressBar = () => {
    const { i18n, t } = useTranslation();
    const progress = useLbBotIndexProgress();
    // `useLbBotIndexProgress` is null while lb-bot is unavailable, so `available` is implied.
    const state = indexBarState(true, progress);
    const last = useRef<Extract<IndexBarState, { show: true }> | null>(null);
    if (state.show) last.current = state;
    const shown = last.current;
    const format = useMemo(() => new Intl.NumberFormat(i18n.language).format, [i18n.language]);
    const line = shown ? indexBarText(shown, format) : null;

    return (
        <Fold name="index-progress" open={state.show}>
            <div className={styles.slot} data-index-progress="">
                {shown && line && (
                    <div className={styles.banner}>
                        {/* Said once to assistive tech: as the bar's name (Mantine puts
                            `aria-label` on the progressbar itself), so the line is hidden. With
                            no bar (B-332, failed lookups), the line itself is what is read. */}
                        <div
                            aria-hidden={'fraction' in shown ? 'true' : undefined}
                            className={styles.text}
                        >
                            {t(line.key, line.values)}
                        </div>
                        {/* B-332: a build that ended with failed lookups has no bar to fill. */}
                        {'fraction' in shown ? (
                            <Progress
                                aria-label={t(line.key, line.values)}
                                size="sm"
                                value={shown.fraction * 100}
                            />
                        ) : null}
                    </div>
                )}
            </div>
        </Fold>
    );
};
