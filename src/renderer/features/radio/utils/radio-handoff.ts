/**
 * Fix round 4 (2026-11-12), B-349 after a radio station: the web build swaps the queue's
 * `<WebPlayer>` for `<RadioWebPlayer>` while a station plays (`audio-players.tsx`), so the queue's
 * elements are unmounted and come back at 0 s when the station stops. Today's rule, moved here
 * unchanged for `radio-handoff.harness.ts`: stopping the station stops the player and resets the
 * queue's position to 0 (`mediaStop()`), and nothing hands the position to the remounted player.
 */
export interface RadioStopPlan {
    /** The seek the queue's player applies when its element comes back (`playerHandoff`); -1: none. */
    handoffSeekSec: number;
    /** How the player store leaves the queue. */
    queue: 'pause' | 'stop-and-reset';
}

export const radioStopPlan = (_queuePositionSec: number): RadioStopPlan => ({
    handoffSeekSec: -1,
    queue: 'stop-and-reset',
});
