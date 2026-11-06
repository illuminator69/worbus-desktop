import type { LogLevel } from '/@/shared/logger/types';

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import log from 'electron-log/main';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

import { serverVersionNow } from '/@/main/features/core/hub/server-version';
import { diagnosticsEntries, diagnosticsHeader } from '/@/main/redact';
import { createZipBuffer } from '/@/main/utils/zip';
import { appVersionLine } from '/@/shared/utils/version-line';

export type { LogLevel };
export type { LogSeverity } from '/@/shared/logger/types';

const PROCESS_WIDTH = 10; // width of "[renderer]"
const LEVEL_WIDTH = 5; // width of "DEBUG" / "ERROR"
const RESET = '\x1B[0m';

const levelColors: Record<string, string> = {
    debug: '\x1B[38;2;100;149;237m', // #6495ED
    error: '\x1B[38;2;255;100;100m', // #ff6464
    info: '\x1B[38;2;76;175;80m', // #4caf50
    warn: '\x1B[38;2;225;125;50m', // #e17d32
};

const formatLogLine = ({
    colorize = false,
    data,
    level,
    message,
}: {
    colorize?: boolean;
    data: unknown[];
    level: string;
    message: { date: Date; variables?: { processType?: string } };
}): string[] => {
    const processType = message.variables?.processType === 'renderer' ? 'renderer' : 'main';
    const paddedLevel = String(level).toUpperCase().padEnd(LEVEL_WIDTH, ' ');
    const levelLabel =
        colorize && levelColors[level]
            ? `${levelColors[level]}${paddedLevel}${RESET}`
            : paddedLevel;
    const processLabel = `[${processType}]`.padEnd(PROCESS_WIDTH, ' ');
    const text = data
        .map((item) => {
            if (typeof item === 'string') {
                return item;
            }

            return util.inspect(item, {
                breakLength: 80,
                colors: colorize,
                compact: false,
                depth: null,
            });
        })
        .join(' ');

    return [`${message.date.toISOString()} ${levelLabel} ${processLabel} ${text}`];
};

const isLogLevel = (value: unknown): value is LogLevel => {
    return value === 'debug' || value === 'info';
};

// A stdout/stderr with no reader (e.g. launched by systemd --user with a dangling pipe) turns every
// console write into an async EPIPE. Neither stream has an 'error' listener by default, so each one
// surfaces as an uncaught exception, which is logged, which writes to the console again — a doubling
// storm that pins the main thread's CPU and leaks memory on the pending error queue. Declared first —
// above every reader of it, including `setLogLevel` below — so a `let` this file merges further up
// from upstream doesn't throw a temporal-dead-zone error on the reference; keep it first.
let consoleDisabledForStdioError = false;

export const setLogLevel = (level: LogLevel) => {
    log.transports.file.level = level;
    // Once a stdio write error has been seen, the console transport stays off for the life of the
    // process — any caller (IPC, a future main-process path, an upstream merge) goes through here.
    log.transports.console.level = consoleDisabledForStdioError ? false : level;
};

log.initialize();
setLogLevel(
    process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true' ? 'debug' : 'info',
);
log.transports.file.format = (params) => formatLogLine({ ...params, colorize: false });
log.transports.file.maxSize = 1024 * 1024 * 10; // 10MB
log.transports.console.format = (params) => formatLogLine({ ...params, colorize: true });

// Disable the console transport permanently once a stdio write error happens; the file transport
// still gets everything. setLogLevel() above enforces this so no caller can bypass it.
const disableConsoleOnStdioError = (stream: NodeJS.WriteStream, name: string) => {
    stream.on('error', (error: NodeJS.ErrnoException) => {
        if (consoleDisabledForStdioError) {
            return;
        }
        consoleDisabledForStdioError = true;
        log.transports.console.level = false;
        log.warn(`Console transport disabled after a ${name} write error`, error);
    });
};

disableConsoleOnStdioError(process.stdout, 'stdout');
disableConsoleOnStdioError(process.stderr, 'stderr');

