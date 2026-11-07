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

export const tabFor = (stored: string, desktop: boolean): string => {
    const wanted = stored === 'window' ? 'desktop' : stored;
    return tabsFor(desktop).includes(wanted) ? wanted : 'general';
};
