/**
 * Home's index bar (Worbus P1, F5): whether it shows and what it says. Pure and import-free
 * (`index-progress.harness.ts`); the component passes the line to `t(key, values)`.
 *
 * It shows while lb-bot is available and still has artists with no index row (`unindexed > 0`).
 * lb-bot sends `{unindexed: 0}` when a build ends, then no progress at all: both hide it. While
 * lb-bot is unavailable it hides too - the hub keeps the last progress then, and a bar for a
 * gone lb-bot would never end.
 */

export type IndexBarState =
    | { current: string; fraction: number; left: number; show: true; total: number }
    | { show: false };

export const indexBarState = (
    available: boolean,
    progress: null | { current: string; total: number; unindexed: number },
): IndexBarState => {
    if (!available || !progress || progress.unindexed <= 0) return { show: false };
    const { current, total, unindexed } = progress;
    const fraction = total > 0 ? Math.min(1, Math.max(0, (total - unindexed) / total)) : 0;
    return { current, fraction, left: unindexed, show: true, total };
};

/** "Indexing your library · {left} of {total} artists left · {current}" (Worbus for Android's words); the last
 *  part only when lb-bot names the artist it is reading. */
export const indexBarText = (
    state: Extract<IndexBarState, { show: true }>,
    format: (value: number) => string,
): { key: string; values: Record<string, string> } => {
    const values = { current: state.current, left: format(state.left), total: format(state.total) };
    return {
        key: state.current
            ? 'naviConnect.indexProgress.countsWithCurrent'
            : 'naviConnect.indexProgress.counts',
        values,
    };
};
