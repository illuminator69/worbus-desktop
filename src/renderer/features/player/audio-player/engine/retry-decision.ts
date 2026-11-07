/**
 * B-138: what the web player does when its <audio> element reports an error.
 *
 * - A network error (code 2) is retried a few times, and each retry resumes where the track was,
 *   so a blip 2 s before the end costs 2 s, not a replay from 0.
 * - A file the browser cannot open (code 4) or decode (code 3) is not retried: retrying it gives
 *   the same error, and upstream's five retries from 0 cost about 18 minutes on one bad file.
 *   The track is skipped through the same path a normal end takes.
 * - An abort (code 1) or an error with no code is left alone, as before.
 *
 * Kept free of DOM globals and enums so `node --test` can run it.
 */

export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export const MAX_NETWORK_RETRIES = 5;

/** Failed tracks in a row (none of them heard playing) before the player pauses instead of skipping. */
export const MAX_FAILED_IN_A_ROW = 3;

export type RetryDecision =
    | { action: 'ignore' }
    | { action: 'pause' }
    | { action: 'retry'; resumeAt: number }
    | { action: 'skip' };

/**
 * @param code the MediaError code, or undefined when the element has none
 * @param attempt network retries already made for this source
 * @param position the element's currentTime when the error fired, in seconds
 */
export const retryDecision = (
    code: number | undefined,
    attempt: number,
    position: number,
): RetryDecision => {
    if (code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
        return { action: 'skip' };
    }

    if (code === MEDIA_ERR_NETWORK) {
        if (attempt < MAX_NETWORK_RETRIES) {
            const resumeAt = Number.isFinite(position) && position > 0 ? position : 0;
            return { action: 'retry', resumeAt };
        }
        return { action: 'pause' };
    }

    return { action: 'ignore' };
};

/**
 * A skip must not come back to the track that just failed: under repeat-one, or repeat-all over a
 * one-track queue, the next track IS this one, so skipping would replay the failure for ever. A run
 * of failures with nothing heard in between (the server is down, every file errors) also pauses,
 * instead of racing through the queue, or round it for ever under repeat-all.
 *
 * @param failedInARow failed tracks in a row, counting this one
 * @param replaysSameTrack the queue's next automatic track is the one that failed
 */
export const afterFailedTrack = (
    failedInARow: number,
    replaysSameTrack: boolean,
): 'pause' | 'skip' => {
    if (replaysSameTrack) return 'pause';
    if (failedInARow >= MAX_FAILED_IN_A_ROW) return 'pause';
    return 'skip';
};

/** Whether the queue's next automatic track is the current one (mirrors calculateNextIndex). */
export const replaysSameTrack = (
    repeat: 'all' | 'none' | 'one',
    playbackLength: number,
): boolean => {
    if (repeat === 'one') return true;
    if (repeat === 'all') return playbackLength <= 1;
    return false;
};

/**
 * A network retry, and the resume seek it leaves on `loadedmetadata`, still belong to the element
 * they were set up for only while that element is the playing one AND still holds the source that
 * failed. The source alone is not enough: under repeat-all over [A, B], a Next during the 2 s wait
 * plays B on the other element and gives this one A again, with the same URL; a retry that ran
 * then would pause B and play A under it.
 *
 * @param failedOn the element (1 or 2) whose source failed
 * @param playingNow the element that is the playing one now
 */
export const retryStillApplies = (args: {
    failedOn: 1 | 2;
    failedSrc: string;
    playingNow: number;
    srcNow: string;
}): boolean => args.failedOn === args.playingNow && args.srcNow === args.failedSrc;

/**
 * What an <audio> error event does when it fires.
 *
 * - On the element preloading the NEXT track it waits for that track's turn: acting now would
 *   stop or skip the song that is playing.
 * - While the player is not playing (a queue restored at launch, paused; the user paused; another
 *   device plays) it waits for a play: a failed track must not move the queue, here or on the
 *   hub session another device may follow, when nobody asked for playback.
 *
 * The failure is not copied anywhere: the element keeps its MediaError until it loads another
 * source, and that is what `atItsTurn` reads, so a failure cannot outlive its track.
 */
export const whenToActOnError = (args: {
    isCurrent: boolean;
    isPlaying: boolean;
}): 'act' | 'at-its-turn' | 'when-played' => {
    if (!args.isCurrent) return 'at-its-turn';
    if (!args.isPlaying) return 'when-played';
    return 'act';
};

/** HTMLMediaElement.HAVE_FUTURE_DATA: canplay has fired for the loaded source. */
export const HAVE_FUTURE_DATA = 3;

/**
 * What the playing element needs after a render.
 *
 * - `act-on-error`: it holds a failure not acted on yet (it failed while preloading, or while the
 *   player was paused) and the player plays: the normal path for that error now.
 * - `play`: its turn just started (it became the current element, or the player started
 *   playing), it has a loaded source with no error, and it is still paused. react-player plays
 *   an element on that edge only when its own `isPlaying` flag is false, and that flag is left
 *   true when a playing element is given a new source (the load algorithm pauses it without a
 *   `pause` event), so a preloaded next track could sit paused at 0 at its turn.
 * - `nothing` otherwise.
 *
 * @param errorCode the element's MediaError code now (undefined: no error)
 * @param errorHandled that MediaError was already acted on (a retry is waiting, or it paused)
 * @param turnStarted the element just became the current one, or the player just started playing
 */
export const atItsTurn = (args: {
    errorCode: number | undefined;
    errorHandled: boolean;
    hasSource: boolean;
    isPlaying: boolean;
    paused: boolean;
    readyState: number;
    turnStarted: boolean;
}): 'act-on-error' | 'nothing' | 'play' => {
    if (!args.isPlaying || !args.hasSource) return 'nothing';
    if (args.errorCode !== undefined) return args.errorHandled ? 'nothing' : 'act-on-error';
    if (args.turnStarted && args.paused && args.readyState >= HAVE_FUTURE_DATA) return 'play';
    return 'nothing';
};
