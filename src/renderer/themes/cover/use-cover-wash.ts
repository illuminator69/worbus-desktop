import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { useRemoteAwarePlayerSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { usePlayerStoreBase } from '/@/renderer/store/player.store';
import { useCoverColours } from '/@/renderer/store/settings.store';
import { applyWashVars, washVars } from '/@/renderer/themes/cover/apply-wash-vars';
import { artOpacity, switchDelayMs, type WashMode } from '/@/renderer/themes/cover/colour-change';
import { useArtReady } from '/@/renderer/themes/cover/cover-art';
import {
    type CoverSeed,
    NEUTRAL_SEED,
    type Roles,
    rolesFor,
} from '/@/renderer/themes/cover/cover-roles';
import { seedKey } from '/@/renderer/themes/cover/cover-seed-cache';
import { readLastSeed, writeLastSeed } from '/@/renderer/themes/cover/cover-seed-store';
import { useCoverWashStore } from '/@/renderer/themes/cover/cover-wash.store';
import { useCoverSeed } from '/@/renderer/themes/cover/use-cover-seed';
import { useWindowLight } from '/@/renderer/themes/cover/use-window-light';
import { logger } from '/@/renderer/utils/logger';
import { LibraryItem } from '/@/shared/types/domain-types';

/** What the window shows: `artSrc` is set only for a seed resolved from that cover. */
interface Shown {
    artSrc: null | string;
    seed: CoverSeed;
}

/** The backdrop's mode: neutral only for nothing playing, not for a remembered seed before a cover. */
const modeOf = (shown: Shown, light: boolean): WashMode =>
    shown.artSrc === null && shown.seed === NEUTRAL_SEED ? 'neutral' : light ? 'light' : 'dark';

/** What the backdrop layers fade to: the roles and how strongly the artwork glows through. */
const backdropOf = (shown: Shown, light: boolean, roles: Roles) => {
    const mode = modeOf(shown, light);
    return { artOpacity: artOpacity(shown.seed.meanL, mode), mode, roles };
};

/**
 * Nothing playing is neutral; a resolved cover is its own seed; an unresolved (or failed) cover keeps
 * what is shown, so there is no neutral flash between songs. Returns `shown` itself when nothing changes.
 */
const nextShown = (
    shown: Shown,
    playing: boolean,
    cover: { resolved: boolean; seed: CoverSeed; src?: string },
): Shown => {
    if (!playing) {
        return shown.seed === NEUTRAL_SEED && shown.artSrc === null
            ? shown
            : { artSrc: null, seed: NEUTRAL_SEED };
    }
    if (!cover.resolved || !cover.src) return shown;
    if (cover.seed === shown.seed && cover.src === shown.artSrc) return shown;
    return { artSrc: cover.src, seed: cover.seed };
};

/**
 * Colours the window from the playing cover while `Cover colours` is on: the roles as variables on
 * `<html>`, `data-cover-wash="true"`, and the wash store, in the user's light or dark mode (never the
 * cover's: `useWindowLight`). A change writes the store's `backdrop` at
 * once (the wash's layers cross-fade to it) and the page's roles at the fade's midpoint; the first
 * application and reduced motion write both before paint. Mounted once, in the renderer's
 * `ThemedApp`, before `useAppTheme`.
 */
export const useCoverWash = (): void => {
    const on = useCoverColours();
    const light = useWindowLight();
    const song = useRemoteAwarePlayerSong();
    // The player bar's own cover URL (left-controls' `ItemImage`, type "table"), so it is one image.
    const src = useItemImageUrl({
        id: song?.imageId,
        imageUrl: song?.imageUrl ?? undefined,
        itemType: LibraryItem.SONG,
        serverId: song?._serverId,
        type: 'table',
    });
    const key =
        on && song?._serverId && song.imageId ? seedKey(song._serverId, song.imageId) : undefined;
    // The cover's seed and its artwork load side by side, and a change waits for both, so the colours
    // and the artwork arrive in the same frame (a cached seed alone used to change the colours a
    // second before the artwork had loaded).
    const seed = useCoverSeed({ key, src });
    const artReady = useArtReady(key ? src : undefined);
    const cover = { ...seed, resolved: seed.resolved && artReady };

    // The player store hydrates from IndexedDB after the first render: until it has, "no song" means
    // "not known yet", not "nothing playing", so a cold start keeps the last seed instead of neutral.
    const [playerReady, setPlayerReady] = useState(() => usePlayerStoreBase.persist.hasHydrated());
    useEffect(() => {
        if (playerReady) return undefined;
        if (usePlayerStoreBase.persist.hasHydrated()) {
            setPlayerReady(true);
            return undefined;
        }
        return usePlayerStoreBase.persist.onFinishHydration(() => setPlayerReady(true));
    }, [playerReady]);
    const playingKnown = Boolean(song) || playerReady;

    const [shown, setShown] = useState<Shown>(() => {
        const last = readLastSeed();
        const initial: Shown = { artSrc: null, seed: last };
        const first = playingKnown ? nextShown(initial, Boolean(song), { ...cover, src }) : initial;
        // Seeded here, once, so `useAppTheme`'s first render already has the mode and leaves the accent
        // to the wash; afterwards only the layout effect below writes the store.
        if (on) {
            const roles = rolesFor(first.seed, light);
            useCoverWashStore.setState({
                ...first,
                backdrop: backdropOf(first, light, roles),
                light,
                on: true,
                roles,
            });
        }
        return first;
    });

    const next = playingKnown ? nextShown(shown, Boolean(song), { ...cover, src }) : shown;
    if (next !== shown) setShown(next);

    // The first application after `on` (cold start, or Cover colours turned on) is not a change.
    const first = useRef(true);
    const pending = useRef<number | undefined>(undefined);

    useLayoutEffect(() => {
        if (!on) return;
        const roles = rolesFor(shown.seed, light);
        window.clearTimeout(pending.current);
        pending.current = undefined;
        document.documentElement.setAttribute('data-cover-wash', 'true');
        useCoverWashStore.setState({
            artSrc: shown.artSrc,
            backdrop: backdropOf(shown, light, roles),
            on: true,
        });
        const apply = () => {
            pending.current = undefined;
            applyWashVars(washVars(roles));
            useCoverWashStore.setState({ light, roles, seed: shown.seed });
            // The last window seed, for the next cold start: a cover's, or neutral once nothing is
            // known to play (so a launch with an empty queue does not open on the last cover's colours).
            if (shown.artSrc || shown.seed === NEUTRAL_SEED) writeLastSeed(shown.seed);
            logger.debug('cover wash: applied', {
                cover: Boolean(shown.artSrc),
                hue: Math.round(shown.seed.hue),
                k: shown.seed.k,
                light,
            });
        };
        const delay = switchDelayMs({
            first: first.current,
            reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
        first.current = false;
        if (delay === 0) apply();
        else pending.current = window.setTimeout(apply, delay);
    }, [light, on, shown]);

    useLayoutEffect(() => {
        if (!on) return undefined;
        return () => {
            // No late write after off: the pending switch would put the variables back.
            window.clearTimeout(pending.current);
            pending.current = undefined;
            first.current = true;
            applyWashVars(null);
            document.documentElement.removeAttribute('data-cover-wash');
            useCoverWashStore.setState({ artSrc: null, on: false });
            logger.debug('cover wash: off');
        };
    }, [on]);
};
