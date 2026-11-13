/**
 * navi-connect (B-339): the startup seek's state, pulled out of use-queue-restore so a harness can
 * replay the order a fresh start takes. Pure: no React, no store.
 *
 * At start this device goes back to where it was when it was closed: the seek is armed once the
 * persisted queue has hydrated and applied the first time playback starts (first PLAYING). The hub
 * may place the playhead before that (an adopted session). It either withdraws the seek (the hub's
 * own seek reached the engine) or retargets it to the hub's position (the engine was not up yet to
 * take a seek, so the first play has to carry it).
 */
export interface StartupSeek {
    /** Where this device was when it closed, on the song now current. Once per run. */
    arm: (sec: number, uniqueId: null | string | undefined) => void;
    /** The song now current. A different one from the seek's target cancels it. */
    noteCurrentSong: (uniqueId: null | string | undefined) => void;
    /**
     * Replace the pending seek's target with the hub's position, on the song now current. True
     * until the first PLAYING after the restore effect ran (closed at 0 s included: the first play
     * then starts at 0 s, and that is what the hub's position replaces), or the seek was cancelled
     * or withdrawn; false from then on, so a mid-session seek is never retargeted.
     */
    retarget: (sec: number, uniqueId: null | string | undefined) => boolean;
    /**
     * Playback started: the position to seek to, exactly once; null otherwise. Closes the startup
     * seek once the restore effect has armed it (whatever it had to restore) or the hub retargeted
     * it; before either, it stays open.
     */
    takeOnPlaying: (currentUniqueId: null | string | undefined) => null | number;
    /** The hub placed the playhead itself: the startup seek must not take it back. */
    withdraw: () => void;
}

export const createStartupSeek = (): StartupSeek => {
    let armed = false;
    let done = false;
    let retargeted = false;
    let sec: null | number = null;
    let target: null | string = null;

    const cancel = () => {
        done = true;
        sec = null;
        target = null;
    };

    return {
        arm: (at, uniqueId) => {
            // An adopt that came before the queue hydrated already said where to start.
            if (done || retargeted) return;
            armed = true;
            if (!(at > 0)) return; // closed at 0 s: nothing to seek to, open until the first play
            sec = at;
            target = uniqueId ?? null;
        },
        noteCurrentSong: (uniqueId) => {
            if (done || !target || !uniqueId || uniqueId === target) return;
            cancel();
        },
        retarget: (at, uniqueId) => {
            if (done) return false;
            retargeted = true;
            sec = at;
            target = uniqueId ?? target;
            return true;
        },
        takeOnPlaying: (currentUniqueId) => {
            if (done) return null;
            if (!armed && sec === null) return null; // the restore has not run yet: stays open
            const at = sec;
            const onSong = !target || currentUniqueId === target;
            cancel(); // B-339 review: the first play closes it, also with nothing to restore
            return at !== null && at > 0 && onSong ? at : null;
        },
        withdraw: cancel,
    };
};

/**
 * navi-connect (B-339): whether the playing engine can take a seek now. Only the web player can
 * drop one: a seek sent before its react-player has mounted goes to a null ref and is lost without
 * a trace. It registers a probe on mount; with no probe (not mounted yet) or a throwing one, it
 * reads as not up. The probe means "this element has reported ready at least once", not "ready
 * for its current source": like react-player's own isReady it stays true after a track change, and
 * a seek then goes to the element directly, as it did before this change. The mpv, DLNA and
 * jukebox engines take a seek at any time and always read as up, as on the base.
 */
let seekProbe: (() => boolean) | null = null;

export const setEngineSeekProbe = (probe: (() => boolean) | null) => {
    seekProbe = probe;
};

export const engineTakesSeekNow = (webPlayer: boolean): boolean => {
    if (!webPlayer) return true;
    try {
        return seekProbe ? seekProbe() : false;
    } catch {
        return false;
    }
};

/**
 * B-349: the web player's element for the current song reported ready (mounted, source loaded,
 * paused). The startup seek is applied then, so play() starts at the resume position instead of
 * at 0 s with a seek after it. use-queue-restore registers the listener; the web engine calls
 * `webEngineReady`. The first PLAYING still applies a seek that was not taken here (the element
 * came up before the persisted queue hydrated, or another engine plays).
 */
