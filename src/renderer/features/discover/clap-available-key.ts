/**
 * What decides where the CLAP probe goes (main `audiomuse/index.ts` `endpoint()`): the hub when it is
 * set up (switched on, an address, a credential: `hubSetUp`), else AudioMuse directly.
 */
export interface ClapHub {
    setUp: boolean;
    url: string;
}

/**
 * The CLAP probe's query key. Settings reads the same cache entry to say what the server offers.
 * B-321: it names the hub too, so switching the hub, its address or its sign-in asks again.
 */
export const clapAvailableKey = (audioMuse: { token: string; url: string }, hub: ClapHub) =>
    ['discover', 'clap-available', audioMuse.token, audioMuse.url, hub.setUp, hub.url] as const;
