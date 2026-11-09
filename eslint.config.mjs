import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier';
import tseslint from '@electron-toolkit/eslint-config-ts';
import perfectionist from 'eslint-plugin-perfectionist';
import eslintPluginReact from 'eslint-plugin-react';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh';

const PLAYER_INDEX_MESSAGE =
    'player.index is a play position under shuffle: read playingQueueIndex, playOrder or playPosition from the store.';

export default tseslint.config(
    { ignores: ['**/node_modules', '**/dist', '**/out', 'commitlint.config.mjs'] },
    tseslint.configs.recommended,
    perfectionist.configs['recommended-natural'],
    eslintPluginReact.configs.flat.recommended,
    eslintPluginReact.configs.flat['jsx-runtime'],
    {
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': eslintPluginReactHooks,
            'react-refresh': eslintPluginReactRefresh,
        },
        rules: {
            ...eslintPluginReactHooks.configs['recommended-latest'].rules,
            ...eslintPluginReactRefresh.configs.vite.rules,
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-duplicate-enum-values': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            curly: ['error', 'all'],
            indent: [
                'error',
                'tab',
                {
                    offsetTernaryExpressions: true,
                    SwitchCase: 1,
                },
            ],
            'no-unused-vars': 'off',
            'no-use-before-define': 'off',
            quotes: ['error', 'single'],
            'react-hooks/refs': 'off',
            'react-hooks/set-state-in-effect': 'off',
            'react-refresh/only-export-components': 'off',
            'react/display-name': 'off',
            semi: ['error', 'always'],
            'single-attribute-per-line': 'off',
        },
    },
    {
        // W1 (B-305, B-367, B-371): `player.index` is a play position under shuffle, so outside
        // the store it is read through playingQueueIndex / playOrder / playPosition
        // (src/renderer/store/play-order.ts). play-order-guard.harness.ts checks the same.
        files: ['src/renderer/**/*.{ts,tsx}'],
        ignores: ['src/renderer/store/**'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    message: PLAYER_INDEX_MESSAGE,
                    selector:
                        "MemberExpression[property.name='index'][object.property.name='player']",
                },
                {
                    message: PLAYER_INDEX_MESSAGE,
                    selector: "MemberExpression[property.name='index'][object.name='player']",
                },
                {
                    message: PLAYER_INDEX_MESSAGE,
                    selector:
                        "VariableDeclarator[init.property.name='player'] > ObjectPattern > Property[key.name='index']",
                },
            ],
        },
    },
    eslintConfigPrettier,
);
