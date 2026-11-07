import { failedRowWishlistExplain } from '/@/renderer/features/lbbot/components/wishlist-copy';
import { LedgerRow } from '/@/renderer/features/lbbot/stores/active-fills.store';
import { leftOutText } from '/@/renderer/features/lbbot/utils/album-download';
import { LbBotFillState } from '/@/shared/types/lbbot-types';

/**
 * navi-connect: the acquisition vocabulary, PROTOCOL.md §15.2.
 *
 * One state renders the same words and offers the same buttons in every place
 * a fill is shown — the downloads view, the missing-album modal, the tile —
 * and in Worbus for Android, which implements the same table in `FillVocabulary.kt`. There
 * is no shared build between the two clients, so the table in PROTOCOL is the
 * contract and this file is Worbus for desktop's copy of it. Change one, change all three.
 */

export type FillButton =
    | 'allowMp3'
    | 'cancel'
    | 'dismiss'
    | 'openAlbum'
    | 'retry'
    | 'tryAnother'
    | 'wishlist';

export interface FillPresentation {
    buttons: FillButton[];
    /** One sentence saying why no action is offered, or what the wishlist is for. */
    explain: string;
    headline: string;
    percent: number;
    progress: 'determinate' | 'indeterminate' | 'none';
    sublines: string[];
}

/** The failure in a few words, from `failureKind`. lb-bot's own sentence
 *  (`reason`) stays below it, verbatim — it carries the evidence. */
export const FAILURE_HEADLINE: Record<string, string> = {
    format_rejected: 'No copy in an allowed format',
    mb_unavailable: "Downloaded — MusicBrainz wouldn't answer, so it couldn't be tagged",
    no_source: 'Nobody is sharing this one',
    placement_failed: "Downloaded, but couldn't be filed into the library",
    transfer_failed: 'The download itself failed',
};

/** Headline for a fill that is still running, by lb-bot state. */
export const RUNNING_HEADLINE: Partial<Record<LbBotFillState, string>> = {
    downloading: 'Downloading',
    placed: 'Added — waiting for the library scan',
    placing: 'Adding to the library',
    queued: 'Waiting for the peer',
    searching: 'Looking for a source',
    unknown: 'Looking for a source',
};

/** The short badge on a tile. */
export const SHORT_STATE: Partial<Record<LbBotFillState, string>> = {
    cancelled: 'Cancelled',
    downloading: 'Downloading',
    failed: 'Failed',
    needs_match: 'Needs review',
    placed: 'Added',
    placing: 'Adding',
    queued: 'Queued',
    searching: 'Searching',
    verified: 'In your library',
};

export const EXPLAIN_NO_ACTION =
    'Asking again would hit the same problem — this one needs fixing in lb-bot.';

/** How long a row may go unanswered before it says so, in consecutive ticks. */
export const UNREACHABLE_AFTER_ERRORS = 2;

