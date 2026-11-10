import type { PlayerContext } from '/@/renderer/features/player/context/player-context';
import type {
    StationAnswer,
    StationCatalog,
    StationCharacterId,
    StationCount,
    StationNextBody,
    StationResult,
    StationSeed,
    StationSignalAnswer,
    StationSignalKind,
    StationStartBody,
    StationTrack,
    StationVariety,
} from '/@/shared/types/station-types';

import isElectron from 'is-electron';

import { api } from '/@/renderer/api';
import { isRemoteSessionActive } from '/@/renderer/features/hub/utils/remote-queue';
import { keepsCurrentSong } from '/@/renderer/features/player/station/keep-current';
import {
    artistFallbackQueue,
    artistSeedSongs,
    bindingFromAnswer,
    customRadioSeeds,
    keepResolved,
    latchesAutoDj,
    ownArtistSongs,
    SEED_TRACKS_MAX,
    spreadPick,
    START_COUNT,
    StationBinding,
    takesVariety,
} from '/@/renderer/features/player/station/station-logic';
import { getStationMode, useStationStore } from '/@/renderer/features/player/station/station-store';
import { beginQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import { useHubStore } from '/@/renderer/store/hub.store';
import { usePlayerStoreBase } from '/@/renderer/store/player.store';
import { useSettingsStore } from '/@/renderer/store/settings.store';
import { logger } from '/@/renderer/utils/logger';
import { Album, Song, SongListSort, SortOrder } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

/**
 * navi-connect stations (I-040): the renderer's half of the station client. The calls go
 * through the main process (`window.api.station`), which holds the hub's base and token.
 *
 * Every radio entry point asks `playStationRadio` first and runs its own upstream path when it
 * answers false: no hub, a hub without stations, an engine that answered 503, or a seed the
 * engine does not know. Nothing here falls back to random songs.
 */

const bridge = () => (isElectron() ? (window.api?.station ?? null) : null);

const noBridge = <T>(): StationResult<T> => ({
    data: null,
    error: 'Stations need the desktop app.',
    ok: false,
    status: 0,
});

const deviceId = (): string | undefined => useHubStore.getState().myDeviceId ?? undefined;

/** The probe. Null when nothing readable came back (no hub, an older hub, a timeout). */
export const probeStations = async (): Promise<null | StationCatalog> => {
    const station = bridge();
    if (!station) return null;
    const result = await station.characters();
    return result.ok ? result.data : null;
};

const noteFallback = <T>(result: StationResult<T>, route: string): StationResult<T> => {
    if (latchesAutoDj(result)) {
        logger.warn('Station engine unavailable, using Auto DJ', { route, status: result.status });
        useStationStore.getState().actions.latchFallback();
    } else if (!result.ok && result.busy) {
        // B-268: the hub's own pool was full; this one request falls back, autoplay stays.
        logger.info('Station engine busy, not switching to Auto DJ', { route });
    }
    return result;
};

export const startStation = async (
    body: StationStartBody,
): Promise<StationResult<StationAnswer>> => {
    const station = bridge();
    if (!station) return noBridge();
    const result = await station.start({ deviceId: deviceId(), ...body });
    // Your mix answers 503 whenever AudioMuse is down (the fingerprint has no Tier 1 equivalent,
    // PROTOCOL §18.1), while a radio would still play through Navidrome. That says nothing about
    // the engine as a whole, so it does not switch autoplay over to Auto DJ.
    return body.seed.kind === 'yourMix' ? result : noteFallback(result, 'start');
};

/**
 * `POST /sonic/station/count` (P5): how many songs a seed set could draw from, read-only. Not
 * asked of a hub whose probe does not list `count` (answered as a 404 with no code, like an older
 * hub's).
 */
export const countStation = async (
    seed: StationSeed,
    character: StationCharacterId,
): Promise<StationResult<StationCount>> => {
    const station = bridge();
    if (!station) return noBridge();
    if (!useStationStore.getState().catalog?.count) {
        return { data: null, error: 'This hub cannot count.', ok: false, status: 404 };
    }
    return station.count({ character, seed });
};

export const nextStation = async (body: StationNextBody): Promise<StationResult<StationAnswer>> => {
    const station = bridge();
    if (!station) return noBridge();
    return noteFallback(await station.next({ deviceId: deviceId(), ...body }), 'next');
};

/** A signal for the bound station. Fire and forget: a signal that does not land only steers less. */
export const signalStation = async (
    kind: StationSignalKind,
    extra: { apply?: boolean; trackId?: string; value?: StationCharacterId } = {},
): Promise<null | StationSignalAnswer> => {
    const station = bridge();
    const bound = useStationStore.getState().bound;
    if (!station || !bound) return null;
    const result = await station.signal({ kind, stationId: bound.stationId, ...extra });
    if (!result.ok) {
        logger.warn('Station signal not applied', { kind, status: result.status });
        return null;
    }
    return result.data;
};

/**
 * Served tracks as Songs, in the order served. An id this server cannot resolve is DROPPED: a
 * placeholder would play with no duration and no metadata. The songs the queue already holds
 * are reused rather than asked for again.
 */
export const resolveStationSongs = async (
    tracks: StationTrack[],
    serverId: null | string,
    known?: Map<string, Song>,
): Promise<Song[]> => {
    if (!serverId || tracks.length === 0) return [];
    const resolved = await Promise.all(
        tracks.map((track) => {
            const already = known?.get(track.id);
            if (already) return Promise.resolve(already);
            return api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id: track.id } })
                .catch(() => null);
        }),
    );
    const songs = keepResolved(resolved);
    if (songs.length < tracks.length) {
        logger.warn('Station tracks this server could not resolve were dropped', {
            dropped: tracks.length - songs.length,
            served: tracks.length,
        });
    }
    return songs;
};

