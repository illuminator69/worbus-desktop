/**
 * Worbus P5 (design §6.2, §6.7): the names this app gives itself to other software. Import-free,
 * so main, the renderer and `client-name.harness.ts` share it.
 */

/** The Subsonic `c=` every request sends; Navidrome's Players list shows it. */
export const CLIENT_NAME = 'Worbus-Desktop';

/** The User-Agent of the app's own calls (lrclib), `Worbus-Desktop/0.6.0`. */
export const userAgent = (version: string): string => `${CLIENT_NAME}/${version}`;

/** What a device is called when nobody named it: the computer's own name, else Worbus. */
export const defaultDeviceName = (hostname: string | undefined): string =>
    hostname?.trim() || 'Worbus';

/**
 * The old app's default device name. Saved with every other setting but never chosen by anyone,
 * so a copied profile that still says it gets the new default (design §6.7, §8 step 7).
 */
const OLD_DEFAULT_DEVICE_NAME = 'Feishin';

/** The name a person saved, trimmed; '' when none was (nothing, or the old app's default). */
export const savedDeviceName = (saved: string | undefined): string => {
    const name = saved?.trim() ?? '';
    return name === OLD_DEFAULT_DEVICE_NAME ? '' : name;
};

/** The name this device signs in and says hello with: the saved one, else the default. */
export const deviceName = (saved: string | undefined, hostname: string | undefined): string =>
    savedDeviceName(saved) || defaultDeviceName(hostname);
