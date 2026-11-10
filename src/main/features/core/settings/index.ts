import type { TitleTheme } from '/@/shared/types/types';
import type { FSWatcher } from 'fs';

import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    nativeTheme,
    OpenDialogOptions,
    safeStorage,
    shell,
} from 'electron';
import Store from 'electron-store';
import { promises as fs, watch as fsWatch } from 'fs';
import path from 'path';

import { SETTINGS_MIGRATIONS } from '/@/main/features/core/settings/migrations';
import log from '/@/main/logger';
import { migratedFrom } from '/@/main/migrate-from-feishin';
import { type SavedPassword } from '/@/shared/utils/saved-password';

const getFrame = () => {
    const isWindows = process.platform === 'win32';
    const isMacOS = process.platform === 'darwin';

    if (isWindows) {
        return 'windows';
    }

    if (isMacOS) {
        return 'macOS';
    }

    return 'linux';
};

const isDevelopment = process.env.NODE_ENV === 'development';

const defaultUserDataPath = app.getPath('userData');
const storePath = isDevelopment
    ? path.normalize(`${defaultUserDataPath}-dev`)
    : path.normalize(defaultUserDataPath);

const CUSTOM_CSS_FILENAME = 'custom.css';
const customCssPath = path.join(storePath, CUSTOM_CSS_FILENAME);
let customCssWatcher: FSWatcher | null = null;
let customCssDebounce: NodeJS.Timeout | null = null;

const readCustomCss = async (): Promise<{ content: string; exists: boolean }> => {
    try {
        const content = await fs.readFile(customCssPath, 'utf8');
        return { content, exists: true };
    } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code === 'ENOENT') {
            return { content: '', exists: false };
        }

        log.error('Failed to read custom css file', error);
        return { content: '', exists: false };
    }
};

const notifyCustomCssUpdate = async () => {
    const { content, exists } = await readCustomCss();
    BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send('custom-css-updated', {
            content,
            exists,
            path: customCssPath,
        });
    });
};

const scheduleCustomCssUpdate = () => {
    if (customCssDebounce) {
        clearTimeout(customCssDebounce);
    }

    customCssDebounce = setTimeout(() => {
        notifyCustomCssUpdate().catch((error) => {
            log.error('Failed to broadcast custom css update', error);
        });
    }, 100);
};

const startCustomCssWatcher = async () => {
    if (customCssWatcher) return;

    try {
        await fs.mkdir(storePath, { recursive: true });
        customCssWatcher = fsWatch(storePath, (eventType, filename) => {
            if (!filename) return;
            if (filename.toString() !== CUSTOM_CSS_FILENAME) return;

            if (eventType === 'change' || eventType === 'rename') {
                scheduleCustomCssUpdate();
            }
        });
    } catch (error) {
        log.error('Failed to watch custom css file', error);
    }
};

export const store = new Store<any>({
    beforeEachMigration: (_store, context) => {
        log.info(`settings migrate from ${context.fromVersion} → ${context.toVersion}`);
    },
    cwd: storePath,
    defaults: {
        disable_auto_updates: false,
        enableNeteaseTranslation: false,
        global_media_hotkeys: true,
        lyrics: ['NetEase', 'lrclib.net'],
        mediaSession: false,
        playbackType: 'web',
        should_prompt_accessibility: true,
        shown_accessibility_warning: false,
        visualizer_system_audio_consent_granted: false,
        window_enable_tray: true,
        window_exit_to_tray: false,
        window_minimize_to_tray: false,
        window_start_minimized: false,
        window_window_bar_style: getFrame(),
    },
    // Worbus P4: upstream's `'>=1.0.0'` emptying of the store is gone (migrations.ts).
    migrations: SETTINGS_MIGRATIONS,
});

/**
 * Worbus P2: keys main keeps to itself. `hubAuth.*` holds the device secret's ciphertext and its
 * marker; the renderer has no business reading or replacing either through the generic settings
 * channel (hub/auth.ts).
 */
const isMainOnlyKey = (property: unknown): boolean =>
    typeof property !== 'string' || property === 'hubAuth' || property.startsWith('hubAuth.');

ipcMain.handle('settings-get', (_event, data: { property: string }) => {
    if (isMainOnlyKey(data.property)) return undefined;
    return store.get(`${data.property}`);
});

ipcMain.on('settings-set', (__event, data: { property: string; value: any }) => {
    if (isMainOnlyKey(data.property)) return;
    if (data.value === undefined) {
        store.delete(data.property);
    } else {
        store.set(data.property, data.value);
    }
});

