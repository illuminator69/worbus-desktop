import { useDiscoverCapabilities } from '/@/renderer/features/discover/use-discover-capabilities';
import { allows } from '/@/renderer/features/hub/utils/hub-roles';
import {
    useHubSupports,
    useLbBotAvailable,
    useLbBotDownloadsShown,
    useListeningSupported,
    useOverridesSupported,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AppRoute } from '/@/renderer/router/routes';
import { useHubConnected, useHubRoles } from '/@/renderer/store/hub.store';
import { SidebarItemType } from '/@/renderer/store/settings.store';

/**
 * navi-connect's own nav entries, in one place.
 *
 * They are appended rather than added to `sidebarItems`, which is a persisted,
 * user-reorderable list: an entry there needs a store migration and would still
 * be absent for anyone whose settings predate it. Appearing and disappearing
 * with their backing service is also the rule this whole surface follows.
 *
 * The reason this is a shared hook and not three copies is that it *was* three
 * copies — or rather one, in the expanded sidebar only. `collapsed-sidebar` and
 * `mobile-sidebar` iterate `sidebarItems` alone, so Fresh and Downloads simply
 * did not exist for anyone using a collapsed sidebar or a narrow window. Adding
 * a third entry the same way would have made that three.
 */
export const useNaviConnectSidebarItems = (): SidebarItemType[] => {
    const lbBotAvailable = useLbBotAvailable();
    // Worbus P1: with downloading off there is nothing to track, so no Downloads item.
    const downloadsShown = useLbBotDownloadsShown();
    const hubConnected = useHubConnected();
    const listeningSupported = useListeningSupported();
    const roles = useHubRoles();
    const overridesSupported = useOverridesSupported();
    const wishlistSupported = useHubSupports('GET /lb/wishlist');
    const { hasSources } = useDiscoverCapabilities();

    const items: SidebarItemType[] = [];
    // Discover is not lb-bot-gated: it also carries AudioMuse mood search and
    // the rediscovery set, so its gate is "is anything feeding this screen".
    if (hasSources) {
        items.push({ disabled: false, id: 'Discover', label: 'Discover', route: AppRoute.EXPLORE });
    }
    // Mixes are hub state, so the gate is the hub itself rather than any
    // service behind it — and a hub that is down means there are genuinely no
    // mixes to show, not a page that could explain itself.
    if (hubConnected) {
        items.push({
            disabled: false,
            id: 'Mixes',
            label: 'Mixed for You',
            route: AppRoute.MIXES,
        });
    }
    // Saved queues are this app's own record (the hub mirrors them), so the page is always
    // there; it was reachable only from Home's "Manage" link.
    items.push({
        disabled: false,
        id: 'SavedQueues',
        label: 'Saved Queues',
        route: AppRoute.SAVED_QUEUES,
    });
    if (lbBotAvailable) {
        items.push({ disabled: false, id: 'Fresh', label: 'Fresh', route: AppRoute.FRESH });
        if (downloadsShown) {
            items.push({
                disabled: false,
                id: 'Downloads',
                label: 'Downloads',
                route: AppRoute.DOWNLOADS,
            });
        }
        // Worbus P1 (F3): the Wishlist page, in both modes.
        if (wishlistSupported) {
            items.push({
                disabled: false,
                id: 'Wishlist',
                label: 'Wishlist',
                route: AppRoute.WISHLIST,
            });
        }
        // I-024: Library Matches, under the gate its lists already use - the hub
        // advertises the artist-override routes (`useOverridesSupported`). Each
        // section inside then hides itself for an lb-bot that lacks its list.
        // Worbus P2: an admin's page; listening and downloads gate in their own hooks.
        if (overridesSupported && allows(roles, 'libraryMatches')) {
            items.push({
                disabled: false,
                id: 'LibraryMatches',
                label: 'Library Matches',
                route: AppRoute.LIBRARY_MATCHES,
            });
        }
        // I-006: only when the hub advertises the listening routes (a non-empty
        // advert that includes them) — an older hub or lb-bot has no such page.
        if (listeningSupported) {
            items.push({
                disabled: false,
                id: 'Listening',
                label: 'My Listening',
                route: AppRoute.LISTENING,
            });
        }
    }
    return items;
};
