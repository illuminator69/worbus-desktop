import { createContext } from 'react';

/**
 * The tab a settings section sits in. Provided around each tab's content, and around each tab's
 * block of the search results (where `open` takes the user to the tab and clears the search).
 */
export interface SettingsTabContextValue {
    /** Translated tab name, for the "Tab › Section" heading in the results. */
    label: string;
    /** In the search results only: leave the search and open the tab at this section. */
    open?: (sectionTitle: string) => void;
    tab: string;
}

export const SettingsTabContext = createContext<null | SettingsTabContextValue>(null);
