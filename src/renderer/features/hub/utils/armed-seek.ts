/**
 * navi-connect: use-hub's armed seek, out of the hook so a harness can replay a transfer (B-111).
 * Pure.
 *
 * A load that changes track cannot seek at once: the source reload loses it. So the seek is ARMED
 * (`pendingSeek`) for the moment the player reports the target track, and then LANDS a moment
 * later (150 ms, so the engine has finished loading the new source). Between being armed and
 * landing it is the position the hub asked for.
 */
export interface ArmedSeek {
    armedAt: number;
    index: number;
    /** Re-assert the pause after the seek: the load started async playback. */
    pause: boolean;
    sec: number;
}

/**
 * The player reports `index` as current. `keep` is what stays armed; `land` is the seek to
 * land now (its track is current), or null.
 */
export const armedSeekOnTrack = (
    armed: ArmedSeek | null,
    index: number,
    now: number,
    ttlMs: number,
): { keep: ArmedSeek | null; land: ArmedSeek | null } => {
    // Its target track never became current (superseded load, queue changed under us): drop it
    // before it ambushes an unrelated song.
    if (armed && now - armed.armedAt > ttlMs) return { keep: null, land: null };
    if (armed && index === armed.index) return { keep: null, land: armed };
    return { keep: armed, land: null };
};

/**
 * A `do:seek` applied while seeks are armed or landing (`waiting`: the armed one; `landing`: one
 * whose track is current and whose seek has not fired yet). B-111: the hub's later seek is the
 * newer word on the offset, so both now land there. Left alone, the armed seek landed after it and
 * put the player back at the load's offset. The play state (`pause`) is not the seek's to change.
 */
export const seekOverArmedSeeks = (
    sec: number,
    waiting: ArmedSeek | null,
    landing: ArmedSeek | null,
): void => {
    if (waiting) waiting.sec = sec;
    if (landing) landing.sec = sec;
};

/**
 * A `jump`, or a `queueChanged` that replaced the playing track: what stays armed (`waiting`) and
 * landing. Kept as they were.
 */
export const armedSeeksAfterRowMove = (
    waiting: ArmedSeek | null,
    landing: ArmedSeek | null,
): { landing: ArmedSeek | null; waiting: ArmedSeek | null } => ({ landing, waiting });

/** The landing timer for `pending` fired (`current`: use-hub's landingSeek now): whether it seeks. */
export const landingSeekFires = (_current: ArmedSeek | null, _pending: ArmedSeek): boolean => true;
