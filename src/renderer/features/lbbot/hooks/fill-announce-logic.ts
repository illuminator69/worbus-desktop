import type { FillOutcome } from '/@/renderer/features/lbbot/stores/active-fills.store';
import type { LbBotGap } from '/@/shared/types/lbbot-types';

/**
 * B-026 (Worbus for desktop half): what `useFillAnnouncements` should say about a row that
 * just settled, kept apart from the toast/notify wiring so the decision can be
 * tested with `node --test` (no runtime imports here — see the harness).
 *
 * The bug this closes: a settled `'failed'` outcome does not always mean lb-bot
 * failed to get anything. Two cases reach `'failed'` with the files already sitting
 * in lb-bot, waiting to be filed:
 *   - a gap whose placement stalled (`stalledPlacement`, PROTOCOL §15.2's
 *     needs_match row, rulings R10/R15/R17) — the tracks downloaded but a rename
 *     or move needs a human in lb-bot's own workspace;
 *   - an album fill lb-bot reports as `needs_match` (`outcomeFor` in
 *     `use-lbbot.ts` folds this into `'failed'` before it ever reaches here).
 * Both should read as "downloaded, needs sorting out" rather than "couldn't get
 * it" — the second sends the user looking for a retry that would only refetch
 * files already on disk.
 *
 * Final-review fix: this module also owns the "needs sorting out" toast's link
 * target now (`announcementLinkPathFor`), because getting it wrong here is the
 * same mistake as getting the wording wrong — `ActiveFill.groupId` looks exactly
 * like `ActiveGap.groupId` at the call site (same field name, same "a status poll
 * learned this" story) but is NOT a review-group id at `needs_match`: lb-bot
 * repoints it at an import-recovery record (`rec<N>`,
 * `listenbrainz_bot.py`'s `_album_fill_set`), and `#/gaps/rec17` is a page lb-bot
 * answers "Group not found" on. Only `ActiveGap.groupId` resolves `#/gaps/<id>`.
 *
 * Q-031 (Worbus for desktop half): lb-bot reports `picking` for two different buckets — the
 * picker holding candidates and waiting on the user ("your move"), and the
 * `needs_match` bucket, files already `downloaded` and waiting on a manual match
 * only lb-bot's own workspace can do. `gapAwaitingMatch` is the one predicate
 * that tells them apart, shared by `applyGapSummary`'s settle (`use-lbbot.ts`,
 * via `gapSettleOutcome`) and the album page's gaps box (`gap-stage.ts`'s
 * attention stage, R11). Two copies of this test would drift the way the
 * ledger and the old gap modal already had.
 */

/** Which of the two settled-row toasts to show; `null` means say nothing (the
 *  outcome is `'cancelled'`, `'needsPick'`, `'gaveUp'` or `'running'` — each of
 *  those already announces itself, or announces nothing, elsewhere). */
export type AnnounceKind = 'couldntGet' | 'done' | 'needsSorting';

/** The fields `useFillAnnouncements` reads off a ledger row (fill or gap) to
 *  decide what to say and where to link. `state` is the row's raw state string,
 *  not the outcome — it is how a `needs_match` album fill is told apart from any
 *  other failure, since `outcomeFor` has already folded both into `'failed'` by
 *  the time the row reaches the ledger. `isGap` and `groupId` are read by
 *  `announcementLinkPathFor` only; `announcementKindFor` ignores them. */
export interface AnnounceRow {
    /** The id off the row, whatever it currently means for this row's kind —
     *  see the module doc comment. Never assume it is a review-group id. */
    groupId?: string;
    /** Which ledger map the row came from — tag it at the point `rows` is built
     *  (`use-fill-announcements.ts`), never infer it from `stalledPlacement`
     *  being falsy: an *unstalled* gap has no stalledPlacement either. */
    isGap: boolean;
    outcome: FillOutcome;
    stalledPlacement?: boolean;
    state?: string;
}

/**
 * `null` for every outcome that isn't worth announcing here (mirrors the
 * `if (outcome === 'done') ... else if (outcome === 'failed') ...` branch in
 * `useFillAnnouncements` — `cancelled`/`needsPick`/`gaveUp`/`running` fall
 * through untouched, same as before this change).
 */
export const announcementKindFor = (row: AnnounceRow): AnnounceKind | null => {
    if (row.outcome === 'done') return 'done';
    if (row.outcome !== 'failed') return null;
    if (row.stalledPlacement || row.state === 'needs_match') return 'needsSorting';
    return 'couldntGet';
};