/** Whether a radio entry point should try a station before its own path. */
export const stationsReady = (): boolean => getStationMode() === 'stations';

export const currentCharacter = (): StationCharacterId =>
    useSettingsStore.getState().station?.character ?? 'balanced';

export interface StationQueue {
    binding: StationBinding;
    songs: Song[];
}

/**
 * Start a station and build the queue it plays: the seed songs the caller already has, then the
 * station's first batch. Null means the caller runs its own path; the reason is logged.
 */
export const buildStationQueue = async (args: {
    character?: StationCharacterId;
    count?: number;
    leading: Song[];
    seed: StationSeed;
    serverId: string;
    /** Artist variety (P5); sent only when the probe lists it, so an older hub sees no new key. */
    variety?: StationVariety;
}): Promise<null | StationQueue> => {
    if (getStationMode() !== 'stations') return null;
    const variety =
        args.variety && takesVariety(useStationStore.getState().catalog, args.variety)
            ? args.variety
            : undefined;
    const result = await startStation({
        ...(variety ? { variety } : {}),
        character: args.character ?? currentCharacter(),
        count: Math.max(1, Math.min(50, args.count ?? START_COUNT)),
        exclude: args.leading.map((song) => song.id),
        // Every entry point starts a radio (the hub's word; since I-041 Off stops radios too).
        origin: 'radio',
        seed: args.seed,
    });
    if (!result.ok || !result.data) {
        logger.info('Station radio not started, using the app radio', {
            code: result.code,
            status: result.status,
        });
        return null;
    }
    const answer = result.data;
    // The station's own rows carry its id, so a chip can take them out later and leave the
    // seed and anything the user adds alone (I-041).
    const songs = (await resolveStationSongs(answer.tracks, args.serverId)).map((song) => ({
        ...song,
        _stationId: answer.stationId,
    }));
    if (args.leading.length + songs.length === 0) return null;
    return {
        binding: bindingFromAnswer(answer),
        songs: [...args.leading, ...songs],
    };
};

/**
 * Play a station's queue: replace the queue, and when the replace really happens arm its binding
 * and announce the new session (which binds it). The `setQueue` this causes names the station,
 * through hub or locally.
 *
 * Both wait for the replace (`onApply`), not for this call: with "Discard the current queue?"
 * up, an announcement made here went stale after 4 s, so the confirmed replace began a second,
 * nameless session that unbound the radio; and a cancelled one left the queue still playing
 * bound to the radio it had declined.
 */
