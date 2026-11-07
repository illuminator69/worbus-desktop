import { create } from 'zustand';

import { type WashMode } from '/@/renderer/themes/cover/colour-change';
import {
    type CoverSeed,
    NEUTRAL_SEED,
    type Roles,
    rolesFor,
} from '/@/renderer/themes/cover/cover-roles';

/**
 * The window wash as applied: written only by `useCoverWash` (the renderer's `ThemedApp`), so it stays
 * `on: false` in the remote SPA. Not persisted.
 */
export interface CoverWashState {
    /** The playing cover's small URL once its seed is resolved; null when nothing plays. */
    artSrc: null | string;
    /**
     * What the wash's backdrop layers fade to: written at once on a change, while `light`, `roles` and
     * `seed` (what the page wears) follow at the fade's midpoint.
     */
    backdrop: { artOpacity: number; mode: WashMode; roles: Roles };
    light: boolean;
    on: boolean;
    roles: Roles;
    seed: CoverSeed;
}

export const useCoverWashStore = create<CoverWashState>()(() => ({
    artSrc: null,
    backdrop: { artOpacity: 0, mode: 'neutral', roles: rolesFor(NEUTRAL_SEED, false) },
    light: false,
    on: false,
    roles: rolesFor(NEUTRAL_SEED, false),
    seed: NEUTRAL_SEED,
}));

export const useCoverWashOn = (): boolean => useCoverWashStore((state) => state.on);