/**
 * The path (relative to lb-bot's `webUrl`) the "needs sorting out" toast should
 * link to, or `''` when no link is possible. Only meaningful when
 * `announcementKindFor` returned `'needsSorting'` — callers should not call this
 * for any other kind.
 *
 * A gap's `groupId` IS the review group lb-bot's Fill-gaps workspace is keyed
 * on, so it gets the specific page. An album fill's `groupId` at `needs_match`
 * is an import-recovery record id, not a review group — there is no
 * album-specific page for it in lb-bot's SPA (`Lb-bot-missing/web/src/App.jsx`
 * has no route keyed on that id), so it goes to the placement queue
 * (`#/downloads`, `TAB_ROUTES['Downloads'] === 'downloads'`) instead, which is
 * never row-specific but is always the right screen.
 */
export const announcementLinkPathFor = (row: Pick<AnnounceRow, 'groupId' | 'isGap'>): string => {
    if (row.isGap) return row.groupId ? `#/gaps/${encodeURIComponent(row.groupId)}` : '';
    return '#/downloads';
};

/**
 * Q-031: is this gap lb-bot's `needs_match` bucket — files already
 * `downloaded`, waiting on a manual match only lb-bot's own workspace can do —
 * rather than the picker holding candidates and waiting on the user?
 *
 * Mirrors `gapIsBusy`'s reading of `sourceTask`: while the search is
 * `queued`/`running`, nothing the group says about itself is final, so a
 * `downloaded` track seen mid-search does not yet mean the match is stuck.
 */
export const gapAwaitingMatch = (
    gap: Pick<LbBotGap, 'sourceTask' | 'status' | 'tracks'>,
): boolean => {
    const searching = gap.sourceTask?.status === 'queued' || gap.sourceTask?.status === 'running';
    return (
        !searching &&
        gap.status === 'picking' &&
        gap.tracks.some((track) => track.state === 'downloaded')
    );
};

/**
 * Q-031: the settle mapping `applyGapSummary` writes to the ledger for a
 * `picking` gap. `gapAwaitingMatch` routes the needs_match bucket to the same
 * `{ outcome: 'failed', state: 'needs_match' }` shape a stalled placement and
 * an album fill's `needs_match` already use (see `announcementKindFor` and
 * `fill-vocabulary.ts`'s `needs_match` row) — `state` here is a ledger string,
 * not a `LbBotGapStatus`, exactly like `stalledPlacement`'s case reuses
 * `state: 'failed'` for a status lb-bot never reports for a gap. A `picking`
 * gap with no downloaded track stays `needsPick`, unchanged.
 */
export const gapSettleOutcome = (
    gap: Pick<LbBotGap, 'sourceTask' | 'status' | 'tracks'>,
): { outcome: FillOutcome; state: string } => {
    if (gap.status === 'complete') return { outcome: 'done', state: gap.status };
    if (gapAwaitingMatch(gap)) return { outcome: 'failed', state: 'needs_match' };
    if (gap.status === 'picking') return { outcome: 'needsPick', state: gap.status };
    return { outcome: 'failed', state: gap.status };
};

/**
 * B-044: the sentence saying why a gap didn't fill — never lb-bot's `failReason`
 * token (`blocked_no_source`, R10). A stalled placement's `failDetail` is lb-bot's
 * current sentence. Any other `failDetail` comes from a group message kind
 * (`error`/`blocked_no_source`/`download_failed`) lb-bot stopped writing in B-022,
 * so it can only be left over from an older search, with counts that contradict
 * the current verdict: `noSourceReason`, which a new search rewrites, wins over it.
 */
export const gapFailReason = (
    gap: Pick<LbBotGap, 'failDetail' | 'noSourceReason' | 'stalledPlacement'>,
): string => (gap.stalledPlacement ? gap.failDetail : gap.noSourceReason || gap.failDetail) || '';

/**
 * B-042: what the gap cache should hold after a `/lb/fills` summary. The summary
 * is the gap view with its source rows dropped (main normalises the missing key to
 * `sources: []`), but it still carries `sourcesTotal` and `sourcesFoundAt`. Written
 * over the cached gap as-is, it blanked the gap dialog's source list on every
 * ledger poll until the dialog's own `/lb/gap` poll wrote the rows back — the list
 * vanished and returned every ~10 s. The summary wins on every field except the
 * rows, which are kept while they describe the same result set (same
 * `sourcesFoundAt`): Worbus for Android's `applyGapSummary` rule. A new search changes the
 * stamp, and an emptied list is a summary with the rows already gone either way.
 */
export const mergeGapSummary = (prev: LbBotGap | null | undefined, summary: LbBotGap): LbBotGap =>
    summary.sources.length === 0 &&
    prev &&
    prev.sources.length > 0 &&
    prev.sourcesFoundAt === summary.sourcesFoundAt
        ? {
              ...summary,
              sources: prev.sources,
              sourcesPage: prev.sourcesPage,
              sourcesPages: prev.sourcesPages,
          }
        : summary;
