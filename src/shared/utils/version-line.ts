/**
 * Worbus P4 (design §6.7): every place that shows the version shows `0.4.0 (abc1234)`; a build
 * that is not a release build says `0.4.0-dev (abc1234)`. The commit and the release flag are
 * injected at build time (`electron.vite.config.ts` defines `__WORBUS_COMMIT__` and
 * `__WORBUS_RELEASE__`); a bundle built without them (the web and remote builds, a harness) reads
 * `unknown` and dev. Import-free, so main, preload, the renderer and the harnesses share it.
 */
export const versionLine = (version: string, commit: string, release: boolean): string =>
    `${version}${release ? '' : '-dev'} (${commit || 'unknown'})`;

export const BUILD_COMMIT: string =
    typeof __WORBUS_COMMIT__ === 'string' && __WORBUS_COMMIT__ ? __WORBUS_COMMIT__ : 'unknown';

export const BUILD_RELEASE: boolean =
    typeof __WORBUS_RELEASE__ === 'boolean' ? __WORBUS_RELEASE__ : false;

/** This build's line for the app's version (`package.json`). */
export const appVersionLine = (version: string): string =>
    versionLine(version, BUILD_COMMIT, BUILD_RELEASE);

/** `welcome.server.version` (`"0.4.0 (678af87)"`); null when absent (a server before project 4). */
export const serverVersionOf = (server: unknown): null | string => {
    const v =
        server && typeof server === 'object' ? (server as Record<string, unknown>).version : null;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
};