export const playStationQueue = (
    queue: StationQueue,
    sessionName: string,
    player: Partial<Pick<PlayerContext, 'playKeepingCurrent'>> &
        Pick<PlayerContext, 'addToQueueByData'>,
    skipConfirmation?: boolean,
): void => {
    const onApply = () => {
        const { actions } = useStationStore.getState();
        actions.arm(queue.binding);
        actions.noteServed(
            queue.binding.stationId,
            queue.songs.filter((song) => song._stationId).map((song) => song.id),
        );
        // I-041: starting a radio turns autoplay back on (the character is kept), so a radio
        // goes on until the user picks Off.
        if (!useSettingsStore.getState().autoDJ.enabled) {
            useSettingsStore.getState().actions.setSettings({ autoDJ: { enabled: true } });
        }
        beginQueueSession('radio', sessionName);
    };
    // B-175: a radio from the song playing now keeps it playing and replaces only what follows
    // it; Play.NOW would replace its row and restart it from 0.
    if (player.playKeepingCurrent && keepsCurrentSong(queue.songs, currentSongId())) {
        player.playKeepingCurrent(queue.songs, skipConfirmation, onApply);
        return;
    }
    player.addToQueueByData(queue.songs, Play.NOW, undefined, undefined, skipConfirmation, onApply);
};

/** The song playing now: the remote device's while another device plays, else this one's. */
export const currentSongId = (): string | undefined => {
    if (isRemoteSessionActive()) {
        const hub = useHubStore.getState();
        return hub.remoteQueue[hub.remoteQueueIndex]?.id;
    }
    return usePlayerStoreBase.getState().getCurrentSong()?.id;
};

/** Track, album or artist radio, as a station. False: run the caller's own radio. */
export const playStationRadio = async (args: {
    character?: StationCharacterId;
    leading: Song[];
    player: Partial<Pick<PlayerContext, 'playKeepingCurrent'>> &
        Pick<PlayerContext, 'addToQueueByData'>;
    seed: StationSeed;
    serverId: string;
    sessionName: string;
    /** The remote web control already asked on the phone. */
    skipConfirmation?: boolean;
}): Promise<boolean> => {
    try {
        const queue = await buildStationQueue(args);
        if (!queue) return false;
        playStationQueue(queue, args.sessionName, args.player, args.skipConfirmation);
        return true;
    } catch (error) {
        logger.error('Station radio failed', { error: (error as Error).message });
        return false;
    }
};

/** A track radio's seed: the track itself, which plays first. */
export const trackRadioSeed = (song: Song): { leading: Song[]; seed: StationSeed } => ({
    leading: [song],
    seed: { ids: [song.id], kind: 'track', name: song.name },
});

/** An album radio's seed: up to five of its tracks, spread over the album, which play first. */
export const albumRadioSeed = async (
    serverId: string,
    album: Pick<Album, 'id' | 'name'> & { songs?: Song[] },
): Promise<null | { leading: Song[]; seed: StationSeed }> => {
    let songs = album.songs ?? [];
    if (songs.length === 0) {
        const detail = await api.controller
            .getAlbumDetail({ apiClientProps: { serverId }, query: { id: album.id } })
            .catch(() => null);
        songs = detail?.songs ?? [];
    }
    const leading = spreadPick(songs, SEED_TRACKS_MAX);
    if (leading.length === 0) return null;
    return {
        leading,
        seed: { ids: leading.map((song) => song.id), kind: 'tracks', name: album.name },
    };
};

