/**
 * Which Settings tabs exist, and which one a stored `tab` value means (F4). Pure and import-free
 * (`settings-tabs.harness.ts`). The store keeps the last tab as a free string and is not migrated:
 * the Window tab became Desktop and the Server tab is desktop-only, so an old or foreign value has
 * to land on a tab that exists, or the panel would be empty.
 */
export const DESKTOP_ONLY_TABS = ['server', 'desktop'] as const;

export const tabsFor = (desktop: boolean): string[] =>
    desktop
        ? ['server', 'playback', 'appearance', 'general', 'hotkeys', 'desktop', 'advanced']
        : ['playback', 'appearance', 'general', 'hotkeys', 'advanced'];

/**
 * B-318: the stored default is 'general' (S-096: no default flipped, no stored key added), so the
 * store cannot tell "never chose a tab" from "chose General". A desktop with no Worbus Server set
 * reads General, and a value that names no tab, as the Server tab: where a person with no server
 * needs to be. Once a server is set, General is General. `serverSet` defaults to true, so a caller
 * that does not know leaves the old rule.
 */
export const tabFor = (stored: string, desktop: boolean, serverSet = true): string => {
    const wanted = stored === 'window' ? 'desktop' : stored;
    const tab = tabsFor(desktop).includes(wanted) ? wanted : 'general';
    return desktop && !serverSet && tab === 'general' ? 'server' : tab;
};
