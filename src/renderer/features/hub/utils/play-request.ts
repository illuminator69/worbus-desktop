// navi-connect (B-058): "did somebody ASK for this playback?", answered by the place the play came
// from rather than by the player store. Pure apart from the one mark, so the guard decisions can
// be tested without React (play-request.harness.ts).
//
// use-hub arms guards against a RUNAWAY - the engine playing although nothing asked it to: a
// load whose async play() lands after its own pause (setQueue forces PLAYING, the pause follows,
// the engine resolves after both), or a startup auto-resume (on mpv, the engine's own `resumed`
// event is echoed back as `renderer-player-play`, which sets the store PLAYING). Those guards
// were "audio is rolling within N ms of the load/adopt -> pause it", and a play the user pressed
// inside that window rolls too: the armed-seek re-check paused a play pressed ~0.2 s after a
// paused transfer (B-058). "The store went PLAYING" cannot tell the two apart - both runaways
// above set it too - so the plays that are asked for are marked where they are asked for.
//
// Marked sources: the user's transport (player-context, hotkeys, media session, the main
// process's play / play-pause commands except mpv's echo, Worbus for desktop's remote, a queue row) and the
// hub's own play directives (do:play, do:jump, do:load with play). A play requested AFTER a
// guard was armed is that guard's audio, so the guard stands down; one requested before it (the
// newer load or adopt overrode it) does not count. A pause asked for at the same places
// (player-context's pause/stop/toggle, the hotkeys, do:pause) withdraws it again.
//
// The same mark lets a play pressed inside an adopt's hub-driven window claim the session once
// that window lapses (adoptClaimDelay) - publishQueue cannot claim inside it.

/** A guard that stays armed for a while (use-hub's adopt guard). */
export interface GuardWindow {
    /** Wall-clock ms it was armed. */
    armedAt: number;
    /** Wall-clock ms it lapses. */
    until: number;
}

export interface PlayRequest {
    /** Wall-clock ms the play was asked for. */
    at: number;
    source: PlayRequestSource;
}

export type PlayRequestSource = 'hub' | 'user';

let lastRequest: null | PlayRequest = null;
let lastPauseAt = -Infinity;

/** Mark a play somebody asked for, at the place they asked for it. */
export const notePlayRequest = (source: PlayRequestSource = 'user', at = Date.now()): void => {
    lastRequest = { at, source };
};

/**
 * Mark a pause somebody asked for. It withdraws every play asked for before it: from then on,
 * audio that starts without a new play is a runaway again (mpv's echo, say), and the guards
 * must catch it for whatever is left of their window.
 */
export const notePauseRequest = (at = Date.now()): void => {
    lastPauseAt = at;
};

/** The newest requested play still standing - none when a pause was asked for since (same ms: the pause). */
export const lastPlayRequest = (): null | PlayRequest =>
    lastRequest !== null && lastRequest.at > lastPauseAt ? lastRequest : null;

/** Test hook: forget every mark. */
export const resetPlayRequests = (): void => {
    lastRequest = null;
    lastPauseAt = -Infinity;
};

/** Was a play requested strictly after `armedAt`? (The same ms goes to the guard.) */
const requestedSince = (armedAt: number, request: null | PlayRequest): boolean =>
    request !== null && request.at > armedAt;

/** What adoptClaimDelay reads. */
export interface AdoptClaimState {
    /** The adopt guard's window (use-hub's adoptPauseGuard). */
    adopt: GuardWindow;
    /** use-hub's hubDrivenUntil. */
    hubDrivenUntil: number;
    now: number;
    /** No device holds the session (activeId === null). */
    orphaned: boolean;
    /** The player store reads PLAYING. */
    playing: boolean;
    request: null | PlayRequest;
}

/**
 * When to retry claiming the session for a play asked for inside an adopt: ms from now, or null.
 *
 * Playing with no device active IS the claim, made by publishQueue - which returns early inside
 * hubDrivenUntil, armed by the adopt and re-armed for 2 s by its song change. After that nothing
 * republishes until the next track, so the hub would show the session paused with no device
 * while this one plays. Retry just after the window lapses - for a play asked for since the adopt
 * (and inside its guard window) only, never for audio nobody asked for.
 */
export function adoptClaimDelay(state: AdoptClaimState): null | number {
    const { adopt, hubDrivenUntil, now, orphaned, playing, request } = state;
    if (!playing || !orphaned || now >= hubDrivenUntil) return null;
    if (request === null || request.at <= adopt.armedAt || request.at >= adopt.until) return null;
    return hubDrivenUntil - now + 50;
}

/**
 * Is a guard window still open at `now`? It lapses at `until`, and a play requested inside it
 * closes it early - from then on rolling audio is that play.
 */
export function isGuardOpen(guard: GuardWindow, now: number, request: null | PlayRequest): boolean {
    return now < guard.until && !requestedSince(guard.armedAt, request);
}

/**
 * Should a one-shot guard armed at `armedAt` pause the engine now? Only audio that is rolling and
 * that nobody asked for since the guard was armed.
 */
export function isRunaway(rolling: boolean, armedAt: number, request: null | PlayRequest): boolean {
    return rolling && !requestedSince(armedAt, request);
}
