/**
 * navi-connect: use-hub's armSeek, pulled out so a harness can replay a fresh start (B-339).
 * Pure: every effect goes through `deps`.
 *
 * Arm a seek for when the player reports the target track. If that track is ALREADY current,
 * seeking now is both correct and necessary - nothing will re-arm it, because
 * onCurrentSongChange only fires on an actual change.
 */
export interface ArmSeekDeps {
    /** Hold the seek for onCurrentSongChange (use-hub's pendingSeek). */
    armPending: (index: number, sec: number, pause: boolean) => void;
    currentIndex: number;
    /** Whether the engine can take a seek now (startup-seek's engineTakesSeekNow). */
    engineTakesSeek: boolean;
    /** Re-assert the pause shortly after (the adopt loads paused). */
    pauseSoon: () => void;
    /** use-queue-restore's retargetStartupSeek. */
    retargetStartupSeek: (sec: number) => boolean;
    /** mediaSeekToTimestamp: the store's position and the engine's seek. */
    seekNow: (sec: number) => void;
    /** The store's position only, for the UI, with no engine seek. */
    showPosition: (sec: number) => void;
    withdrawStartupSeek: () => void;
}

export type ArmSeekOutcome = 'pending' | 'retargeted' | 'seeked';

export const armSeekStep = (
    targetIndex: number,
    sec: number,
    pause: boolean,
    deps: ArmSeekDeps,
): ArmSeekOutcome => {
    if (targetIndex !== deps.currentIndex) {
        deps.withdrawStartupSeek(); // the hub's position, not the one this device closed at
        deps.armPending(targetIndex, sec, pause);
        return 'pending';
    }
    // B-339: at a fresh start the adopt can come before the web player has mounted, and a seek
    // sent then is dropped. Keep the startup seek alive instead, aimed at the hub's position: the
    // first play carries it. Only while one is pending; after that, seek as always.
    if (!deps.engineTakesSeek && deps.retargetStartupSeek(sec)) {
        deps.showPosition(sec);
        if (pause) deps.pauseSoon();
        return 'retargeted';
    }
    deps.withdrawStartupSeek(); // the hub's position, not the one this device closed at
    deps.seekNow(sec);
    if (pause) deps.pauseSoon();
    return 'seeked';
};