/** An artist's own songs in the library, in album order: what its radio's seeds are chosen from. */
export const ownSongsOf = async (serverId: string, artistId: string): Promise<Song[]> => {
    const list = await api.controller
        .getSongList({
            apiClientProps: { serverId },
            query: {
                artistIds: [artistId],
                sortBy: SongListSort.ALBUM,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
        })
        .catch(() => null);
    return ownArtistSongs(list?.items ?? [], artistId);
};

/**
 * An artist radio's seed songs, the rule Worbus for Android uses (`artistSeedSongs`, B-149): up to five of
 * the artist's own songs in the library, the most played (this user's play counts), one per
 * album first. Not `getTopSongs` (Last.fm's list matched to the library through Navidrome): it
 * answered nothing for Radiohead's 17 songs here. Asked in album order, so equal play counts fall
 * in that order.
 */
export const artistSeedSongsFor = async (serverId: string, artistId: string): Promise<Song[]> =>
    artistSeedSongs(await ownSongsOf(serverId, artistId));

const artistStationSeed = (leading: Song[], name: string) => ({
    leading,
    seed: { ids: leading.map((song) => song.id), kind: 'tracks', name } satisfies StationSeed,
});

/**
 * A custom radio's seed (P5): `customRadioSeeds` over each artist's own songs, which play first,
 * named after the radio. An artist the library no longer holds adds nothing; null: none holds any.
 */
export const customRadioSeed = async (
    serverId: string,
    artistIds: readonly string[],
    name: string,
): Promise<null | { leading: Song[]; seed: StationSeed }> => {
    const perArtist = await Promise.all(artistIds.map((id) => ownSongsOf(serverId, id)));
    const leading = customRadioSeeds(perArtist);
    return leading.length === 0 ? null : artistStationSeed(leading, name);
};

/** An artist radio's station seed: its seed songs (`artistSeedSongsFor`), which play first. */
export const artistRadioSeed = async (
    serverId: string,
    artist: { id: string; name: string },
): Promise<null | { leading: Song[]; seed: StationSeed }> => {
    const leading = await artistSeedSongsFor(serverId, artist.id);
    return leading.length === 0 ? null : artistStationSeed(leading, artist.name);
};

/**
 * An artist radio without a station (Worbus for Android's `artistSimilarQueue`): the seed songs, then
 * `count` of Navidrome's similar songs for the artist (`getSimilarSongs2`), cut at `cap` when
 * given. Never a shuffle of the artist's own songs.
 */
export const artistRadioQueue = async (args: {
    artistId: string;
    cap?: number;
    count: number;
    seeds?: Song[];
    serverId: string;
}): Promise<Song[]> => {
    const [seeds, similar] = await Promise.all([
        args.seeds ?? artistSeedSongsFor(args.serverId, args.artistId),
        api.controller
            .getArtistRadio({
                apiClientProps: { serverId: args.serverId },
                query: { artistId: args.artistId, count: args.count },
            })
            .catch(() => [] as Song[]),
    ]);
    return artistFallbackQueue(seeds, similar, args.cap);
};

/**
 * An artist's radio from the artist page or an artist's menu, one rule with an Artist mix
 * (B-149): played now with the engine, a station from the seed songs, which play first;
 * otherwise (or when no station starts) the seed songs and Navidrome's similar songs. False:
 * nothing to play.
 */
export const playArtistRadio = async (args: {
    artist: { id: string; name: string };
    count: number;
    player: Pick<PlayerContext, 'addToQueueByData'>;
    playType: Play;
    serverId: string;
}): Promise<boolean> => {
    const { artist, player, playType, serverId } = args;
    const seeds = await artistSeedSongsFor(serverId, artist.id);
    if (playType === Play.NOW && stationsReady() && seeds.length > 0) {
        const started = await playStationRadio({
            ...artistStationSeed(seeds, artist.name),
            player,
            serverId,
            sessionName: artist.name,
        });
        if (started) return true;
    }
    const queue = await artistRadioQueue({
        artistId: artist.id,
        count: args.count,
        seeds,
        serverId,
    });
    if (queue.length === 0) return false;
    if (playType === Play.NOW) beginQueueSession('radio', artist.name);
    player.addToQueueByData(queue, playType);
    return true;
};

/** "Your mix": the seedless station, from the hub's Navidrome user's own most-played. */
export const playYourMix = async (args: {
    character?: StationCharacterId;
    player: Pick<PlayerContext, 'addToQueueByData'>;
    serverId: string;
    sessionName: string;
}): Promise<boolean> => playStationRadio({ ...args, leading: [], seed: { kind: 'yourMix' } });
