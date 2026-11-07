import type { LbBotGapTrack } from '/@/shared/types/lbbot-types';

/**
 * B-071: the number a gap row is listed under.
 *
 * lb-bot's gap rows carry `disc` since S-022, and `position` restarts on every
 * disc, so a two-disc gap read 1, 2, 1, 2 with nothing to tell the rows apart.
 * The disc is shown only when the gap has a row past the first one: a single-disc
 * gap, and any gap from an lb-bot that sends no `disc` (decoded as 0, "not known"),
 * reads exactly as it did.
 *
 * Pure, so `gap-position.harness.ts` can run it. Worbus for Android implements the same two
 * functions by hand (no shared build): change the rule in both.
 */

/** Is any row of this gap on a disc after the first? */
export const gapShowsDisc = (tracks: Pick<LbBotGapTrack, 'disc'>[]): boolean =>
    tracks.some((track) => track.disc > 1);

/**
 * "2-1" for a row that knows its disc, in a gap that shows discs; the bare position
 * otherwise. A `disc` 0 row inside a multi-disc gap keeps its bare position rather
 * than claim a disc lb-bot did not name. No zero padding.
 */
export const gapPositionLabel = (
    track: Pick<LbBotGapTrack, 'disc' | 'position'>,
    showDisc: boolean,
): string =>
    showDisc && track.disc >= 1 ? `${track.disc}-${track.position}` : `${track.position}`;
