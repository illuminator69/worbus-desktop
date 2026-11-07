import { useCallback } from 'react';

import { api } from '/@/renderer/api';
import { fetchMoodList } from '/@/renderer/features/moods/mood-client';
import {
    arrangeMix,
    candidateOrder,
    type DrawSong,
    mixState,
    MOOD_FETCH_FIRST,
    MOOD_FETCH_ROUNDS,
    MOOD_FETCH_STEP,
    MOOD_MIX_SIZE,
    withinLength,
} from '/@/renderer/features/moods/mood-mix';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { beginQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import { Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

/** At most this many song lookups in flight. */
const IN_FLIGHT = 8;

const aborted = () => new DOMException('The mood mix was closed.', 'AbortError');

/** Run `work` over `items`, at most `limit` at once, keeping the input order in the answer. */
const pool = async <T, R>(
    items: T[],
    limit: number,
    work: (item: T) => Promise<R>,
): Promise<R[]> => {
    const out: R[] = new Array(items.length);
    let next = 0;
    const lane = async () => {
        while (next < items.length) {
            const at = next++;
            out[at] = await work(items[at]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return out;
};

const artistKey = (song: Song): string =>
    (song.albumArtists[0]?.id || song.artists[0]?.id || song.artistName || '').toLowerCase();

/**
 * One draw of a tile's mix: the tile's list from the hub, its first `depth` ids in a random order,
 * each resolved against this server (an id it does not know, or any failed lookup, is dropped),
 * songs longer than the mood's limit skipped, until 50 or the candidates or the rounds run out,
 * then spaced by artist. A failed list read is `unavailable`. A draw whose `signal` aborts
 * rejects with an AbortError (the caller shows nothing for it).
 */
export const drawMoodMix = async (args: {
    depth: number;
    maxSeconds: null | number;
    mood: string;
    random?: () => number;
    serverId: string;
    signal?: AbortSignal;
    variant: string;
}): Promise<{ songs: Song[]; state: 'empty' | 'ready' | 'short' | 'unavailable' }> => {
    const { depth, maxSeconds, mood, random = Math.random, serverId, signal, variant } = args;
    const list = await fetchMoodList(mood, variant);
    if (signal?.aborted) throw aborted();
    if (!list.ok) return { songs: [], state: 'unavailable' };

    const order = candidateOrder(list.data.ids, depth || list.data.depth, random);
    const kept: (DrawSong & { song: Song })[] = [];
    let next = 0;
    for (let round = 0; round < MOOD_FETCH_ROUNDS && kept.length < MOOD_MIX_SIZE; round++) {
        if (next >= order.length) break;
        const batch = order.slice(next, next + (round === 0 ? MOOD_FETCH_FIRST : MOOD_FETCH_STEP));
        next += batch.length;
        const songs = await pool(batch, IN_FLIGHT, async (id) => {
            if (signal?.aborted) return null;
            try {
                return (
                    (await api.controller.getSongDetail({
                        apiClientProps: { serverId, signal },
                        query: { id },
                    })) ?? null
                );
            } catch {
                return null;
            }
        });
        if (signal?.aborted) throw aborted();
        for (const song of songs) {
            if (!song) continue;
            const draw = {
                artistKey: artistKey(song),
                durationSec: (song.duration ?? 0) / 1000,
                id: song.id,
            };
            if (withinLength(draw, maxSeconds)) kept.push({ ...draw, song });
        }
    }

    const arranged = arrangeMix(kept);
    const state = mixState({ drawn: arranged, failed: false });
    return {
        songs: arranged.map((entry) => entry.song),
        state: state === 'loading' ? 'empty' : state,
    };
};

/**
 * Play a drawn mix: a radio-kind session named after the tile, so the saved queue it becomes is
 * found again under "Saved from these mixes". The tile's play button and the preview's "Play
 * these" both come here, with the list they hold (never a second draw).
 */
export const usePlayDrawn = () => {
    const player = usePlayer();
    return useCallback(
        (songs: Song[], title: string) => {
            if (songs.length === 0) return;
            beginQueueSession('radio', title);
            player.addToQueueByData(songs, Play.NOW);
        },
        [player],
    );
};
