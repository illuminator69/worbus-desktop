import type { LbBotGap } from '/@/shared/types/lbbot-types';

/**
 * navi-connect: when the ledger's gap watch (`use-lbbot.ts applyGapSummary`) settles, out of the
 * hook so a harness can replay a fill (B-233). Pure.
 *
 * The watch settles on the first read that counts and says the fill has ended, with no grace.
 * It used to refuse to settle for a flat 90 s after it started, on the reading that "the POST
 * returns before lb-bot's worker has written anything, so a group just asked to fill still looks
 * idle". lb-bot does not work that way (the phase A sources lane read it, RESULTS § B-233):
 *   - `fetch` enqueues before it answers, and its answer's `gap` (read under lb-bot's lock after
 *     the enqueue) is already `downloading`, or terminal. The watch starts from it.
 *   - `auto` and `search` answer `task_id`, and lb-bot registers that task (`running`) before it
 *     answers, so every later read's `sourceTask` is that task (or a newer one) and `gapIsBusy`
 *     holds the watch while it runs. Once it ends, `status` decides.
 *   - The one read that can speak of the attempt before is one SENT before the action's answer
 *     arrived (a 5 s poll in flight across the tap). Told apart by request order, not a clock.
 * A short fill that failed 6 s in showed "Couldn't get these tracks" only after 96 s (B-233).
 */

/** What the watch keeps that these rules read (`ActiveGap`'s fields). */
export interface GapWatch {
    lastProgressAt?: number;
    /** When the action's answer arrived and the watch was started (`startGap`). */
    startedAt: number;
    /** The source task an `auto` or `search` answered with (`task_id`). */
    taskId?: string;
}

/**
 * Is anything still happening to this gap?
 *
 * **Gated on `sourceTask.status`, which is the whole trap of this API.** The
 * search POST approves the group's pending tracks and *then* starts the
 * background search, so the very next poll reads `picking` with an empty source
 * list - and `picking` otherwise means "lb-bot wants a decision in its own match
 * workspace", a terminal, stop-polling state. Treating it as terminal here
 * settled the watch one tick after the press, so results arriving thirty seconds
 * later were never read and the modal sat on "asking slskd" until the user
 * pressed again. While the task is running, nothing the group says about itself
 * is final.
 *
 * Note the states tested for: lb-bot ends tasks `complete` or `error` - **never
 * `finished`**, which is a spelling that made an empty search indistinguishable
 * from one still running.
 */
export const gapIsBusy = (gap: LbBotGap | null | undefined): boolean => {
    if (!gap) return false;
    const task = gap.sourceTask?.status;
    if (task === 'queued' || task === 'running') return true;
    if (gap.status === 'downloading') return true;
    // Only a real transfer counts. **`picked` is not one** - it is lb-bot's
    // word for decision `approved` / `source_pending`, which is what the search
    // POST flips every missing track to before it starts looking. So `picked`
    // is precisely the state in which the user must be able to choose a source,
    // and treating it as in-flight disabled the Fill button forever: sources
    // listed, nothing clickable, no error to explain it.
    return gap.tracks.some((track) => track.state === 'downloading' || track.state === 'queued');
};

/**
 * Whether a read of the group (sent at `sentAt`) speaks for the fill the watch follows: it was
 * sent after the action's answer arrived (`startedAt`), or it names the watch's own task, which
 * lb-bot registered before it answered.
 */
export const gapReadCounts = (watch: GapWatch, gap: LbBotGap, sentAt: number): boolean =>
    sentAt >= watch.startedAt || (!!watch.taskId && gap.sourceTask?.id === watch.taskId);

/**
 * What the watch does with a read that counts: keep waiting, settle on what the group says
 * (`gapSettleOutcome`), or give up after `timeoutMs` with no progress.
 */
export const gapWatchVerdict = (
    watch: GapWatch,
    gap: LbBotGap,
    at: { now: number; timeoutMs: number },
): 'gaveUp' | 'settle' | 'wait' => {
    const busy = gapIsBusy(gap);
    if (!busy && at.now - (watch.lastProgressAt ?? watch.startedAt) > at.timeoutMs) {
        return 'gaveUp';
    }
    // Never while `gapIsBusy`, which reads `sourceTask`, not `status`: a search's group reads
    // `picking` with no sources while the task runs.
    return busy ? 'wait' : 'settle';
};
