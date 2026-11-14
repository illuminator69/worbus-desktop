/**
 * B-274: numbers short enough for a table column's 40 px floor, three significant digits. A 44.1 kHz
 * rate drew "44100" (43.6 px) and a 156 KiB file "156.41 KiB" (46.5 px), both cut at the floor.
 */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** `value` (0 or more) to three significant digits, at most two decimals, no trailing zeros. */
const threeDigits = (value: number): number =>
    value >= 100
        ? Math.round(value)
        : value >= 10
          ? Math.round(value * 10) / 10
          : Math.round(value * 100) / 100;

/** A sample rate in Hz as thousands: 44100 -> "44.1k", 48000 -> "48k"; under 1000 as it is. */
export const compactSampleRate = (hz: number): string => {
    if (hz < 1000) return String(hz);
    // In whole Hz, so 22050 rounds as 22.05 does on paper (to "22.1k").
    const k =
        hz >= 100_000
            ? Math.round(hz / 1000)
            : hz >= 10_000
              ? Math.round(hz / 100) / 10
              : Math.round(hz / 10) / 100;
    return `${k}k`;
};

/** A size in bytes with its binary unit: 160164 -> "156 KiB", 1604321 -> "1.53 MiB". */
export const compactSize = (bytes: number): string => {
    let unit = 0;
    let value = Math.max(0, bytes);
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    if (unit === 0) return `${Math.round(value)} B`;
    let shown = threeDigits(value);
    // 1023.9 KiB rounds to 1024: that is 1 of the next unit.
    if (shown >= 1024 && unit < UNITS.length - 1) {
        shown = 1;
        unit += 1;
    }
    return `${shown} ${UNITS[unit]}`;
};
