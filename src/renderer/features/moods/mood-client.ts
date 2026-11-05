import { keepPreviousData, useQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';

import { useServerKey } from '/@/renderer/features/hub/utils/current-server-key';
import { moodsShown } from '/@/renderer/features/moods/mood-mix';
import { useCurrentServer, useHubSettings, useHubStore } from '/@/renderer/store';
import { useHubSecretHeld } from '/@/renderer/store/hub-set-up';
import { logger } from '/@/renderer/utils/logger';
import { MoodCatalogue, MoodListData, MoodResult } from '/@/shared/types/mood-types';
import { parseStoredMoodCatalogue } from '/@/shared/utils/mood-parse';

/**
 * The hub's mood routes, through the main process (`window.api.mood`), which holds the hub's
 * base and token. The web build has no bridge: no catalogue, no chips.
 */

const bridge = () => (isElectron() ? (window.api?.mood ?? null) : null);

const noBridge = <T>(): MoodResult<T> => ({
    error: 'Mood search needs the desktop app.',
    kind: 'unavailable',
    ok: false,
    status: 0,
});

export const fetchMoodCatalogue = async (): Promise<MoodResult<MoodCatalogue>> => {
    const api = bridge();
    if (!api) return noBridge();
    try {
        return await api.catalogue();
    } catch (error) {
        logger.warn('[mood] catalogue bridge failed', { error: String(error) });
        return { error: String(error), kind: 'unavailable', ok: false, status: 0 };
    }
};

export const fetchMoodList = async (
    mood: string,
    variant: string,
): Promise<MoodResult<MoodListData>> => {
    const api = bridge();
    if (!api) return noBridge();
    try {
        return await api.list({ mood, variant });
    } catch (error) {
        logger.warn('[mood] list bridge failed', { error: String(error) });
        return { error: String(error), kind: 'unavailable', ok: false, status: 0 };
    }
};

/**
 * The last catalogue the hub answered, so the chips are there in the first frame of a launch.
 * A per-viewer convenience: every access may throw (storage blocked), and then there is none.
 */
const STORAGE_KEY = 'mood-catalogue';

const readPersisted = (): MoodCatalogue | undefined => {
    try {
        return parseStoredMoodCatalogue(localStorage.getItem(STORAGE_KEY));
    } catch {
        return undefined;
    }
};

const writePersisted = (catalogue: MoodCatalogue | null) => {
    try {
        if (catalogue) localStorage.setItem(STORAGE_KEY, JSON.stringify(catalogue));
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // storage blocked: the next launch waits for the hub
    }
};

class MoodCatalogueError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

/**
 * Home's mood catalogue. Null while the hub is switched off or not configured, or the server is
 * not Navidrome (the hub's ids are Navidrome's), and the persisted copy is not shown then (it is kept). An older hub
 * (absent) clears the copy; a hub that does not answer keeps it. A status-0 answer (no answer, or
 * the main process has not learned the hub settings yet on a cold start) is retried.
 */
export const useMoodCatalogue = (): {
    catalogue: MoodCatalogue | null;
    isError: boolean;
    refetch: () => void;
} => {
    const hub = useHubSettings();
    // P3: the catalogue is the server's, whichever of its addresses answers (design §6.5).
    const serverKey = useServerKey();
    const server = useCurrentServer();
    const on = moodsShown({
        electron: isElectron(),
        hub,
        secretHeld: useHubSecretHeld(),
        serverType: server?.type,
    });

    // M7: the key is the server's id once main's record has answered; asking before that would
    // fetch once under the typed address and again under the id on every launch. P3 (review C2):
    // main's hub calls go only to the live socket's address, so the fetch waits for it too.
    const known = useHubStore((s) => s.server !== null && s.connected);
    const query = useQuery<MoodCatalogue | null>({
        enabled: on && known,
        initialData: readPersisted,
        // The copy is old by definition: ask the hub at once.
        initialDataUpdatedAt: 0,
        placeholderData: keepPreviousData,
        queryFn: async () => {
            const result = await fetchMoodCatalogue();
            if (result.ok) {
                writePersisted(result.data);
                return result.data;
            }
            if (result.kind === 'absent') {
                writePersisted(null);
                return null;
            }
            throw new MoodCatalogueError(result.error, result.status);
        },
        queryKey: ['moods', 'catalogue', serverKey],
        retry: (failures, error) =>
            failures < 3 && error instanceof MoodCatalogueError && error.status === 0,
        retryDelay: 1500,
        staleTime: 30_000,
    });

    if (!on) return { catalogue: null, isError: false, refetch: () => {} };
    return {
        catalogue: query.data ?? null,
        isError: query.isError,
        refetch: () => void query.refetch(),
    };
};
