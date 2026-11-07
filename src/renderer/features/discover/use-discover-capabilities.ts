import { useQuery } from '@tanstack/react-query';

import { DISCOVER_ROWS, DiscoverCapability, DiscoverRowDefinition } from './discover-rows';

import {
    useLbBotAvailable,
    useLbBotRouteSupport,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { fetchClapAvailable } from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { useAudioMuseSettings } from '/@/renderer/store/settings.store';

/** The CLAP probe's query key. Settings reads the same cache entry to say what the server offers. */
export const clapAvailableKey = (audioMuse: { token: string; url: string }) =>
    ['discover', 'clap-available', audioMuse.token, audioMuse.url] as const;

/**
 * One answer for every Discover row, instead of six.
 *
 * Nothing here is a new mechanism — both probes already exist and are already
 * the right shape. The hub states the routes it actually serves — in its
 * `welcome` (`welcome.lb`), or through `/lb/status` for a hub older than that —
 * built for the permanent "my client is newer than its hub" condition;
 * `/sonic/clap/stats` always answers 200 with a `configured` flag so a caller
 * learns the feature is off rather than reading an error. What was missing is
 * that the two are unrelated systems — one react-query, one an imperative
 * `useState`/`useEffect` probe copy-pasted at each call site — so every surface
 * had to decide for itself what "absent" looks like, and they disagreed.
 *
 * The CLAP probe is wrapped in react-query here purely so both answers arrive
 * through the same door; it is the same underlying call.
 */
export const useDiscoverCapabilities = () => {
    const lbBotAvailable = useLbBotAvailable();
    const supportsRoute = useLbBotRouteSupport();
    const audioMuse = useAudioMuseSettings();

    const clap = useQuery<boolean>({
        // A probe, not content: an hour is plenty, and it must not re-fire as
        // the user scrolls back to the page.
        gcTime: Infinity,
        queryFn: () => fetchClapAvailable(audioMuse),
        queryKey: clapAvailableKey(audioMuse),
        refetchOnWindowFocus: false,
        staleTime: 60 * 60 * 1000,
    });

    const has = (capability: DiscoverCapability): boolean => {
        switch (capability.kind) {
            case 'clap':
                return clap.data === true;
            case 'lbbot':
                // The same route reading as `useHubSupports`, including its "an
                // empty list is an older hub that does not advertise" rule.
                return lbBotAvailable && supportsRoute(capability.route);
            case 'library':
                return true;
            default:
                return false;
        }
    };

    return {
        /**
         * Whether anything beyond plain Navidrome feeds this screen.
         *
         * The gate for the *nav entry*, which is a different question from
         * whether a row renders. Every capability check for `library` answers
         * yes by definition, so counting those would make the entry permanent —
         * and the rediscovery set is opt-in, so on a stock install it is empty
         * and Discover would be a nav item leading to one paragraph of
         * explanation. lb-bot or AudioMuse being present is what makes this a
         * place worth offering.
         */
        hasSources: DISCOVER_ROWS.some(
            (row) => row.capability.kind !== 'library' && has(row.capability),
        ),
        /** Whether a row's source can answer at all. A row still renders
         *  nothing when its source is up but has nothing to say — that is the
         *  row's own business, and `DiscoverRow` enforces it. */
        supports: (row: DiscoverRowDefinition) => has(row.capability),
    };
};
