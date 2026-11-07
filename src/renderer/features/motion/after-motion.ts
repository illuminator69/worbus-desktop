/** A running animation that ends (an infinite spinner never does, so it is not waited for). */
const ends = (animation: Animation): boolean =>
    animation.playState === 'running' &&
    Number.isFinite(Number(animation.effect?.getComputedTiming().endTime));

/** Rounds of "wait for what runs now" before giving up on a box that keeps starting motion. */
const MAX_ROUNDS = 8;

/**
 * R13 (B-244): calls `done` once the motion in `el` and under it has settled (its folds, its
 * `GrowBox`, a view's fade), so a scroll that follows a change starts from the box's final size.
 * It waits two frames first: `GrowBox` starts its tween from the resize observer of the frame after
 * the change. Returns a cancel.
 */
export const afterMotion = (el: HTMLElement, done: () => void): (() => void) => {
    let cancelled = false;
    let frame = 0;
    const check = (round: number) => {
        if (cancelled) return;
        const running = el.getAnimations({ subtree: true }).filter(ends);
        if (running.length === 0 || round >= MAX_ROUNDS) {
            done();
            return;
        }
        void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
            if (!cancelled) frame = requestAnimationFrame(() => check(round + 1));
        });
    };
    frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => check(0));
    });
    return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
    };
};
