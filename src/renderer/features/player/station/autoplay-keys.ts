/**
 * The store patches behind Autoplay (F3). Pure and import-free (`autoplay-settings-keys.harness.ts`).
 *
 * Autoplay is one switch (`autoDJ.enabled`, which the queue chips write too) and one preference
 * (`station.character`), and it is edited in three places: the queue chips, the player bar's More
 * panel and Settings. The panel and Settings build their patches here so they cannot name
 * different keys; the strategy is the one for the current mode.
 */
export const autoplayEnabledPatch = (enabled: boolean) => ({ autoDJ: { enabled } });

export const stationCharacterPatch = <T extends string>(character: T) => ({
    station: { character },
});

export const strategyPatch = <T extends string>(mode: 'albums' | 'songs', strategy: T) => ({
    autoDJ: mode === 'albums' ? { albumStrategy: strategy } : { songStrategy: strategy },
});
