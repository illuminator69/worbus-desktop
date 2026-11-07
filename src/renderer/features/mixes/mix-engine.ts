import type { StationSeed } from '/@/shared/types/station-types';
import type { QueryClient } from '@tanstack/react-query';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import { genresQueries } from '/@/renderer/features/genres/api/genres-api';
import {
    genreNameOf,
    mixArtistIds,
    mixCharacter,
    mixPlan,
    StationPlan,
} from '/@/renderer/features/mixes/mix-recipe';
import {
    AlchemyParams,
    AudioMuseSettings,
    fetchAlchemyIds,
    fetchFingerprintIds,
} from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { runAutoDjSongs } from '/@/renderer/features/player/auto-dj/auto-dj-songs';
import {
    artistRadioQueue,
    artistRadioSeed,
    buildStationQueue,
    currentCharacter,
    customRadioSeed,
    ownSongsOf,
    stationsReady,
    trackRadioSeed,
} from '/@/renderer/features/player/station/station-client';
import {
    customRadioSeeds,
    interleaveSeeds,
    StationBinding,
} from '/@/renderer/features/player/station/station-logic';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { Mix, MixKind } from '/@/renderer/store';
import { AUTO_DJ_STRATEGY } from '/@/renderer/store/settings.store';
import { shuffleInPlace } from '/@/renderer/utils/shuffle';
import {
    GenreListSort,
    Played,
    QueueSong,
    ServerListItem,
    Song,
    SortOrder,
} from '/@/shared/types/domain-types';

/**
 * Regenerating a mix from its recipe.
 *
 * **This is the whole point of the feature, and the one thing a snapshot would
 * also pass a casual test of.** Playing a mix twice must produce two different
 * tracklists — otherwise it is a saved queue with a nicer name. Every branch
 * below therefore re-asks its source rather than reading anything cached: the
 * random and alchemy sources are non-deterministic by nature, and the two
 * library-query branches shuffle a pool several times the size of the answer.
 *
 * Nothing here is a new engine. With the hub's station engine (I-040) the
 * radio-like kinds start a station, which never serves what it served before or
 * what was played in the last two weeks, so a second play differs by design. The
 * other kinds, and every kind without the engine, route into machinery this
 * client already runs for Auto DJ.
 */

/**
 * Song Alchemy knobs for an `adaptive` mix played without the station engine: the numbers the
 * old Mood Flow presets used, kept so that path plays as it always did.
 */
const legacyAlchemyParams = (mix: Mix): AlchemyParams => {
    switch (mixCharacter(mix)) {
        case 'close':
            return { temperature: 0.5 };
        case 'explore':
            return { temperature: 1.6 };
        default:
            return { subtractDistance: 0.35, temperature: 0.6 };
    }
};

export interface MixEngineDeps {
    audioMuse: AudioMuseSettings;
    queryClient: QueryClient;
    server: null | ServerListItem | undefined;
    serverId: string;
}

/**
 * One run of a recipe. `station` is set when it played through the hub's station engine: the
 * queue then belongs to that station, and playing it binds the session to it (I-040).
 */
export interface MixRun {
    songs: Song[];
    station?: StationBinding;
}

/** Bare ids → full Songs. Mirrors `use-auto-dj`'s `resolveSongsByIds`; a song
 *  that no longer exists is dropped rather than faking a row, because unlike a
 *  hub queue there is no index here for a gap to shift. */
const resolveSongsByIds = async (serverId: string, ids: string[]): Promise<Song[]> => {
    if (ids.length === 0) return [];
    const songs = await Promise.all(
        ids.map((id) =>
            api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id } })
                .catch(() => null),
        ),
    );
    return songs.filter((song): song is Song => Boolean(song));
};

const seedSong = (serverId: string, id: string): Promise<null | Song> =>
    api.controller.getSongDetail({ apiClientProps: { serverId }, query: { id } }).catch(() => null);

/**
 * Start the station a recipe's plan names (`mixPlan`, PROTOCOL §17.1) and build its queue. An
 * Artist mix starts exactly what the artist-radio entry point starts: a `tracks` seed of the
 * artist's songs (`artistRadioSeed`), named after the artist. Null: the seed is gone, or the
 * engine started nothing, and the recipe's local path runs.
 */
const runStation = async (
    plan: StationPlan,
    serverId: string,
    count: number,
): Promise<MixRun | null> => {
    let seeded: null | { leading: Song[]; seed: StationSeed } = null;
    switch (plan.kind) {
        case 'artist':
            // One artist: the artist radio's seed. Several (a custom radio, P5): their seeds
            // dealt in turn, an artist the library no longer holds skipped.
            seeded = await (
                plan.artistIds.length > 1
                    ? customRadioSeed(serverId, plan.artistIds, plan.artistName)
                    : artistRadioSeed(serverId, { id: plan.artistIds[0], name: plan.artistName })
            ).catch(() => null);
            break;
        case 'track': {
            const song = await seedSong(serverId, plan.songId);
            seeded = song ? trackRadioSeed(song) : null;
            break;
        }
        case 'yourMix':
            seeded = { leading: [], seed: { kind: 'yourMix' } };
            break;
    }
    if (!seeded) return null;
    const queue = await buildStationQueue({
        character: plan.character,
        count,
        ...seeded,
        serverId,
        variety: plan.kind === 'artist' ? plan.variety : undefined,
    });
    return queue ? { songs: queue.songs, station: queue.binding } : null;
};

