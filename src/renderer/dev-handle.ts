// Dev-only (loaded from app.tsx behind `import.meta.env.DEV`, so a production build drops it): lets a
// headless check over CDP add a server, set the playing song, read cover seeds and set a cover seed
// directly, without a real library.
import { api } from '/@/renderer/api';
import * as indexMirror from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import * as libraryModel from '/@/renderer/features/library/library-model';
import { useStationStore } from '/@/renderer/features/player/station/station-store';
import { queryClient } from '/@/renderer/lib/react-query';
import {
    useAppStore,
    useAuthStore,
    useHubStore,
    usePlayerStore,
    useSettingsStore,
} from '/@/renderer/store';
import { useMixesStore } from '/@/renderer/store/mixes.store';
import { useSavedQueuesStore } from '/@/renderer/store/saved-queues.store';
import { applyWashVars, washVars } from '/@/renderer/themes/cover/apply-wash-vars';
import { artOpacity, ROLE_SWITCH_MS } from '/@/renderer/themes/cover/colour-change';
import { type CoverSeed, NEUTRAL_SEED, rolesFor } from '/@/renderer/themes/cover/cover-roles';
import * as coverSeeds from '/@/renderer/themes/cover/cover-seed-store';
import { useCoverWashStore } from '/@/renderer/themes/cover/cover-wash.store';
import { logger } from '/@/renderer/utils/logger';
import * as fuzzyMatch from '/@/shared/utils/fuzzy-match';

let pendingWash: number | undefined;

Object.assign(window, {
    __coverWash: {
        /**
         * Wear `seed` in the given mode until the playing cover next changes, with a real change's
         * timing: the backdrop at once, the page's roles at the fade's midpoint.
         */
        set: (seed: CoverSeed, light: boolean) => {
            const roles = rolesFor(seed, light);
            const mode = seed === NEUTRAL_SEED ? 'neutral' : light ? 'light' : 'dark';
            window.clearTimeout(pendingWash);
            useCoverWashStore.setState({
                backdrop: { artOpacity: artOpacity(seed.meanL, mode), mode, roles },
            });
            pendingWash = window.setTimeout(() => {
                applyWashVars(washVars(roles));
                useCoverWashStore.setState({ light, roles, seed });
                logger.debug('cover wash: applied (dev handle)', {
                    at: Math.round(performance.now()),
                });
            }, ROLE_SWITCH_MS);
        },
    },
    // F4 adds the app, hub, station and saved-queue stores, to set the side queue's states and
    // the panel's width with no hub; F5 the query client and the mixes store, to seed Home's rows;
    // F6 the Library's matching and model and the index mirror, to time a keystroke's ranking alone.
    __f2: {
        api,
        coverSeeds,
        fuzzyMatch,
        indexMirror,
        libraryModel,
        queryClient,
        useAppStore,
        useAuthStore,
        useHubStore,
        useMixesStore,
        usePlayerStore,
        useSavedQueuesStore,
        useSettingsStore,
        useStationStore,
    },
});
