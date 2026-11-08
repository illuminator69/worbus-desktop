import path from 'path';
import { defineConfig, normalizePath } from 'vite';
import { ViteEjsPlugin } from 'vite-plugin-ejs';
import { VitePWA } from 'vite-plugin-pwa';

import { kuromojiDictionaryPlugin } from './vite.kuromoji-plugin';
import { createReactPlugin } from './vite.react-plugin';

export default defineConfig({
    base: './',
    build: {
        emptyOutDir: true,
        outDir: path.resolve(__dirname, './out/web'),
        rollupOptions: {
            input: {
                '32x32': normalizePath(path.resolve(__dirname, './assets/icons/32x32.png')),
                '64x64': normalizePath(path.resolve(__dirname, './assets/icons/64x64.png')),
                '128x128': normalizePath(path.resolve(__dirname, './assets/icons/128x128.png')),
                '256x256': normalizePath(path.resolve(__dirname, './assets/icons/256x256.png')),
                '512x512': normalizePath(path.resolve(__dirname, './assets/icons/512x512.png')),
                '1024x1024': normalizePath(path.resolve(__dirname, './assets/icons/1024x1024.png')),
                favicon: normalizePath(path.resolve(__dirname, './assets/icons/favicon.ico')),
                index: normalizePath(path.resolve(__dirname, './src/renderer/index.html')),
                'screenshot-wide': normalizePath(
                    path.resolve(__dirname, './media/screenshot-wide.webp'),
                ),
            },
            output: {
                assetFileNames: (assetInfo) => {
                    const stableNames = [
                        '32x32.png',
                        '64x64.png',
                        '128x128.png',
                        '256x256.png',
                        '512x512.png',
                        '1024x1024.png',
                        'favicon.ico',
                        'screenshot-wide.webp',
                    ];

                    if (assetInfo.names.length === 1 && stableNames.includes(assetInfo.names[0])) {
                        return 'assets/[name][extname]';
                    }

                    return 'assets/[name]-[hash][extname]';
                },
                sourcemapExcludeSources: false,
            },
        },
        sourcemap: true,
    },
    css: {
        modules: {
            generateScopedName: 'fs-[name]-[local]',
            localsConvention: 'camelCase',
        },
    },
    optimizeDeps: {
        exclude: [
            '@atlaskit/pragmatic-drag-and-drop',
            '@atlaskit/pragmatic-drag-and-drop-auto-scroll',
            '@atlaskit/pragmatic-drag-and-drop-hitbox',
            '@tanstack/react-query-persist-client',
            'idb-keyval',
        ],
    },
    plugins: [
        createReactPlugin(),
        kuromojiDictionaryPlugin(),
        ViteEjsPlugin({
            root: normalizePath(path.resolve(__dirname, './src/renderer')),
            web: true,
        }),
        VitePWA({
            devOptions: {
                // The PWA will not be shown during development
                enabled: false,
            },
            filename: 'assets/sw.js',
            injectRegister: 'inline',
            manifest: {
                background_color: '#FFDCB5',
                display: 'standalone',
                icons: [
                    {
                        sizes: '32x32',
                        src: '32x32.png',
                        type: 'image/png',
                    },
                    {
                        sizes: '64x64',
                        src: '64x64.png',
                        type: 'image/png',
                    },
                    {
                        sizes: '128x128',
                        src: '128x128.png',
                        type: 'image/png',
                    },
                    {
                        sizes: '256x256',
                        src: '256x256.png',
                        type: 'image/png',
                    },
                    {
                        purpose: 'any',
                        sizes: '512x512',
                        src: '512x512.png',
                        type: 'image/png',
                    },
                    {
                        sizes: '1024x1024',
                        src: '1024x1024.png',
                        type: 'image/png',
                    },
                ],
                name: 'Worbus',
                orientation: 'portrait',
                screenshots: [
                    {
                        form_factor: 'wide',
                        label: 'Worbus for desktop: an artist page with its missing albums',
                        sizes: '1440x900',
                        src: 'screenshot-wide.webp',
                        type: 'image/webp',
                    },
                ],
                short_name: 'Worbus',
                start_url: '/',
                theme_color: '#18211F',
            },
            manifestFilename: 'assets/manifest.webmanifest',
            outDir: path.resolve(__dirname, './out/web/'),
            registerType: 'autoUpdate',
            scope: '/assets/',
            workbox: {
                cleanupOutdatedCaches: true,
                clientsClaim: true,
                globIgnores: ['**/kuromoji/**'],
                maximumFileSizeToCacheInBytes: 1000000 * 10, // 10 MB
                skipWaiting: true,
            },
        }),
    ],
    resolve: {
        alias: {
            '/@/i18n': path.resolve(__dirname, './src/i18n'),
            '/@/lyrics-conversion-api': path.resolve(
                __dirname,
                './src/main/features/core/lyrics/furigana.ts',
            ),
            '/@/remote': path.resolve(__dirname, './src/remote'),
            '/@/renderer': path.resolve(__dirname, './src/renderer'),
            '/@/shared': path.resolve(__dirname, './src/shared'),
            path: path.resolve(__dirname, './src/renderer/shims/path.ts'),
        },
    },
    root: path.resolve(__dirname, './src/renderer'),
});
