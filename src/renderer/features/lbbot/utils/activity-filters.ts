import { needsYou } from '../../sidebar/utils/sidebar-groups.ts';

/**
 * Activity's chips (the ledger's filters), pure so a harness can count them against the sidebar
 * badge. All are predicates over what the ledger already carries, `outcome` and `settled`, so none
 * of this is new vocabulary and nothing here polls.
 */
export type LedgerFilter = 'all' | 'done' | 'failed' | 'needsYou' | 'running';

export const LEDGER_MATCHES: Record<
    LedgerFilter,
    (row: { outcome: string; settled: boolean }) => boolean
> = {
    all: () => true,
    done: (row) => row.settled && row.outcome === 'done',
    // Everything that ended in something other than success, cancellations and
    // "stopped tracking this one" included: the question the chip answers is
    // "what didn't I get", not "what errored".
    failed: (row) => row.settled && row.outcome !== 'done',
    // B-406 review L2: the sidebar badge's own set (failed, or waiting for a pick), so the badge's
    // number is a chip's number.
    needsYou,
    running: (row) => !row.settled,
};

// B-406: the chips count downloads, and All says so (the owner read "All (6)" against a badge of
// 41 that was mostly lb-bot's imports and folders).
export const FILTER_LABEL: Record<LedgerFilter, string> = {
    all: 'All downloads',
    done: 'In your library',
    failed: "Didn't land",
    needsYou: 'Need you',
    running: 'In flight',
};

export const FILTER_ORDER: LedgerFilter[] = ['all', 'needsYou', 'running', 'failed', 'done'];
