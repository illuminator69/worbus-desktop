import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier';
import tseslint from '@electron-toolkit/eslint-config-ts';
import perfectionist from 'eslint-plugin-perfectionist';
import eslintPluginReact from 'eslint-plugin-react';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh';

const PLAYER_INDEX_MESSAGE =
    'player.index is a play position under shuffle: read playingQueueIndex, playOrder or playPosition from the store.';

const PLAYER_ALIAS_MESSAGE =
    'Bind the player store slice only as `player`, so a read of player.index stays visible to this rule.';

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
                // x.player.index, x.player?.index, x.player['index'], player.index
                ...[
                    "MemberExpression[property.name='index'][object.property.name='player']",
                    "MemberExpression[property.name='index'][object.name='player']",
                    "MemberExpression[property.value='index'][object.property.name='player']",
                    "MemberExpression[property.value='index'][object.name='player']",
                    // const { index } = x.player; const { player: { index } } = x
                    "VariableDeclarator[init.property.name='player'] > ObjectPattern > Property[key.name='index']",
                    "Property[key.name='player'] > ObjectPattern > Property[key.name='index']",
                ].map((selector) => ({ message: PLAYER_INDEX_MESSAGE, selector })),
                // The slice under another name (const p = x.player; const { player: p } = x)
                // is the field out of sight: it is only ever called `player`.
                ...[
                    "VariableDeclarator[init.property.name='player'][id.type='Identifier'][id.name!='player']",
                    "ObjectPattern > Property[key.name='player'][value.type='Identifier'][value.name!='player']",
                ].map((selector) => ({ message: PLAYER_ALIAS_MESSAGE, selector })),
            ],
        },
    },
    eslintConfigPrettier,
);
