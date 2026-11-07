/**
 * The store_settings step to version 37: Figtree replaces Inter as the built-in font, for people
 * still on the Inter default only. Pure, for the harness.
 */

// FontType.BUILT_IN's value (shared/types/types.ts); the enum cannot load under `node --test`.
const BUILT_IN = 'builtIn';

export const migrateBuiltInFont = (font: {
    builtIn: string;
    custom: null | string;
    system: null | string;
    type: string;
}): { builtIn: string; custom: null | string; system: null | string; type: string } =>
    font.type === BUILT_IN && font.builtIn === 'Inter' ? { ...font, builtIn: 'Figtree' } : font;