/**
 * Run one mix's recipe and answer with a fresh tracklist.
 *
 * Empty is a legitimate answer - an AudioMuse index that has not been built, a
 * seed song that has been deleted, a genre with nothing in it - and the caller
 * says so rather than starting silent playback.
 */
export const regenerateMix = async (mix: Mix, deps: MixEngineDeps): Promise<MixRun> => {
    const { serverId } = deps;
    const count = Math.max(1, Math.min(50, mix.count || 50));
    const plan = mixPlan(mix, { engine: stationsReady(), preferred: currentCharacter() });

    if (plan.station) {
        const viaStation = await runStation(plan.station, serverId, count);
        if (viaStation) return viaStation;
    }

    // A kind this build does not know. Refused, not approximated - see `isKnownMixKind`. The
    // caller checks first and says so; this is the second line of that defence.
    if (!plan.local) return { songs: [] };
    return { songs: await regenerateLocally(mix, plan.local, deps, Math.max(1, mix.count || 50)) };
};

/** The paths that run without the station engine, as they always did. */
const regenerateLocally = async (
    mix: Mix,
    kind: Exclude<MixKind, 'station'>,
    deps: MixEngineDeps,
    count: number,
): Promise<Song[]> => {
    const { audioMuse, queryClient, server, serverId } = deps;

    switch (kind) {
        case 'adaptive': {
            // Song Alchemy off the stored seed. `subtractIds` is empty on
            // purpose: the skip signals Auto DJ feeds it are a property of the
            // *current* listening session, and a recipe that carried a
            // fossilised set of them would drift further from the seed every
            // time it was replayed.
            if (!mix.seedId) return [];
            const ids = await fetchAlchemyIds(
                audioMuse,
                [mix.seedId],
                [],
                count,
                legacyAlchemyParams(mix),
            );
            return resolveSongsByIds(serverId, ids);
        }
        case 'artist': {
            // The artist radio without a station (B-149): the artist's own most played songs,
            // then Navidrome's similar songs, cut at the mix's length. Never a shuffle. A custom
            // radio (P5): every artist's seeds dealt in turn, then their similar songs in turn.
            const ids = mixArtistIds(mix);
            if (ids.length === 0) return [];
            if (ids.length === 1) {
                return artistRadioQueue({ artistId: ids[0], cap: count, count, serverId });
            }
            const own = await Promise.all(
                ids.map((artistId) => ownSongsOf(serverId, artistId).catch(() => [] as Song[])),
            );
            const held = ids.filter((_, i) => own[i].length > 0);
            const each = Math.max(5, Math.floor(count / Math.max(1, held.length)));
            const similar = await Promise.all(
                held.map((artistId) =>
                    api.controller
                        .getArtistRadio({
                            apiClientProps: { serverId },
                            query: { artistId, count: each },
                        })
                        .catch(() => [] as Song[]),
                ),
            );
            const seen = new Set<string>();
            return [...customRadioSeeds(own), ...interleaveSeeds(similar)]
                .filter((song) => !seen.has(song.id) && Boolean(seen.add(song.id)))
                .slice(0, count);
        }
        case 'fingerprint': {
            // Seeded from listening history rather than from a stored id, which
            // is why this is the one kind with no seed: its recipe is "me,
            // lately", and that moves on its own.
            const ids = await fetchFingerprintIds(audioMuse, server ?? null, count);
            return resolveSongsByIds(serverId, ids);
        }
        case 'genre': {
            // `getRandomSongList` takes a genre NAME, and so does Worbus for Android: a recipe holds the
            // name (B-151). One from before that holds Navidrome's genre id; with no stored
            // name beside it, the id is looked up in the genre list.
            const genres = mix.seedName.trim()
                ? null
                : await queryClient
                      .fetchQuery(
                          genresQueries.list({
                              query: {
                                  limit: -1,
                                  sortBy: GenreListSort.NAME,
                                  sortOrder: SortOrder.ASC,
                                  startIndex: 0,
                              },
                              serverId,
                          }),
                      )
                      .catch(() => null);
            const genre = genreNameOf(mix, genres?.items);
            // No genre is not "any genre": a run through the whole library is not this mix.
            if (!genre) return [];
            const random = await queryClient
                .fetchQuery({
                    ...songsQueries.random({
                        query: {
                            genre,
                            limit: count,
                            played: Played.All,
                        },
                        serverId,
                    }),
                    queryKey: queryKeys.player.fetch({ at: Date.now(), mixGenre: mix.id }),
                })
                .catch(() => null);
            return shuffleInPlace((random?.items ?? []).slice()).slice(0, count);
        }
        case 'similar': {
            // The Auto DJ similarity runner, given the seed song as its
            // "current" track. It wants a QueueSong; a Song satisfies every
            // field it actually reads (id, artists, albumId, genres) and the
            // cast is the same one `use-auto-dj` makes on its remote path.
            if (!mix.seedId) return [];
            const seed = await api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id: mix.seedId } })
                .catch(() => null);
            if (!seed) return [];
            return runAutoDjSongs({
                allowDuplicates: false,
                currentSong: seed as unknown as QueueSong,
                itemCount: count,
                musicFolderId: server?.musicFolderId || undefined,
                onlySimilar: false,
                queryClient,
                queueSongIdSet: new Set<string>(),
                server,
                serverId,
                songStrategy: AUTO_DJ_STRATEGY.SIMILAR,
                trySimilarSongs: true,
            });
        }
    }
};