ipcMain.on('logger-set-level', (_event, level: unknown) => {
    if (isLogLevel(level)) {
        setLogLevel(level);
    }
});

ipcMain.handle('logger-open-folder', async () => {
    const logFilePath = log.transports.file.getFile().path;
    const logsPath = path.dirname(logFilePath);
    await shell.openPath(logsPath);
    return true;
});

type ExportDiagnosticsPayload = {
    logLevel?: null | string;
    rendererSettings?: null | Record<string, unknown>;
    server?: null | Record<string, unknown>;
};

const exportDiagnosticsArchive = async (payload: ExportDiagnosticsPayload = {}) => {
    const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const stamp = new Date().toISOString().slice(0, 10);
    const saveOptions = {
        defaultPath: `feishin-diagnostics-${stamp}.zip`,
        filters: [{ extensions: ['zip'], name: 'Zip' }],
    };
    const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);

    if (result.canceled || !result.filePath) {
        return { canceled: true };
    }

    const logFile = log.transports.file.getFile();
    const logsDir = path.dirname(logFile.path);
    const logs: { data: Buffer; name: string }[] = [];

    const { store } = await import('/@/main/features/core/settings');

    const exportedAt = new Date().toISOString();
    const appVersion = appVersionLine(app.getVersion());
    const serverVersion = serverVersionNow();
    const diagnostics = {
        app: {
            name: app.getName(),
            version: appVersion,
        },
        arch: process.arch,
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        exportedAt,
        locale: app.getLocale(),
        logLevel: payload.logLevel ?? null,
        node: process.versions.node,
        os: {
            release: os.release(),
            type: os.type(),
            version: typeof os.version === 'function' ? os.version() : undefined,
        },
        platform: process.platform,
        server: payload.server ?? null,
        serverVersion,
        settings: {
            ignoreCors: store.get('ignore_cors'),
            ignoreSsl: store.get('ignore_ssl'),
            releaseChannel: store.get('release_channel'),
        },
    };

    let configRaw: null | string = null;
    try {
        configRaw = await fs.readFile(store.path, 'utf8');
    } catch (error) {
        log.warn('Failed to read main config for diagnostics export', error);
    }

    try {
        const logFiles = await fs.readdir(logsDir);
        for (const fileName of logFiles) {
            if (!fileName.endsWith('.log')) {
                continue;
            }
            const filePath = path.join(logsDir, fileName);
            const data = await fs.readFile(filePath);
            logs.push({ data, name: `logs/${fileName}` });
        }
    } catch (error) {
        log.warn('Failed to read log files for export', error);
    }

    if (logs.length === 0) {
        try {
            logs.push({
                data: await fs.readFile(logFile.path),
                name: `logs/${path.basename(logFile.path)}`,
            });
        } catch (error) {
            log.error('Failed to read active log file for export', error);
            throw error;
        }
    }

    // Worbus P4 (design §6.8): every file goes through the redaction rule (`redact.ts`), the
    // header first (ruling R1: the app's and the server's versions).
    const zipBuffer = createZipBuffer(
        diagnosticsEntries({
            configRaw,
            diagnostics,
            header: diagnosticsHeader({
                appVersion,
                arch: process.arch,
                electron: process.versions.electron,
                exportedAt,
                os: `${os.type()} ${os.release()}`,
                serverVersion,
            }),
            logs,
            rendererSettings: payload.rendererSettings ?? null,
        }),
    );
    await fs.writeFile(result.filePath, zipBuffer);

    return { canceled: false, path: result.filePath };
};

ipcMain.handle('logger-export-diagnostics', async (_event, payload?: ExportDiagnosticsPayload) => {
    return exportDiagnosticsArchive(payload);
});

export default log;

export const autoUpdaterLogInterface = {
    debug: (message: string) => {
        log.debug(message);
    },

    error: (message: string) => {
        log.error(message);
    },

    info: (message: string) => {
        log.info(message);
    },

    warn: (message: string) => {
        log.warn(message);
    },
};