ipcMain.handle('settings-set-sync', (__event, data: { property: string; value: any }) => {
    if (isMainOnlyKey(data.property)) return;
    if (data.value === null) {
        store.delete(data.property);
    } else {
        store.set(data.property, data.value);
    }
});

export const PASSWORD_UNREADABLE_AFTER_MOVE =
    "Your saved password couldn't be read after the move from Feishin. Sign in again.";
const unreadableAfterMove = new Set<string>();

/**
 * B-338: a saved password, read: none saved, unreadable (saved but it does not decrypt here), or
 * the password. The decryption error rides along for `password-get`, which still throws it outside
 * a move from Feishin.
 */
const readSavedPassword = (
    event: Electron.IpcMainInvokeEvent,
    server: string,
): SavedPassword | { error: unknown; kind: 'unreadable' } => {
    const servers = store.get('server') as Record<string, string> | undefined;
    const encrypted = servers?.[server];
    if (!encrypted) return { kind: 'none' };
    if (!safeStorage.isEncryptionAvailable()) {
        // As before for `password-get` (null, never a throw); a 401 path asks for it again.
        log.warn('Password encryption unavailable', { serverId: server });
        return { kind: 'unreadable' };
    }
    try {
        return { kind: 'ok', password: safeStorage.decryptString(Buffer.from(encrypted, 'hex')) };
    } catch (error) {
        // Worbus P5 (design §6.4): the keyring key follows the app's name, so a password the
        // old Feishin saved may not read here. Say so and ask for the sign-in, never clearing it
        // silently: the old app still reads it.
        if (migratedFrom(storePath) && !unreadableAfterMove.has(server)) {
            // Once per server and session: the edit form and the 401 paths ask again and again.
            unreadableAfterMove.add(server);
            log.warn('Saved password unreadable after the move from Feishin', {
                serverId: server,
            });
            event.sender.send('password-unreadable-after-move', PASSWORD_UNREADABLE_AFTER_MOVE);
        }
        return { error, kind: 'unreadable' };
    }
};

ipcMain.handle('password-get', (event, server: string): null | string => {
    const saved = readSavedPassword(event, server);
    if (saved.kind === 'ok') return saved.password;
    if (saved.kind === 'unreadable' && 'error' in saved && !migratedFrom(storePath)) {
        throw saved.error;
    }
    return null;
});

// B-338: the 401 paths ask this, so an unreadable password is never read as "none saved".
ipcMain.handle('password-read', (event, server: string): SavedPassword => {
    const saved = readSavedPassword(event, server);
    return saved.kind === 'unreadable' ? { kind: 'unreadable' } : saved;
});

ipcMain.on('password-remove', (_event, server: string) => {
    const passwords = store.get('server', {}) as Record<string, string>;
    if (server in passwords) {
        delete passwords[server];
    }
    store.set({ server: passwords });
    log.info('Password removed', { serverId: server });
});

ipcMain.handle('password-set', (_event, password: string, server: string) => {
    if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(password);
        const passwords = store.get('server', {}) as Record<string, string>;
        passwords[server] = encrypted.toString('hex');
        store.set({ server: passwords });

        log.info('Password saved', { serverId: server });
        return true;
    }

    log.warn('Password encryption unavailable', { serverId: server });
    return false;
});

ipcMain.on('theme-set', (_event, theme: TitleTheme) => {
    store.set('theme', theme);
    nativeTheme.themeSource = theme;
});

ipcMain.handle('open-file-selector', async (_event, options: OpenDialogOptions) => {
    const result = await dialog.showOpenDialog({
        ...options,
        properties: ['openFile'],
    });

    return result.filePaths[0] || null;
});

ipcMain.handle('custom-css-get', async () => {
    const { content, exists } = await readCustomCss();
    return {
        content,
        exists,
        path: customCssPath,
    };
});

ipcMain.handle('custom-css-save', async (_event, data: { content: string }) => {
    const content = typeof data?.content === 'string' ? data.content : '';
    await fs.mkdir(storePath, { recursive: true });
    await fs.writeFile(customCssPath, content, 'utf8');
    await notifyCustomCssUpdate();
    return true;
});

ipcMain.handle('custom-css-open-folder', async () => {
    await fs.mkdir(storePath, { recursive: true });
    await shell.openPath(storePath);
    return true;
});

app.whenReady()
    .then(() => startCustomCssWatcher())
    .catch((error) => log.error('Failed to start custom css watcher', error));

app.on('before-quit', () => {
    if (customCssWatcher) {
        customCssWatcher.close();
        customCssWatcher = null;
    }

    if (customCssDebounce) {
        clearTimeout(customCssDebounce);
        customCssDebounce = null;
    }
});
