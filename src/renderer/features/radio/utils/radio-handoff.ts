/**
 * Fix round 4 (2026-11-12), B-349 after a radio station (`radio-handoff.harness.ts`). The web
 * build swaps the queue's `<WebPlayer>` for `<RadioWebPlayer>` while a station plays
 * (`audio-players.tsx`), so the queue's elements are unmounted and come back at 0 s when the
 * station stops. The station is not the queue: stopping it gives the queue back as it was, paused
 * at its position (the store keeps it, so the bar and the hub say it), and hands that position to
 * the remounted player, which seeks its element there when it reports ready (`playerHandoff`,
 * `web-player.tsx` `applyPendingSeekIfNeeded`), before any play.
 *
 * Only the web player remounts this way and reads `playerHandoff.pendingLocalSeek`; the DLNA
 * path keeps today's stop (a seek left in the handoff would wait for some later web mount).
 */
export interface RadioStopPlan {
    /** The seek the queue's player applies when its element comes back; -1: none. */
    handoffSeekSec: number;
    /** How the player store leaves the queue. */
    queue: 'pause' | 'stop-and-reset';
    /**
     * The order the stop runs in (fix round 6): write the handoff, leave the queue as `queue`
     * says (paused or stopped) while the station is still the active thing, then clear the radio
     * state, which mounts the queue's web player again. Clearing first left one report with the
     * store still PLAYING and no station: the queue playing, for the hub (`queuePlaysHere`).
     */
    steps: readonly ('clear' | 'handoff' | 'queue')[];
}

const STEPS = ['handoff', 'queue', 'clear'] as const;

export const radioStopPlan = (queuePositionSec: number, webPlayer = true): RadioStopPlan =>
    webPlayer
        ? {
              handoffSeekSec: queuePositionSec > 0 ? queuePositionSec : -1,
              queue: 'pause',
              steps: STEPS,
          }
        : { handoffSeekSec: -1, queue: 'stop-and-reset', steps: STEPS };