export const formatBytes = (bytes: number): string => {
    if (!bytes || bytes < 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
};

export const formatSpeed = (bytesPerSecond: number): string =>
    `${(Math.max(0, bytesPerSecond) / (1024 * 1024)).toFixed(1)} MB/s`;

const seconds = (ms: number): number => Math.max(0, Math.round(ms / 1000));

/**
 * Everything a row needs to render itself. Pure: the same row and the same
 * clock give the same answer, which is what makes the table checkable against
 * PROTOCOL §15.2 by reading rather than by driving the UI. Worbus P1: `downloadsShown` false
 * (downloading is off) changes only the wishlist sentence; the buttons are dropped by
 * `useFillActions`.
 */
export const describeFill = (
    row: LedgerRow,
    now: number = Date.now(),
    downloadsShown = true,
): FillPresentation => {
    const buttons: FillButton[] = [];
    const sublines: string[] = [];
    let headline = '';
    let explain = '';
    let progress: FillPresentation['progress'] = 'none';
    let percent = 0;

    const failed = row.settled && row.outcome === 'failed';
    const retryable = failed && (row.failureKind === '' || row.retryable);
    const wishlistable = failed && row.failureKind === 'no_source' && !!row.rgid;

    if (!row.settled) {
        const state = (row.state || 'unknown') as LbBotFillState;
        headline = RUNNING_HEADLINE[state] ?? RUNNING_HEADLINE.unknown!;
        if (state === 'downloading') {
            headline = row.total ? `Downloading ${row.done} of ${row.total}` : 'Downloading';
            const parts: string[] = [];
            if (row.bytesTotal > 0) {
                parts.push(`${formatBytes(row.bytesDone)} of ${formatBytes(row.bytesTotal)}`);
            }
            if (row.speedBps > 0) parts.push(formatSpeed(row.speedBps));
            if (row.lastSourcePeer) parts.push(`@${row.lastSourcePeer}`);
            if (row.failed > 0) parts.push(`${row.failed} failed`);
            // B-084: files of the folder that were not asked for (lb-bot's `leftOut`).
            if (leftOutText(row.leftOut)) parts.push(leftOutText(row.leftOut));
            if (parts.length) sublines.push(parts.join(' · '));
            progress = row.bytesTotal > 0 || row.total > 0 ? 'determinate' : 'indeterminate';
            percent = row.percent;
        } else if (state === 'queued') {
            if (row.lastSourcePeer) sublines.push(`@${row.lastSourcePeer}`);
            progress = 'indeterminate';
        } else if (state === 'placing' || state === 'placed') {
            progress = 'determinate';
            percent = 100;
        } else {
            // searching, and the first seconds before lb-bot has written a row
            if (row.reason) sublines.push(row.reason);
            progress = 'indeterminate';
        }
        if (row.lastErrorTicks >= UNREACHABLE_AFTER_ERRORS && row.lastCheckedAt) {
            sublines.push(
                `Can't reach lb-bot — last checked ${seconds(now - row.lastCheckedAt)}s ago`,
            );
        }
        if (row.cancellable) buttons.push('cancel');
        if (state === 'placed' && row.rgid) buttons.push('openAlbum');
        return { buttons, explain, headline, percent, progress, sublines };
    }

    switch (row.outcome) {
        case 'cancelled':
            headline = 'Cancelled';
            if (row.rgid) buttons.push('openAlbum');
            break;
        case 'done':
            headline = row.verifyGaveUp
                ? "Added — Navidrome hasn't indexed it yet"
                : 'In your library';
            if (leftOutText(row.leftOut)) sublines.push(leftOutText(row.leftOut));
            if (row.rgid) buttons.push('openAlbum');
            break;
        case 'gaveUp':
            headline = 'Stopped tracking this one';
            if (row.reason) sublines.push(row.reason);
            if (row.rgid) buttons.push('openAlbum');
            break;
        case 'needsPick':
            // The picker is the gaps box on the album page; there is no rgid to
            // route to from a gap row, so the row says where to go rather than
            // offering a button that could not.
            headline = 'Waiting for you to pick a source';
            explain = 'Open the album to pick a source.';
            break;
        default:
            // B-011 / ruling R10: a gap's own `stalledPlacement` — files
            // already DOWNLOADED but never filed — is the same situation an
            // album fill's `needs_match` state names, reached a different
            // way (lb-bot flips the GROUP to `failed`, since a gap has no
            // `needs_match` status of its own). Same row: no Retry (a fresh
            // source search cannot help), `reason` carries lb-bot's
            // `failDetail` sentence (set in `applyGapSummary`), never the
            // raw `stalled_placement` token.
            if (row.state === 'needs_match' || (row.isGap && row.stalledPlacement)) {
                headline = 'Downloaded, but needs sorting out in lb-bot';
                if (row.reason) sublines.push(row.reason);
                break;
            }
            headline = FAILURE_HEADLINE[row.failureKind] ?? "Couldn't get this one";
            if (row.reason) sublines.push(row.reason);
            if (row.attempts > 1) sublines.push(`Tried ${row.attempts} times`);
            if (row.retryAt > now) {
                sublines.push(`Retrying automatically in ${seconds(row.retryAt - now)}s`);
                if (row.cancellable) buttons.push('cancel');
            }
            if (row.mp3WouldHelp) buttons.push('allowMp3');
            if (retryable) buttons.push('retry');
            if (!row.isGap && row.otherSourceExcludes.length > 0) buttons.push('tryAnother');
            if (wishlistable) {
                buttons.push('wishlist');
                explain = failedRowWishlistExplain(downloadsShown);
            } else if (!retryable && !row.mp3WouldHelp) {
                explain = EXPLAIN_NO_ACTION;
            }
    }
    buttons.push('dismiss');
    return { buttons, explain, headline, percent, progress, sublines };
};