let readyListener: (() => void) | null = null;

export const onWebEngineReady = (listener: (() => void) | null): void => {
    readyListener = listener;
};

export const webEngineReady = (): void => {
    readyListener?.();
};

/**
 * B-402: a seek for the web player's playing element. Up (`engineUp`, engineTakesSeekNow): sent at
 * once, and anything held is dropped (the newer word). Not up yet (a fresh start: react-player not
 * loaded or its element never ready): held for the song it was sent for (its `_uniqueId`), and
 * taken when that song's element, playing that song's source, reports ready, before it plays.
 * Review M1: a hold is that song's only. A ready of another song takes nothing, and the web player
 * drops the hold when the song changes (Next, AutoNext, the B-138 skip, a stop, a queue swap). A
 * ready of another source (the previous song's element finishing its load) leaves it held. Only
 * the latest seek is held.
 */
export interface HeldSeek {
    /** The current song changed: a hold made for the previous one is no longer anyone's. */
    drop: () => void;
    send: (
        sec: number,
        engineUp: boolean,
        seek: (sec: number) => void,
        songId: null | string | undefined,
    ) => void;
    /** The held seconds, once, when this ready is the held song's on its own source; else null. */
    take: (
        readySrc: string | undefined,
        currentSrc: string | undefined,
        songId: null | string | undefined,
    ) => null | number;
}

export const createHeldSeek = (): HeldSeek => {
    let held: null | { sec: number; songId: null | string } = null;
    return {
        drop: () => {
            held = null;
        },
        send: (sec, engineUp, seek, songId) => {
            if (engineUp) {
                held = null;
                seek(sec);
                return;
            }
            held = { sec, songId: songId ?? null };
        },
        take: (readySrc, currentSrc, songId) => {
            if (!held) return null;
            if (held.songId !== (songId ?? null)) {
                held = null; // another song's ready: the hold was not for it
                return null;
            }
            // Only the song's own source takes it. B-402 (re-walk): while the new song's URL is
            // still pending (`currentSrc` unknown) the element loads react-player's silent
            // placeholder, which reports ready too; that ready leaves the hold for the real one.
            if (!readySrc || !currentSrc || readySrc !== currentSrc) return null;
            const { sec } = held;
            held = null;
            return sec;
        },
    };
};

/**
 * B-402 (the owner's re-walk of `a96a9de17`): whether a seek can go to the element now. "Up"
 * (`engineTakesSeekNow`) means the element reported ready once, and react-player's silent
 * EMPTY_SOURCE reports ready too; after a song change the element keeps the previous source until
 * the new song's stream URL arrives (a react-query that waits for Navidrome's
 * `getTranscodeDecision`). A seek sent then is reset to 0 s when the new source loads. So the
 * element takes a seek only while it holds the current song's source (`currentSrc`, resolved like
 * the element's `src`); otherwise the seek is held for that source's ready (`createHeldSeek`).
 */
export const elementTakesSeek = (
    engineUp: boolean,
    elementSrc: string | undefined,
    currentSrc: string | undefined,
): boolean => engineUp && Boolean(currentSrc) && elementSrc === currentSrc;

/**
 * B-402 review L2: the one seek an element's ready applies. A held seek (sent after the element
 * mounted) is newer than the radio handoff (written when the station stopped, before the mount),
 * so it wins; the handoff applies only when nothing is held. Null: no seek.
 */
export const seekAtReady = (held: null | number, handoffSec: number): null | number =>
    held !== null ? held : handoffSec > 0 ? handoffSec : null;

/**
 * B-402 review M1 (VM walk): a seek sent by a timer (use-hub's landing seek, setQueue's restore
 * seek) still applies only while the song it was armed for is current. Next, AutoNext or any other
 * song change before it fires makes it no one's: it was a position in the song that is gone.
 */
export const scheduledSeekApplies = (
    armedFor: null | string | undefined,
    currentNow: null | string | undefined,
): boolean => Boolean(armedFor) && armedFor === currentNow;
