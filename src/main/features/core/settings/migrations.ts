/**
 * The main settings store's migrations (electron-store), keyed on the app version. Kept apart
 * from `index.ts` and free of Electron imports, so `settings-migration.harness.ts` runs them
 * under `node --test` against a real `conf` store.
 *
 * Worbus P4 (design §6.7): upstream's `'>=1.0.0'` migration, which emptied the store, is gone. The fork's version is
 * 0.4.0, so the store records 0.4.0, and the first build at 1.0.0 or later would have cleared it:
 * the device secret (`hubAuth`) and the saved passwords (`server`) with it. Never add a migration
 * that clears the store.
 */
export const SETTINGS_MIGRATIONS: Record<
    string,
    (store: { set: (key: string, value: unknown) => void }) => void
> = {
    '>=0.21.2': (store) => {
        store.set('window_bar_style', 'linux');
    },
};
