import { serverVersionOf } from '/@/shared/utils/version-line';

/**
 * Worbus P4 (design §6.7): the Worbus Server's version as the last `welcome.server.version` said
 * it (`"0.4.0 (678af87)"`), for Export diagnostics' header. Null before a welcome and from a
 * server older than project 4, which sends none.
 */
let version: null | string = null;

export const noteServerVersion = (server: unknown): void => {
    version = serverVersionOf(server);
};

export const serverVersionNow = (): null | string => version;
