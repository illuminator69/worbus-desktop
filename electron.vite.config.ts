import { defineConfig, UserConfig } from 'electron-vite';
import { execSync } from 'node:child_process';
import { resolve } from 'path';
import conditionalImportPlugin from 'vite-plugin-conditional-import';
import dynamicImportPlugin from 'vite-plugin-dynamic-import';
import { ViteEjsPlugin } from 'vite-plugin-ejs';

import { kuromojiDictionaryPlugin } from './vite.kuromoji-plugin';
import { createReactPlugin } from './vite.react-plugin';

const currentOSEnv = process.platform;

/**
 * Worbus P4 (design §6.7): the commit this build is made from, 7 characters, shown beside the
 * version (`0.4.0 (abc1234)`); `unknown` without git. `WORBUS_COMMIT` wins when set (a build from
 * an export with no `.git`).
 */
const buildCommit = (): string => {
    const fromEnv = process.env.WORBUS_COMMIT?.trim().toLowerCase() ?? '';
    if (/^[0-9a-f]{7,40}$/.test(fromEnv)) return fromEnv.slice(0, 7);
    try {
        const out = execSync('git rev-parse --short=7 HEAD', {
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .toString()
            .trim();
        return /^[0-9a-f]{7,40}$/.test(out) ? out.slice(0, 7) : 'unknown';
    } catch {
        return 'unknown';
    }
};

/** `__WORBUS_COMMIT__` and `__WORBUS_RELEASE__` for every bundle (`shared/utils/version-line.ts`). */
const versionDefines = (isDevelopment: boolean): Record<string, string> => ({
    __WORBUS_COMMIT__: JSON.stringify(buildCommit()),
    // A production build (`electron-vite build`, what packaging runs) is a release build; `dev` is not.
    __WORBUS_RELEASE__: JSON.stringify(!isDevelopment),
});

const electronRendererTarget = 'chrome87';

const createConfig = (isDevelopment: boolean): UserConfig => ({
    main: {
        build: {
            rollupOptions: {
                external: ['source-map-support'],
            },
            sourcemap: true,
        },
        define: {
            ...versionDefines(isDevelopment),
            'import.meta.env.IS_LINUX': JSON.stringify(currentOSEnv === 'linux'),
            'import.meta.env.IS_MACOS': JSON.stringify(currentOSEnv === 'darwin'),
            'import.meta.env.IS_WIN': JSON.stringify(currentOSEnv === 'win32'),
        },
        plugins: [
            dynamicImportPlugin(),
            conditionalImportPlugin({
                currentEnv: currentOSEnv,
                envs: ['win32', 'linux', 'darwin'],
            }),
        ],
        resolve: {
            alias: {
                '/@/main': resolve('src/main'),
                '/@/shared': resolve('src/shared'),
            },
        },
    },
    preload: {
        build: {
            sourcemap: true,
        },
        define: versionDefines(isDevelopment),
        resolve: {
            alias: {
                '/@/preload': resolve('src/preload'),
                '/@/shared': resolve('src/shared'),
            },
        },
    },
    renderer: {
        build: {
            cssMinify: 'esbuild',
            minify: 'esbuild',
            modulePreload: {
                polyfill: false,
            },
            sourcemap: true,
            target: electronRendererTarget,
        },
        css: {
            modules: {
                generateScopedName: 'fs-[name]-[local]',
                localsConvention: 'camelCase',
            },
        },
        define: versionDefines(isDevelopment),
        plugins: [
            createReactPlugin(),
            ...(isDevelopment ? [kuromojiDictionaryPlugin({ emitDictionary: false })] : []),
            ViteEjsPlugin({ web: false }),
        ],
        resolve: {
            alias: {
                '/@/i18n': resolve('src/i18n'),
                '/@/lyrics-conversion-api': resolve(
                    isDevelopment
                        ? 'src/renderer/features/lyrics/api/development-lyrics-conversion-api.ts'
                        : 'src/renderer/features/lyrics/api/electron-lyrics-conversion-api.ts',
                ),
                '/@/remote': resolve('src/remote'),
                '/@/renderer': resolve('src/renderer'),
                '/@/shared': resolve('src/shared'),
                ...(isDevelopment ? { path: resolve('src/renderer/shims/path.ts') } : {}),
            },
        },
    },
});

export default defineConfig(({ command }) => createConfig(command === 'serve'));
