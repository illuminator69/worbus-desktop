/**
 * B-324, B-328: the settings main's store (electron-store) holds for the renderer, in one table
 * both processes read. Pure and import-free (`main-settings.harness.ts`).
 *
 * **Main owns them.** Main reads every mirrored key before a window exists and acts on it (the
 * window frame, the tray, start minimized, the password backend, media keys and media session,
 * the playback engine, lyrics, the local font); the renderer's copy only draws the setting. So
 * at launch the renderer adopts main's values (`mirroredPatchFrom`) and never pushes its own over
 * them; a setting the person changes is written to both by its control, as before, and a settings
 * import writes main's copy too (`mirroredWrites`).
 *
 * **The renderer may use these keys and no others** through the generic settings channel
 * (`settings-get`, `settings-set`, `settings-set-sync`): the mirrored ones, plus the few it keeps
 * in main alone. Everything else in main's store (the saved passwords, `hubAuth`, `theme`,
 * `bounds`, the release channel, the device id) is main's to read and write.
 */

/** A mirrored setting: main's key and where the renderer's settings store keeps it. */
export interface MirroredSetting {
    key: string;
    path: readonly [string, string];
}

export const MIRRORED_SETTINGS: readonly MirroredSetting[] = [
    { key: 'lyrics', path: ['lyrics', 'sources'] },
    { key: 'window_window_bar_style', path: ['window', 'windowBarStyle'] },
    { key: 'window_start_minimized', path: ['window', 'startMinimized'] },
    { key: 'window_exit_to_tray', path: ['window', 'exitToTray'] },
    { key: 'window_minimize_to_tray', path: ['window', 'minimizeToTray'] },
    { key: 'window_enable_tray', path: ['window', 'tray'] },
    { key: 'password_store', path: ['general', 'passwordStore'] },
    { key: 'mediaSession', path: ['playback', 'mediaSession'] },
    { key: 'playbackType', path: ['playback', 'type'] },
    { key: 'global_media_hotkeys', path: ['hotkeys', 'globalMediaHotkeys'] },
    { key: 'enableNeteaseTranslation', path: ['lyrics', 'enableNeteaseTranslation'] },
    { key: 'local_font_path', path: ['font', 'custom'] },
];

/**
 * The other keys the renderer uses in main: kept in main alone (`ignore_cors`, `ignore_ssl`,
 * `mpv_path`, the visualizer consent), written there and read by nothing in main (`resume`,
 * the two prevent-sleep switches: upstream leftovers, the renderer's copy is the one used), or
 * main's own that the preload reads at start (`maximized`, for the window bar's button).
 */
export const MAIN_ONLY_RENDERER_KEYS: readonly string[] = [
    'ignore_cors',
    'ignore_ssl',
    'maximized',
    'mpv_path',
    'resume',
    'visualizer_system_audio_consent_granted',
    'window_prevent_sleep_on_playback',
    'window_prevent_suspend_on_playback',
];

const RENDERER_KEYS = new Set([...MAIN_ONLY_RENDERER_KEYS, ...MIRRORED_SETTINGS.map((s) => s.key)]);

/** Whether the generic settings channel serves `property` to the renderer. */
export const rendererMayUse = (property: unknown): boolean =>
    typeof property === 'string' && RENDERER_KEYS.has(property);

type Tree = Record<string, unknown>;

const at = (state: Tree, [group, field]: readonly [string, string]): unknown =>
    (state[group] as Tree | undefined)?.[field];

const same = (a: unknown, b: unknown): boolean =>
    JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

/**
 * At launch: the patch that makes the renderer's copy say what main holds. A key main holds no
 * value for (undefined) is left as the renderer has it: main has no word, and acts on its own
 * fallback.
 */
export const mirroredPatchFrom = (
    rendererState: Tree,
    mainValues: Record<string, unknown>,
): Record<string, Tree> => {
    const patch: Record<string, Tree> = {};
    for (const { key, path } of MIRRORED_SETTINGS) {
        const main = mainValues[key];
        if (main === undefined || same(main, at(rendererState, path))) continue;
        (patch[path[0]] ??= {})[path[1]] = main;
    }
    return patch;
};

/** A settings import: the mirrored values it changes, for main's copy. */
export const mirroredWrites = (before: Tree, after: Tree): Array<{ key: string; value: unknown }> =>
    MIRRORED_SETTINGS.filter(({ path }) => !same(at(before, path), at(after, path))).map(
        ({ key, path }) => ({ key, value: at(after, path) }),
    );

/** The part of main's electron-store a reset uses (`main-settings.harness.ts` passes a fake). */
export interface ResettableStore {
    delete: (key: string) => void;
    get: (key: string) => unknown;
    reset: (...keys: string[]) => void;
}

/**
 * The mirrored keys main acts on only when it starts, so a new value needs a restart (read in
 * `main/index.ts` at start: the window frame, the tray, the `--password-store` switch, the global
 * media keys, and the media session and playback engine, module-level constants). The others are
 * read when used: the lyrics sources and NetEase translation on each fetch, the font on each
 * `feishin://` request, the tray switches on each close or minimise, start-minimized only at the
 * next start anyway.
 */
export const RESTART_KEYS: readonly string[] = [
    'global_media_hotkeys',
    'mediaSession',
    'password_store',
    'playbackType',
    'window_enable_tray',
    'window_window_bar_style',
];

/** At main's start: the values of `RESTART_KEYS` main acts on this run. */
export const startValuesOf = (store: Pick<ResettableStore, 'get'>): Record<string, unknown> =>
    Object.fromEntries(RESTART_KEYS.map((key) => [key, store.get(key)]));

/**
 * B-328, "Reset to default": main's copies of the mirrored settings go back to main's own
 * defaults (`reset`), and a key with no default (the font, the password backend) is removed. The
 * renderer then reloads on its own defaults and the launch adopt finds nothing old to copy back.
 * Answers whether a restart is owed: a `RESTART_KEYS` value after the reset differs from the one
 * main started on (`startedOn`, `startValuesOf` at main's start; without it, the value stored
 * before the reset).
 */
export const resetMirroredIn = (
    store: ResettableStore,
    startedOn?: Record<string, unknown>,
): boolean => {
    let owed = false;
    for (const { key } of MIRRORED_SETTINGS) {
        const before = startedOn && key in startedOn ? startedOn[key] : store.get(key);
        store.delete(key);
        store.reset(key);
        if (RESTART_KEYS.includes(key) && !same(before, store.get(key))) owed = true;
    }
    return owed;
};
