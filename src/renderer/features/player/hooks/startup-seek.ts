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
     * Replace the pending seek's target with the hub's position, on the song now current. False
     * when no startup seek is pending any more (applied, cancelled or withdrawn).
     */
    retarget: (sec: number, uniqueId: null | string | undefined) => boolean;
    /** Playback started: the position to seek to, exactly once; null otherwise. */
    takeOnPlaying: (currentUniqueId: null | string | undefined) => null | number;
    /** The hub placed the playhead itself: the startup seek must not take it back. */
    withdraw: () => void;
}

export const createStartupSeek = (): StartupSeek => {
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
            if (done || retargeted || !(at > 0)) return;
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
            if (sec === null || !(sec > 0)) return null; // nothing to restore yet: stays pending
            if (target && currentUniqueId !== target) {
                cancel();
                return null;
            }
            const at = sec;
            done = true;
            sec = null;
            target = null;
            return at;
        },
        withdraw: cancel,
    };
};

/**
 * navi-connect (B-339): whether the playing engine can take a seek now. The web engine registers a
 * probe once it mounts (true after its current element reported ready); a seek sent before that
 * goes to a null ref and is dropped without a trace. No probe registered reads as "not up".
 */
let seekProbe: (() => boolean) | null = null;

export const setEngineSeekProbe = (probe: (() => boolean) | null) => {
    seekProbe = probe;
};

export const engineTakesSeekNow = (): boolean => {
    try {
        return seekProbe ? seekProbe() : false;
    } catch {
        return false;
    }
};
