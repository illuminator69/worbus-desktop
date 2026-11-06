/**
 * Worbus P4 (design §6.7): the Worbus Server's version as the last `welcome.server.version` said
 * it (`"0.4.0 (678af87)"`), for Export diagnostics' header. Null before a welcome and from a
 * server older than project 4, which sends none. Import-free.
 */
let version: null | string = null;

export const noteServerVersion = (server: unknown): void => {
    const v =
        server && typeof server === 'object' ? (server as Record<string, unknown>).version : null;
    version = typeof v === 'string' && v.trim() ? v.trim() : null;
};

export const serverVersionNow = (): null | string => version;
