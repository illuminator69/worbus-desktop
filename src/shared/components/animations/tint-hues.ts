/**
 * A cover placeholder's two hues from the item (design brief 8: "a diagonal-gradient placeholder tinted
 * from the item"): FNV-1a over the seed, mixed, so one item always gets the same pair; the second hue is
 * 40 to 100 degrees on from the first. Pure, for the harness.
 */
export const tintHues = (seed: string): [number, number] => {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    // A final mix so short, similar seeds ("1", "2", ...) spread over the wheel.
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h >>>= 0;
    const a = h % 360;
    const gap = 40 + (Math.floor(h / 360) % 61);
    return [a, (a + gap) % 360];
};
