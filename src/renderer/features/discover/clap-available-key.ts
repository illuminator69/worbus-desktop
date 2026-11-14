/** What decides where the CLAP probe goes (main `audiomuse/index.ts` `endpoint()`): the hub first. */
export interface ClapHub {
    enabled: boolean;
    signedIn: boolean;
    token: string;
    url: string;
}

/**
 * The CLAP probe's query key. Settings reads the same cache entry to say what the server offers.
 * B-321: it names the hub too, so switching the hub or signing in asks again.
 */
export const clapAvailableKey = (audioMuse: { token: string; url: string }, hub: ClapHub) =>
    [
        'discover',
        'clap-available',
        audioMuse.token,
        audioMuse.url,
        hub.enabled,
        hub.signedIn,
        hub.token,
        hub.url,
    ] as const;
