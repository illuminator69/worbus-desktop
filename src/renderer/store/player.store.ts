import merge from 'lodash/merge';
import { nanoid } from 'nanoid';
import { useMemo } from 'react';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { eventEmitter } from '/@/renderer/events/event-emitter';
import { keepCurrentThen } from '/@/renderer/features/player/station/keep-current'; // navi-connect (B-175)
import { useRadioStore as useRadioPlayerStore } from '/@/renderer/features/radio/hooks/use-radio-player';
import { createSelectors } from '/@/renderer/lib/zustand';
import {
    isPermutation,
    orderAfterEdit,
    orderWithFirst,
    playingQueueIndex,
    playOrder,
    playPosition,
    positionAfterEdit,
} from '/@/renderer/store/play-order';
import { useSettingsStore } from '/@/renderer/store/settings.store';
import {
    setTimestamp as setTimestampStore,
    useTimestampStoreBase,
} from '/@/renderer/store/timestamp.store';
import { migratePlayerStorePersist, playerStoreStorage } from '/@/renderer/store/utils';
import { shuffleInPlace } from '/@/renderer/utils/shuffle';
import { PlayerData, QueueData, QueueSong, Song } from '/@/shared/types/domain-types';
import {
    CrossfadeStyle,
    Play,
    PlayerRepeat,
    PlayerShuffle,
    PlayerStatus,
    PlayerStyle,
} from '/@/shared/types/types';

export interface PlayerState extends Actions, State {}

/**
 * W1: what a hub that speaks `playOrder` says the play order is, in the frame that carries the
 * queue it indexes (`do:load`, `do:queueChanged`): adopted verbatim when it is a permutation of
 * that queue's rows. DESIGN-w1-play-order-2026-11-10.md §1.
 */
export interface PlayOrderAdopt {
    order: null | number[];
    shuffle: boolean;
}

export type QueueGroupingProperty = keyof QueueSong;

interface Actions {
    addToQueueByType: (items: Song[], playType: Play, playSongId?: string) => void;
    addToQueueByUniqueId: (
        items: Song[],
        uniqueId: string,
        edge: 'bottom' | 'top',
        playSongId?: string,
    ) => void;
    clearQueue: () => void;
    clearSelected: (items: QueueSong[]) => void;
    decreaseVolume: (value: number) => void;
    getCurrentSong: () => QueueSong | undefined;
    getPlayerData: () => PlayerData;
    getQueue: (groupBy?: QueueGroupingProperty) => GroupedQueue;
    getQueueOrder: () => GroupedQueue;
    increaseVolume: (value: number) => void;
    isFirstTrackInQueue: () => boolean;
    isLastTrackInQueue: () => boolean;
    // navi-connect (B-175): a radio from the playing song keeps that row playing where it is
    // and replaces only what follows it with `items` (the station's songs, without the seed).
    // False, and nothing changes, when the current row is no longer `expectedSongId`.
    keepCurrentAndReplaceRest: (expectedSongId: string, items: Song[]) => boolean;
    mediaAutoNext: () => PlayerData;
    mediaNext: (toNextAlbum: boolean) => void;
    mediaPause: () => void;
    mediaPlay: (id?: string) => void;
    mediaPlayByIndex: (index: number) => void;
    mediaPrevious: (toPreviousAlbum: boolean) => void;
    mediaSeekToTimestamp: (timestamp: number) => void;
    mediaSkipBackward: (offset?: number) => void;
    mediaSkipForward: (offset?: number) => void;
    mediaStop: (options?: { reset?: boolean }) => void;
    mediaToggleMute: () => void;
    mediaTogglePlayPause: () => void;
    moveSelectedTo: (items: QueueSong[], uniqueId: string, edge: 'bottom' | 'top') => void;
    moveSelectedToBottom: (items: QueueSong[]) => void;
    moveSelectedToNext: (items: QueueSong[]) => void;
    moveSelectedToTop: (items: QueueSong[]) => void;
    // navi-connect: apply a queue edit made ELSEWHERE (the hub's `do:queueChanged`)
    // without disturbing playback — see the implementation for why setQueue can't.
    // W1: `index` is a ROW of `items`; `adopt` is the play order a playOrder hub sent with it.
    reconcileQueue: (items: Song[], index: number, adopt?: PlayOrderAdopt) => void;
    setCrossfadeDuration: (duration: number) => void;
    setCrossfadeStyle: (style: CrossfadeStyle) => void;
    setPauseOnNextSongEnd: (value: boolean) => void;
    // navi-connect: `play` (default true) exists so a queue can be LOADED without ever
    // entering PLAYING. Loading playing-then-pausing starts the engine asynchronously, and
    // the pause can land before that play does — leaving audio running under a bar that
    // reads "paused", with no way back because the engines only act on status *changes*.
    // W1: `index` is a ROW of `data`; `adopt` is the play order a playOrder hub sent with it.
    setQueue: (
        data: Song[],
        index?: number,
        position?: number,
        play?: boolean,
        adopt?: PlayOrderAdopt,
    ) => void;
    setRepeat: (repeat: PlayerRepeat) => void;
    // W1: `order`, a permutation of the rows, is adopted as the play order (a hub's
    // do:setShuffle); without one, shuffle on puts the playing row first.
    setShuffle: (shuffle: PlayerShuffle, order?: null | number[]) => void;
    setSpeed: (speed: number) => void;
    setTransitionType: (transitionType: PlayerStyle) => void;
    setVolume: (volume: number) => void;
    shuffle: () => void;
    shuffleAll: () => void;
    shuffleSelected: (items: QueueSong[]) => void;
    toggleRepeat: () => void;
    toggleShuffle: () => void;
}

/** W1: the play order as a queue edit found it, for `followEdit`. */
interface EditBase {
    ids: string[];
    order: number[];
    position: number;
    shuffled: boolean;
}

interface GroupedQueue {
    groups: { count: number; name: string }[];
    items: QueueSong[];
}

interface State {
    hydrated: boolean;
    // Runtime-only: true once the mpv engine has finished initializing.
    // Top-level keys are not persisted (see partialize), same as `hydrated`.
    mpvInitialized: boolean;
    player: {
        crossfadeDuration: number;
        crossfadeStyle: CrossfadeStyle;
        index: number;
        muted: boolean;
        pauseOnNextSongEnd: boolean;
        playerNum: 1 | 2;
        repeat: PlayerRepeat;
        seekToTimestamp: string;
        shuffle: PlayerShuffle;
        speed: number;
        status: PlayerStatus;
        transitionType: PlayerStyle;
        volume: number;
    };
    queue: QueueData;
}

// Calculates the next song based on repeat mode and current position
export function calculateNextSong(
    currentIndex: number,
    queueItems: QueueSong[],
    repeat: PlayerRepeat,
): QueueSong | undefined {
    if (queueItems.length === 0) {
        return undefined;
    }

    if (repeat === PlayerRepeat.ONE) {
        // When repeating one, next song is the same as current
        return queueItems[currentIndex];
    } else if (repeat === PlayerRepeat.ALL) {
        // When repeating all, next song wraps to first if at the end
        const isLastTrack = currentIndex === queueItems.length - 1;
        if (isLastTrack) {
            return queueItems[0];
        } else {
            return queueItems[currentIndex + 1];
        }
    } else {
        // When repeat is none, next song is undefined if at the end
        return queueItems[currentIndex + 1];
    }
}

export function getDualPlayerSongs(
    playerNum: 1 | 2,
    currentSong: QueueSong | undefined,
    nextSong: QueueSong | undefined,
    repeat: PlayerRepeat,
): { player1: QueueSong | undefined; player2: QueueSong | undefined } {
    if (repeat === PlayerRepeat.ONE) {
        return {
            player1: playerNum === 1 ? currentSong : undefined,
            player2: playerNum === 2 ? currentSong : undefined,
        };
    }

    return {
        player1: playerNum === 1 ? currentSong : nextSong,
        player2: playerNum === 2 ? currentSong : nextSong,
    };
}

// Helper function to check if shuffle is enabled
export function isShuffleEnabled(state: {
    player: { shuffle: PlayerShuffle };
    queue: { shuffled: number[] };
}): boolean {
    return state.player.shuffle === PlayerShuffle.TRACK && state.queue.shuffled.length > 0;
}

// Helper function to map shuffled position to actual queue position
export function mapShuffledToQueueIndex(shuffledIndex: number, shuffled: number[]): number {
    if (shuffledIndex >= 0 && shuffledIndex < shuffled.length) {
        return shuffled[shuffledIndex];
    }
    return shuffledIndex;
}

// We need to use a unique id so that the equalityFn can work if attempting to set the same timestamp
export function uniqueSeekToTimestamp(timestamp: number) {
    return `${timestamp}-${nanoid()}`;
}

// Calculates the next index based on repeat mode and current position
function calculateNextIndex(
    currentIndex: number,
    queueLength: number,
    repeat: PlayerRepeat,
): { nextIndex: number; shouldStop: boolean } {
    const isLastTrack = currentIndex === queueLength - 1;

    if (repeat === PlayerRepeat.ONE) {
        // Repeat one: stay on the same track
        return { nextIndex: currentIndex, shouldStop: false };
    } else if (repeat === PlayerRepeat.ALL) {
        // Repeat all: loop to first track if at the end
        if (isLastTrack) {
            return { nextIndex: 0, shouldStop: false };
        } else {
            return { nextIndex: currentIndex + 1, shouldStop: false };
        }
    } else {
        // Repeat none: move to next track, or loop back and stop if at the end
        if (isLastTrack) {
            return { nextIndex: 0, shouldStop: true };
        } else {
            return { nextIndex: currentIndex + 1, shouldStop: false };
        }
    }
}

function clearActiveRadio(): void {
    const radioState = useRadioPlayerStore.getState();
    if (radioState.currentStreamUrl) {
        radioState.actions.clear();
    }
}

function editBase(state: any): EditBase {
    return {
        ids: [...state.queue.default],
        order: playOrder(state),
        position: playPosition(state),
        shuffled: state.player.shuffle === PlayerShuffle.TRACK,
    };
}

function emitPlayerPlayEvent(
    targetSongUniqueId: string | undefined,
    set: (fn: (state: PlayerState) => void) => void,
    get: () => PlayerState,
): void {
    // Clear radio before status changes so onPlayerStatus does not restart the stream.
    clearActiveRadio();

    // If playSongId is provided, find the song and start playback on it
    if (targetSongUniqueId) {
        let playIndex: number | undefined;
        set((state) => {
            const queue = state.getQueue();
            const queueIndex = queue.items.findIndex(
                (item) => item._uniqueId === targetSongUniqueId,
            );

            if (queueIndex !== -1) {
                if (
                    state.player.shuffle === PlayerShuffle.TRACK &&
                    state.queue.shuffled.length > 0
                ) {
                    // Find the shuffled position for this queue index
                    const shuffledPosition = state.queue.shuffled.findIndex(
                        (idx) => idx === queueIndex,
                    );
                    if (shuffledPosition !== -1) {
                        state.player.index = shuffledPosition;
                        playIndex = shuffledPosition;
                    } else {
                        state.player.index = queueIndex;
                        playIndex = queueIndex;
                    }
                } else {
                    state.player.index = queueIndex;
                    playIndex = queueIndex;
                }
                state.player.status = PlayerStatus.PLAYING;
                setTimestampStore(0);
            }
        });

        // Emit PLAYER_PLAY event if playback was started
        if (playIndex !== undefined) {
            eventEmitter.emit('PLAYER_PLAY', {
                id: targetSongUniqueId,
                index: playIndex,
            });
        }
    } else {
        // Otherwise, emit PLAYER_PLAY event for current song if available
        const currentState = get();
        const currentIndex = currentState.player.index;
        // The playing song, not the queue row at the play position (they differ under shuffle).
        const currentSong = currentState.getCurrentSong();

        if (currentSong && currentIndex !== undefined && currentIndex >= 0) {
            eventEmitter.emit('PLAYER_PLAY', {
                id: currentSong._uniqueId,
                index: currentIndex,
            });
        }
    }
}

function emitPlayerStop(get: () => PlayerState, reset: boolean): void {
    const currentState = get();
    const currentIndex = currentState.player.index;
    const currentSong = currentState.getCurrentSong();

    eventEmitter.emit('PLAYER_STOP', {
        id: currentSong?._uniqueId,
        index: currentIndex !== undefined && currentIndex >= 0 ? currentIndex : undefined,
        reset,
    });
}

// Helper function to find shuffled position for a given queue index
function findShuffledPositionForQueueIndex(
    queueIndex: number,
    shuffled: number[],
): number | undefined {
    const shuffledPosition = shuffled.findIndex((idx) => idx === queueIndex);
    return shuffledPosition !== -1 ? shuffledPosition : undefined;
}

/**
 * W1: after an edit to `queue.default`, re-derive the play order by row identity and the playing
 * position (play-order.ts): under shuffle new rows go where the rule puts them and every other
 * row keeps its place in play order; removing the playing row plays the row after it.
 * `playNextAfter`: the edit was a Play next after that row (`_uniqueId`).
 */
function followEdit(state: any, base: EditBase, playNextAfter?: string): void {
    const ids: string[] = state.queue.default;
    const order = base.shuffled
        ? orderAfterEdit(base.ids, base.order, ids, playNextAfter)
        : ids.map((_, row) => row);
    state.queue.shuffled = base.shuffled ? order : [];
    if (base.position >= 0) {
        state.player.index = positionAfterEdit(base.ids, base.order, base.position, ids, order);
    }
}

/**
 * W1: put the playhead on `row` of the queue just written to `queue.default`. The play order is
 * the one a playOrder hub sent (`adopt`, when it is a permutation of the rows), else under
 * shuffle `fallback()`; `adopt.shuffle` also sets the shuffle mode.
 */
function placeOnRow(
    state: any,
    row: number,
    adopt: PlayOrderAdopt | undefined,
    fallback: () => number[],
): void {
    const rows: number = state.queue.default.length;
    if (adopt?.shuffle) {
        state.player.shuffle = PlayerShuffle.TRACK;
    } else if (adopt && state.player.shuffle === PlayerShuffle.TRACK) {
        state.player.shuffle = PlayerShuffle.NONE;
    }
    if (state.player.shuffle === PlayerShuffle.TRACK && rows > 0) {
        const order =
            adopt?.shuffle && isPermutation(adopt.order, rows) ? [...adopt.order] : fallback();
        state.queue.shuffled = order;
        state.player.index = Math.max(0, order.indexOf(row));
    } else {
        state.queue.shuffled = [];
        state.player.index = row;
    }
}

/** W1: shuffle on, or a re-shuffle: `row` (the playing one) first, the rest at random. */
function reshuffle(state: any, row: number): void {
    const rows = state.queue.default.length;
    state.queue.shuffled = orderWithFirst(rows, row, shuffleInPlace);
    if (row >= 0 && row < rows) state.player.index = 0;
}

const initialState: State = {
    hydrated: false,
    mpvInitialized: false,
    player: {
        crossfadeDuration: 5,
        crossfadeStyle: CrossfadeStyle.EQUAL_POWER,
        index: -1,
        muted: false,
        pauseOnNextSongEnd: false,
        playerNum: 1,
        repeat: PlayerRepeat.NONE,
        seekToTimestamp: uniqueSeekToTimestamp(0),
        shuffle: PlayerShuffle.NONE,
        speed: 1,
        status: PlayerStatus.PAUSED,
        transitionType: PlayerStyle.GAPLESS,
        volume: 30,
    },
    queue: {
        default: [],
        shuffled: [],
        songs: {},
    },
};

export const usePlayerStoreBase = createWithEqualityFn<PlayerState>()(
    persist(
        subscribeWithSelector(
            immer((set, get) => ({
                addToQueueByType: (items, playType, playSongId) => {
                    const newItems = items.map(toQueueSong);
                    const newUniqueIds = newItems.map((item) => item._uniqueId);

                    // Find the target song's uniqueId if playSongId is provided
                    const targetSongUniqueId = playSongId
                        ? newItems.find((item) => item.id === playSongId)?._uniqueId
                        : undefined;

                    switch (playType) {
                        case Play.LAST: {
                            set((state) => {
                                const base = editBase(state);
                                newItems.forEach((item) => {
                                    state.queue.songs[item._uniqueId] = item;
                                });

                                // W1: at the end of the play order too, in the order given.
                                state.queue.default = [...state.queue.default, ...newUniqueIds];
                                followEdit(state, base);
                            });
                            break;
                        }
                        case Play.LAST_SHUFFLE: {
                            set((state) => {
                                const base = editBase(state);
                                newItems.forEach((item) => {
                                    state.queue.songs[item._uniqueId] = item;
                                });

                                // Shuffle the new items before appending; then as Play.LAST.
                                const shuffledIds = shuffleInPlace([...newUniqueIds]);
                                state.queue.default = [...state.queue.default, ...shuffledIds];
                                followEdit(state, base);
                            });
                            break;
                        }
                        case Play.NEXT: {
                            set((state) => {
                                const base = editBase(state);
                                const playingRow = playingQueueIndex(state);
                                newItems.forEach((item) => {
                                    state.queue.songs[item._uniqueId] = item;
                                });

                                // W1: right after the playing row, in the queue and in the play
                                // order, in the order given.
                                const insertPosition = playingRow + 1;
                                state.queue.default = [
                                    ...state.queue.default.slice(0, insertPosition),
                                    ...newUniqueIds,
                                    ...state.queue.default.slice(insertPosition),
                                ];
                                followEdit(state, base, base.ids[playingRow]);
                            });
                            break;
                        }
                        case Play.NEXT_SHUFFLE: {
                            set((state) => {
                                const base = editBase(state);
                                const playingRow = playingQueueIndex(state);
                                newItems.forEach((item) => {
                                    state.queue.songs[item._uniqueId] = item;
                                });

                                // Shuffle the new items before inserting; then as Play.NEXT.
                                const shuffledIds = shuffleInPlace([...newUniqueIds]);
                                const insertPosition = playingRow + 1;
                                state.queue.default = [
                                    ...state.queue.default.slice(0, insertPosition),
                                    ...shuffledIds,
                                    ...state.queue.default.slice(insertPosition),
                                ];
                                followEdit(state, base, base.ids[playingRow]);
                            });
                            break;
                        }
                        case Play.NOW: {
                            clearActiveRadio();

                            set((state) => {
                                newItems.forEach((item) => {
                                    state.queue.songs[item._uniqueId] = item;
                                });

                                state.queue.default = [];
                                state.player.index = 0;
                                state.player.status = PlayerStatus.PLAYING;
                                state.player.playerNum = 1;
                                setTimestampStore(0);
                                state.queue.default = newUniqueIds;

                                if (state.player.shuffle === PlayerShuffle.TRACK) {
                                    // A new queue under shuffle: the song asked for first, the
                                    // rest at random (all at random when none was named).
                                    state.queue.shuffled = orderWithFirst(
                                        newUniqueIds.length,
                                        targetSongUniqueId
                                            ? newUniqueIds.indexOf(targetSongUniqueId)
                                            : -1,
                                        shuffleInPlace,
                                    );
                                }
                            });

                            emitPlayerPlayEvent(targetSongUniqueId, set, get);
                            break;
                        }
                        case Play.SHUFFLE: {
                            clearActiveRadio();

                            set((state) => {
                                newItems.forEach((item) => {
                                    state.queue.songs[item._uniqueId] = item;
                                });

                                // Shuffle the new items before adding to queue
                                const shuffledIds = shuffleInPlace([...newUniqueIds]);

                                state.queue.default = [];
                                state.player.index = 0;
                                state.player.status = PlayerStatus.PLAYING;
                                state.player.playerNum = 1;
                                setTimestampStore(0);
                                state.queue.default = shuffledIds;

                                // Always maintain shuffled array when using Play.SHUFFLE
                                state.queue.shuffled = orderWithFirst(
                                    shuffledIds.length,
                                    -1,
                                    shuffleInPlace,
                                );
                            });

                            emitPlayerPlayEvent(targetSongUniqueId, set, get);
                            break;
                        }
                    }
                },
                addToQueueByUniqueId: (items, uniqueId, edge, playSongId) => {
                    const newItems = items.map(toQueueSong);
                    const newUniqueIds = newItems.map((item) => item._uniqueId);

                    // Find the target song's uniqueId if playSongId is provided
                    const targetSongUniqueId = playSongId
                        ? newItems.find((item) => item.id === playSongId)?._uniqueId
                        : undefined;

                    set((state) => {
                        const base = editBase(state);
                        // Add new songs to songs object
                        newItems.forEach((item) => {
                            state.queue.songs[item._uniqueId] = item;
                        });

                        const index = state.queue.default.findIndex((id) => id === uniqueId);

                        const insertIndex = Math.max(0, edge === 'top' ? index : index + 1);

                        state.queue.default = [
                            ...state.queue.default.slice(0, insertIndex),
                            ...newUniqueIds,
                            ...state.queue.default.slice(insertIndex),
                        ];

                        // W1: under shuffle, right after the queue predecessor's play position.
                        followEdit(state, base);
                    });

                    // If playSongId is provided, find the song and start playback on it
                    if (targetSongUniqueId) {
                        clearActiveRadio();

                        let playIndex: number | undefined;
                        set((state) => {
                            const queue = state.getQueue();
                            const queueIndex = queue.items.findIndex(
                                (item) => item._uniqueId === targetSongUniqueId,
                            );

                            if (queueIndex !== -1) {
                                if (
                                    state.player.shuffle === PlayerShuffle.TRACK &&
                                    state.queue.shuffled.length > 0
                                ) {
                                    // Find the shuffled position for this queue index
                                    const shuffledPosition = state.queue.shuffled.findIndex(
                                        (idx) => idx === queueIndex,
                                    );
                                    if (shuffledPosition !== -1) {
                                        state.player.index = shuffledPosition;
                                        playIndex = shuffledPosition;
                                    } else {
                                        state.player.index = queueIndex;
                                        playIndex = queueIndex;
                                    }
                                } else {
                                    state.player.index = queueIndex;
                                    playIndex = queueIndex;
                                }
                                state.player.status = PlayerStatus.PLAYING;
                                setTimestampStore(0);
                            }
                        });

                        // Emit PLAYER_PLAY event if playback was started
                        if (playIndex !== undefined) {
                            eventEmitter.emit('PLAYER_PLAY', {
                                id: targetSongUniqueId,
                                index: playIndex,
                            });
                        }
                    }
                },
                clearQueue: () => {
                    set((state) => {
                        state.player.index = -1;
                        state.queue.default = [];
                        state.queue.shuffled = [];
                        state.queue.songs = {};
                    });
                },
                clearSelected: (items: QueueSong[]) => {
                    set((state) => {
                        const base = editBase(state);
                        const uniqueIds = new Set(items.map((item) => item._uniqueId));

                        state.queue.default = state.queue.default.filter(
                            (id) => !uniqueIds.has(id),
                        );

                        // W1: the rest keep their play order; removing the playing row plays
                        // the row after it in play order.
                        followEdit(state, base);

                        cleanupOrphanedSongs(state);
                    });
                },
                decreaseVolume: (value: number) => {
                    set((state) => {
                        state.player.volume = Math.max(0, state.player.volume - value);
                    });
                },
                getCurrentSong: () => {
                    const state = get();
                    const queue = state.getQueue();
                    let index = state.player.index;

                    // If shuffle is enabled, map shuffled position to actual queue position
                    if (isShuffleEnabled(state)) {
                        index = mapShuffledToQueueIndex(index, state.queue.shuffled);
                    }

                    return queue.items[index];
                },
                getPlayerData: () => {
                    const state = get();
                    const queue = state.getQueue();
                    const index = state.player.index;

                    // If shuffle is enabled, map shuffled position to actual queue position for display
                    let queueIndex = index;
                    if (isShuffleEnabled(state)) {
                        queueIndex = mapShuffledToQueueIndex(index, state.queue.shuffled);
                    }

                    const currentSong = queue.items[queueIndex];
                    const repeat = state.player.repeat;

                    // For previousSong calculation, we need to consider the shuffled order
                    let previousSong: QueueSong | undefined;
                    if (isShuffleEnabled(state)) {
                        // Calculate previous in shuffled order
                        const previousShuffledIndex = index - 1;
                        if (previousShuffledIndex >= 0) {
                            const previousQueueIndex = state.queue.shuffled[previousShuffledIndex];
                            previousSong = queue.items[previousQueueIndex];
                        } else if (repeat === PlayerRepeat.ALL) {
                            // Wrap to last in shuffled order
                            const lastShuffledIndex = state.queue.shuffled.length - 1;
                            const lastQueueIndex = state.queue.shuffled[lastShuffledIndex];
                            previousSong = queue.items[lastQueueIndex];
                        }
                    } else {
                        previousSong = queueIndex > 0 ? queue.items[queueIndex - 1] : undefined;
                    }

                    // For nextSong calculation, we need to consider the shuffled order
                    let nextSong: QueueSong | undefined;
                    if (isShuffleEnabled(state) && repeat !== PlayerRepeat.ONE) {
                        // Calculate next in shuffled order
                        const nextShuffledIndex = index + 1;
                        if (nextShuffledIndex < state.queue.shuffled.length) {
                            const nextQueueIndex = state.queue.shuffled[nextShuffledIndex];
                            nextSong = queue.items[nextQueueIndex];
                        } else if (repeat === PlayerRepeat.ALL) {
                            // Wrap to first in shuffled order
                            const firstQueueIndex = state.queue.shuffled[0];
                            nextSong = queue.items[firstQueueIndex];
                        }
                    } else {
                        nextSong = calculateNextSong(queueIndex, queue.items, repeat);
                    }

                    const { player1, player2 } = getDualPlayerSongs(
                        state.player.playerNum,
                        currentSong,
                        nextSong,
                        repeat,
                    );

                    return {
                        currentSong,
                        index: queueIndex, // Return the actual queue position for display
                        nextSong,
                        num: state.player.playerNum,
                        player1,
                        player2,
                        previousSong,
                        queueLength: state.queue.default.length,
                        status: state.player.status,
                    };
                },
                getQueue: (groupBy?: QueueGroupingProperty) => {
                    const queue = get().getQueueOrder();

                    if (!groupBy) {
                        return queue;
                    }

                    // Track groups in order of appearance
                    const groups: { count: number; name: string }[] = [];
                    const seenGroups = new Set<string>();

                    // Process items and build groups in order
                    queue.items.forEach((item) => {
                        const groupValue = String(item[groupBy] || 'Unknown');

                        if (!seenGroups.has(groupValue)) {
                            seenGroups.add(groupValue);
                            groups.push({ count: 1, name: groupValue });
                        } else {
                            // Find the last occurrence of this group value
                            const lastIndex = [...groups]
                                .reverse()
                                .findIndex((g) => g.name === groupValue);
                            if (lastIndex === -1) return;

                            // If the previous group is different, create a new group
                            const previousGroup = groups[groups.length - 1];
                            if (previousGroup.name !== groupValue) {
                                groups.push({ count: 1, name: groupValue });
                            } else {
                                // Increment the count of the last matching group
                                groups[groups.length - 1].count++;
                            }
                        }
                    });

                    return { groups, items: queue.items };
                },
                getQueueOrder: () => {
                    const state = get();
                    const songs = state.queue.songs;
                    const defaultIds = state.queue.default;
                    const defaultQueue: QueueSong[] = [];

                    for (const id of defaultIds) {
                        const song = songs[id];
                        if (song) defaultQueue.push(song);
                    }

                    // Always return original order (shuffle only affects playback, not display)
                    return {
                        groups: [{ count: defaultQueue.length, name: 'All' }],
                        items: defaultQueue,
                    };
                },
                increaseVolume: (value: number) => {
                    set((state) => {
                        state.player.volume = Math.min(100, state.player.volume + value);
                    });
                },
                isFirstTrackInQueue: () => {
                    const state = get();
                    const currentIndex = state.player.index;
                    return currentIndex === 0;
                },
                isLastTrackInQueue: () => {
                    const state = get();
                    const queue = state.getQueueOrder();
                    const currentIndex = state.player.index;
                    return currentIndex === queue.items.length - 1;
                },
                // navi-connect (B-175)
                keepCurrentAndReplaceRest: (expectedSongId, items) => {
                    const snapshot = get();
                    const queueIndex = isShuffleEnabled(snapshot)
                        ? mapShuffledToQueueIndex(snapshot.player.index, snapshot.queue.shuffled)
                        : snapshot.player.index;
                    const currentUniqueId = snapshot.queue.default[queueIndex];
                    const currentRow = currentUniqueId
                        ? snapshot.queue.songs[currentUniqueId]
                        : undefined;
                    const newItems = items.map(toQueueSong);

                    // Null when the current row is no longer the expected song: nothing changes.
                    const next = keepCurrentThen(
                        currentRow && { songId: currentRow.id, uniqueId: currentUniqueId },
                        expectedSongId,
                        newItems.map((item) => item._uniqueId),
                        snapshot.player.shuffle === PlayerShuffle.TRACK
                            ? (indexes) => shuffleInPlace(indexes)
                            : null,
                    );
                    if (!next) return false;

                    clearActiveRadio();

                    set((state) => {
                        newItems.forEach((item) => {
                            state.queue.songs[item._uniqueId] = item;
                        });

                        state.queue.default = next.default;
                        state.queue.shuffled = next.shuffled;
                        state.player.index = next.index;
                        // A radio is music the user asked for: a paused song resumes from
                        // where it is (the timestamp is left alone), as Play.NOW plays.
                        state.player.status = PlayerStatus.PLAYING;

                        cleanupOrphanedSongs(state);
                    });
                    return true;
                },
                mediaAutoNext: () => {
                    const stateSnapshot = get();
                    const currentIndex = stateSnapshot.player.index;
                    const player = stateSnapshot.player;
                    const repeat = player.repeat;
                    const queue = stateSnapshot.getQueueOrder();
                    const isShuffle = isShuffleEnabled(stateSnapshot);

                    const playbackLength = isShuffle
                        ? stateSnapshot.queue.shuffled.length
                        : queue.items.length;

                    const { nextIndex: nextPlaybackIndex, shouldStop } = calculateNextIndex(
                        currentIndex,
                        playbackLength,
                        repeat,
                    );

                    const isRepeatOneSameTrack =
                        repeat === PlayerRepeat.ONE && nextPlaybackIndex === currentIndex;
                    // Dual web players alternate for gapless/crossfade between tracks. Repeat-one
                    // replays the same track — keep playerNum so Chromium stays bound to the same
                    // <audio> element and hardware media keys keep working.
                    const newPlayerNum = isRepeatOneSameTrack
                        ? player.playerNum
                        : player.playerNum === 1
                          ? 2
                          : 1;
                    const pauseOnNext = player.pauseOnNextSongEnd;
                    const newStatus = shouldStop
                        ? PlayerStatus.STOPPED
                        : pauseOnNext
                          ? PlayerStatus.PAUSED
                          : PlayerStatus.PLAYING;
                    const shouldKeepCurrentPlayer = newStatus !== PlayerStatus.PLAYING;
                    const shouldSwapPlayer = !isRepeatOneSameTrack && !shouldKeepCurrentPlayer;

                    set((state) => {
                        state.player.index = nextPlaybackIndex;
                        state.player.playerNum = shouldSwapPlayer ? newPlayerNum : player.playerNum;
                        setTimestampStore(0);
                        state.player.status = newStatus;

                        if (shouldStop) {
                            state.player.seekToTimestamp = uniqueSeekToTimestamp(0);
                        }

                        if (pauseOnNext) {
                            state.player.pauseOnNextSongEnd = false;
                        }
                    });

                    if (shouldStop) {
                        emitPlayerStop(get, true);
                    }

                    if (repeat === PlayerRepeat.ONE && nextPlaybackIndex === currentIndex) {
                        eventEmitter.emit('PLAYER_REPEATED', {
                            index: nextPlaybackIndex,
                        });
                    }

                    // Compute current/next/previous using the same shuffle-aware mapping as getPlayerData().
                    let currentQueueIndex = nextPlaybackIndex;
                    if (isShuffle) {
                        currentQueueIndex = mapShuffledToQueueIndex(
                            nextPlaybackIndex,
                            stateSnapshot.queue.shuffled,
                        );
                    }

                    const currentSong = queue.items[currentQueueIndex];

                    let nextSong: QueueSong | undefined;
                    if (isShuffle && repeat !== PlayerRepeat.ONE) {
                        const nextShuffledIndex = nextPlaybackIndex + 1;
                        if (nextShuffledIndex < stateSnapshot.queue.shuffled.length) {
                            const nextQueueIndex = stateSnapshot.queue.shuffled[nextShuffledIndex];
                            nextSong = queue.items[nextQueueIndex];
                        } else if (repeat === PlayerRepeat.ALL) {
                            const firstQueueIndex = stateSnapshot.queue.shuffled[0];
                            nextSong = queue.items[firstQueueIndex];
                        }
                    } else {
                        nextSong = calculateNextSong(currentQueueIndex, queue.items, repeat);
                    }

                    let previousSong: QueueSong | undefined;
                    if (isShuffle) {
                        const prevShuffledIndex = nextPlaybackIndex - 1;
                        if (prevShuffledIndex >= 0) {
                            const prevQueueIndex = stateSnapshot.queue.shuffled[prevShuffledIndex];
                            previousSong = queue.items[prevQueueIndex];
                        } else if (repeat === PlayerRepeat.ALL) {
                            const lastShuffledIndex = stateSnapshot.queue.shuffled.length - 1;
                            const lastQueueIndex = stateSnapshot.queue.shuffled[lastShuffledIndex];
                            previousSong = queue.items[lastQueueIndex];
                        }
                    } else {
                        previousSong =
                            currentQueueIndex > 0 ? queue.items[currentQueueIndex - 1] : undefined;
                    }

                    const { player1, player2 } = getDualPlayerSongs(
                        shouldSwapPlayer ? newPlayerNum : player.playerNum,
                        currentSong,
                        nextSong,
                        repeat,
                    );

                    return {
                        currentSong,
                        index: currentQueueIndex,
                        nextSong,
                        num: shouldSwapPlayer ? newPlayerNum : player.playerNum,
                        player1,
                        player2,
                        previousSong,
                        queueLength: queue.items.length,
                        status: newStatus,
                    };
                },
                mediaNext: (toNextAlbum) => {
                    const state = get();
                    const currentIndex = state.player.index;
                    const player = state.player;
                    const repeat = player.repeat;
                    const isShuffle = isShuffleEnabled(state);
                    const queue = state.getQueueOrder();
                    const playbackLength = isShuffle
                        ? state.queue.shuffled.length
                        : queue.items.length;

                    const isStopped = state.player.status === PlayerStatus.STOPPED;

                    if (repeat === PlayerRepeat.ONE) {
                        // Manual next while repeat-one is active should still advance in the queue.
                        const nextIndex = Math.min(playbackLength - 1, currentIndex + 1);

                        set((state) => {
                            state.player.index = nextIndex;
                            state.player.playerNum = 1;
                            setTimestampStore(0);

                            if (isStopped) {
                                state.player.status = PlayerStatus.PLAYING;
                            }
                        });

                        eventEmitter.emit('MEDIA_NEXT', {
                            currentIndex,
                            nextIndex,
                        });
                        return;
                    }

                    const nextIndexProps = calculateNextIndex(currentIndex, playbackLength, repeat);
                    let { nextIndex } = nextIndexProps;
                    const { shouldStop } = nextIndexProps;

                    if (toNextAlbum && !shouldStop) {
                        const currentItem = queue.items[currentIndex];
                        const [start, end] = findLastAlbumRange(queue.items);
                        const isOnLastAlbum = start <= currentIndex && currentIndex <= end;
                        if (isOnLastAlbum) {
                            const nextIndexWithNextAlbum = queue.items.findIndex(
                                (i) => i.albumId !== currentItem.albumId,
                            );

                            nextIndex = nextIndexWithNextAlbum;
                        } else {
                            const queueStartingFromCurrent = queue.items.slice(currentIndex);
                            const nextIndexWithNextAlbum = queueStartingFromCurrent.findIndex(
                                (i) => i.albumId !== currentItem.albumId,
                            );
                            nextIndex =
                                nextIndexWithNextAlbum +
                                (queue.items.length - queueStartingFromCurrent.length);
                        }
                    }

                    if (shouldStop) {
                        set((state) => {
                            state.player.index = nextIndex;
                            state.player.status = PlayerStatus.STOPPED;
                            state.player.playerNum = 1;
                            setTimestampStore(0);
                            state.player.seekToTimestamp = uniqueSeekToTimestamp(0);
                        });
                        emitPlayerStop(get, true);
                        return;
                    }

                    set((state) => {
                        state.player.index = nextIndex;
                        state.player.playerNum = 1;
                        setTimestampStore(0);

                        if (isStopped) {
                            state.player.status = PlayerStatus.PLAYING;
                        }
                    });

                    eventEmitter.emit('MEDIA_NEXT', {
                        currentIndex,
                        nextIndex,
                    });
                },
                mediaPause: () => {
                    set((state) => {
                        state.player.status = PlayerStatus.PAUSED;
                    });
                },
                mediaPlay: (id?: string) => {
                    let playIndex: number | undefined;

                    // Playing a specific queue song should dismiss radio first.
                    if (id) {
                        clearActiveRadio();
                    }

                    set((state) => {
                        if (id) {
                            const queue = state.getQueue();

                            // Find the song in the original queue
                            const queueIndex = queue.items.findIndex(
                                (item) => item._uniqueId === id,
                            );

                            if (queueIndex !== -1) {
                                if (
                                    state.player.shuffle === PlayerShuffle.TRACK &&
                                    state.queue.shuffled.length > 0
                                ) {
                                    // Find the shuffled position for this queue index
                                    const shuffledPosition = state.queue.shuffled.findIndex(
                                        (idx) => idx === queueIndex,
                                    );
                                    if (shuffledPosition !== -1) {
                                        state.player.index = shuffledPosition;
                                        playIndex = shuffledPosition;
                                    } else {
                                        state.player.index = queueIndex;
                                        playIndex = queueIndex;
                                    }
                                } else {
                                    state.player.index = queueIndex;
                                    playIndex = queueIndex;
                                }
                                setTimestampStore(0);
                            }
                        }

                        state.player.status = PlayerStatus.PLAYING;
                    });

                    if (id && playIndex !== undefined) {
                        eventEmitter.emit('PLAYER_PLAY', {
                            id,
                            index: playIndex,
                        });
                    }
                },
                mediaPlayByIndex: (index: number) => {
                    let playIndex: number | undefined;
                    let songId: string | undefined;

                    clearActiveRadio();

                    set((state) => {
                        const queue = state.getQueue();

                        if (index === -1 || index >= queue.items.length) {
                            state.player.status = PlayerStatus.PAUSED;
                            return;
                        }

                        // Get the song's unique ID from the queue
                        const song = queue.items[index];
                        if (song) {
                            songId = song._uniqueId;
                        }

                        // index is the position in the original queue
                        if (isShuffleEnabled(state)) {
                            // Find the shuffled position for this queue index
                            const shuffledPosition = findShuffledPositionForQueueIndex(
                                index,
                                state.queue.shuffled,
                            );
                            playIndex = shuffledPosition !== undefined ? shuffledPosition : index;
                            state.player.index = playIndex;
                        } else {
                            playIndex = index;
                            state.player.index = index;
                        }
                        setTimestampStore(0);

                        state.player.status = PlayerStatus.PLAYING;
                    });

                    if (songId && playIndex !== undefined) {
                        eventEmitter.emit('PLAYER_PLAY', {
                            id: songId,
                            index: playIndex,
                        });
                    }
                },
                mediaPrevious: (toPreviousAlbum) => {
                    const currentIndex = get().player.index;
                    const player = get().player;
                    const queue = get().getQueueOrder();
                    const currentTimestamp = useTimestampStoreBase.getState().timestamp;
                    const isFirstTrack = currentIndex === 0;

                    // If timestamp is greater than 10 seconds, restart current song
                    if (currentTimestamp > 10) {
                        set((state) => {
                            state.player.seekToTimestamp = uniqueSeekToTimestamp(0);
                        });
                        return;
                    }

                    let previousIndex: number;

                    if (player.repeat === PlayerRepeat.ALL && isFirstTrack) {
                        // Repeat all: wrap to last track when on first track
                        previousIndex = queue.items.length - 1;
                    } else if (player.repeat === PlayerRepeat.NONE && isFirstTrack) {
                        // Repeat none: stay on first track if already there
                        previousIndex = currentIndex;
                    } else if (toPreviousAlbum) {
                        previousIndex = Math.max(
                            0,
                            findIndexWithPreviousAlbum(queue.items, currentIndex),
                        );
                    } else {
                        // Otherwise, go to previous track
                        previousIndex = Math.max(0, currentIndex - 1);
                    }

                    // Same Chromium Media Session pitfall as mediaNext: a STOPPED→new-src
                    // transition without PLAYING drops OS media-key routing.
                    const resumeFromStopped = get().player.status === PlayerStatus.STOPPED;

                    set((state) => {
                        state.player.index = previousIndex;
                        state.player.playerNum = 1;
                        setTimestampStore(0);
                        if (resumeFromStopped) {
                            state.player.status = PlayerStatus.PLAYING;
                        }
                    });

                    eventEmitter.emit('MEDIA_PREV', {
                        currentIndex,
                        prevIndex: previousIndex,
                    });
                },
                mediaSeekToTimestamp: (timestamp: number) => {
                    // See mediaSkipBackward: update the timestamp store right away to
                    // avoid the stale-read left by the ~500ms engine poll.
                    setTimestampStore(timestamp, { seek: true }); // navi-connect (Q-051)
                    set((state) => {
                        state.player.seekToTimestamp = uniqueSeekToTimestamp(timestamp);
                    });
                },
                mediaSkipBackward: (offset?: number) => {
                    const offsetFromSettings =
                        useSettingsStore.getState().general.skipButtons.skipBackwardSeconds;
                    const timeToSkip = offset ?? offsetFromSettings ?? 5;
                    const currentTimestamp = useTimestampStoreBase.getState().timestamp;
                    const newTimestamp = Math.max(0, currentTimestamp - timeToSkip);

                    // Update the timestamp store right away so the UI and any
                    // subsequent seek compute from the new position instead of the
                    // stale value left by the ~500ms engine poll (otherwise mashing
                    // the seek keys repeatedly lands on the same time).
                    setTimestampStore(newTimestamp, { seek: true }); // navi-connect (Q-051)
                    set((state) => {
                        state.player.seekToTimestamp = uniqueSeekToTimestamp(newTimestamp);
                    });
                },
                mediaSkipForward: (offset?: number) => {
                    const duration = get().getCurrentSong()?.duration;
                    const offsetFromSettings =
                        useSettingsStore.getState().general.skipButtons.skipForwardSeconds;
                    const timeToSkip = offset ?? offsetFromSettings ?? 5;

                    if (!duration) {
                        return;
                    }

                    const currentTimestamp = useTimestampStoreBase.getState().timestamp;
                    const newTimestamp = Math.min(duration - 1, currentTimestamp + timeToSkip);

                    // See mediaSkipBackward: update the timestamp store right away to
                    // avoid the stale-read left by the ~500ms engine poll.
                    setTimestampStore(newTimestamp, { seek: true }); // navi-connect (Q-051)
                    set((state) => {
                        state.player.seekToTimestamp = uniqueSeekToTimestamp(newTimestamp);
                    });
                },
                mediaStop: (options?: { reset?: boolean }) => {
                    const reset = options?.reset !== false;
                    set((state) => {
                        state.player.status = PlayerStatus.STOPPED;
                        if (reset) {
                            setTimestampStore(0);
                            state.player.seekToTimestamp = uniqueSeekToTimestamp(0);
                        }
                    });

                    emitPlayerStop(get, reset);
                },
                mediaToggleMute: () => {
                    set((state) => {
                        state.player.muted = !state.player.muted;
                    });
                },
                mediaTogglePlayPause: () => {
                    // Restarting from STOPPED (e.g. end of queue) needs a full play
                    // event so engines like mpv can reload the current track — play()
                    // alone is a no-op when mpv's playlist-pos is -1.
                    const wasStopped = get().player.status === PlayerStatus.STOPPED;

                    set((state) => {
                        if (state.player.status === PlayerStatus.PLAYING) {
                            state.player.status = PlayerStatus.PAUSED;
                        } else {
                            state.player.status = PlayerStatus.PLAYING;
                        }
                    });

                    if (wasStopped) {
                        emitPlayerPlayEvent(undefined, set, get);
                    }
                },
                moveSelectedTo: (items: QueueSong[], uniqueId: string, edge: 'bottom' | 'top') => {
                    const itemUniqueIds = items.map((item) => item._uniqueId);

                    set((state) => {
                        const base = editBase(state);
                        const existingIds = new Set(Object.keys(state.queue.songs));

                        // Add new songs to songs object (avoiding duplicates)
                        items.forEach((item) => {
                            if (!existingIds.has(item._uniqueId)) {
                                state.queue.songs[item._uniqueId] = item;
                            }
                        });

                        // Find the index of the drop target
                        const index = state.queue.default.findIndex((id) => id === uniqueId);

                        // Get the new index based on the edge
                        const insertIndex = Math.max(0, edge === 'top' ? index : index + 1);

                        const idsBefore = state.queue.default
                            .slice(0, insertIndex)
                            .filter((id) => !itemUniqueIds.includes(id));

                        const idsAfter = state.queue.default
                            .slice(insertIndex)
                            .filter((id) => !itemUniqueIds.includes(id));

                        const newQueue = [...idsBefore, ...itemUniqueIds, ...idsAfter];

                        state.queue.default = newQueue;
                        followEdit(state, base);
                    });
                },
                moveSelectedToBottom: (items: QueueSong[]) => {
                    set((state) => {
                        const base = editBase(state);
                        const uniqueIds = items.map((item) => item._uniqueId);

                        // Add new songs to songs object
                        items.forEach((item) => {
                            state.queue.songs[item._uniqueId] = item;
                        });

                        const filtered = state.queue.default.filter(
                            (id) => !uniqueIds.includes(id),
                        );

                        const newQueue = [...filtered, ...uniqueIds];

                        state.queue.default = newQueue;
                        followEdit(state, base);
                    });
                },
                moveSelectedToNext: (items: QueueSong[]) => {
                    set((state) => {
                        const base = editBase(state);
                        const uniqueIds = items.map((item) => item._uniqueId);

                        // Add new songs to songs object
                        items.forEach((item) => {
                            state.queue.songs[item._uniqueId] = item;
                        });

                        const currentIndex = playingQueueIndex(state);
                        let beforeCurrent = 0;
                        const filtered = state.queue.default.filter((id, idx) => {
                            const shouldMove = uniqueIds.includes(id);
                            if (shouldMove && idx < currentIndex) {
                                beforeCurrent++;
                            }

                            return !shouldMove;
                        });

                        // For every item that is before the current item, subtract one as
                        // these items will shift the queue up
                        const insertIndex = currentIndex + 1 - beforeCurrent;

                        const newQueue = [
                            ...filtered.slice(0, insertIndex),
                            ...uniqueIds,
                            ...filtered.slice(insertIndex),
                        ];

                        state.queue.default = newQueue;
                        // W1: under shuffle a move keeps every row's play position, which
                        // would leave "Move to next" playing nothing next. The moved rows are
                        // placed as a Play next instead: right after the playing row.
                        const moved = new Set(uniqueIds);
                        moved.delete(base.ids[currentIndex]);
                        const order = base.order.filter((row) => !moved.has(base.ids[row]));
                        followEdit(
                            state,
                            { ...base, order, position: order.indexOf(currentIndex) },
                            base.ids[currentIndex],
                        );
                    });
                },
                moveSelectedToTop: (items: QueueSong[]) => {
                    set((state) => {
                        const base = editBase(state);
                        const uniqueIds = items.map((item) => item._uniqueId);

                        // Add new songs to songs object
                        items.forEach((item) => {
                            state.queue.songs[item._uniqueId] = item;
                        });

                        const filtered = state.queue.default.filter(
                            (id) => !uniqueIds.includes(id),
                        );

                        const newQueue = [...uniqueIds, ...filtered];

                        state.queue.default = newQueue;
                        followEdit(state, base);
                    });
                },
                // navi-connect: apply a queue edit that arrived from another client
                // (`do:queueChanged`) WITHOUT disturbing playback.
                //
                // setQueue is the wrong tool for this, in four separate ways, and all four
                // fire on an edit that never touched the playing track:
                //   - it mints a fresh `_uniqueId` for EVERY track, so the playing song
                //     becomes a new object and every consumer keyed on it re-runs — the
                //     `<audio>` source among them;
                //   - it forces `player.status` to PLAYING;
                //   - it resets `playerNum` to 1, which on the dual-player web engine swaps
                //     the slot the audio is actually in and reloads the source outright;
                //   - it emits QUEUE_RESTORED, whose listener seeks the engine 100 ms later
                //     — a seek on a streamed source is a range request, i.e. a real gap.
                // Together: "playback stops for a second and the cover blinks" whenever
                // someone enqueues or reorders from another device.
                //
                // Here, tracks that survive the edit keep their identity (matched by song id,
                // consumed in order so a queue holding the same song twice keeps two distinct
                // entries), the index is set from the caller's already-relocated value, and
                // nothing else about the player is touched.
                reconcileQueue: (items, index, adopt) => {
                    set((state) => {
                        const base = editBase(state);
                        const available = new Map<string, string[]>();
                        for (const uniqueId of state.queue.default) {
                            const song = state.queue.songs[uniqueId];
                            if (!song) continue;
                            const list = available.get(song.id);
                            if (list) list.push(uniqueId);
                            else available.set(song.id, [uniqueId]);
                        }

                        const nextIds: string[] = [];
                        for (const item of items) {
                            const reuse = available.get(item.id)?.shift();
                            if (reuse) {
                                nextIds.push(reuse);
                            } else {
                                const fresh = toQueueSong(item);
                                state.queue.songs[fresh._uniqueId] = fresh;
                                nextIds.push(fresh._uniqueId);
                            }
                        }

                        state.queue.default = nextIds;

                        const target = Math.max(0, Math.min(index, nextIds.length - 1));
                        // W1: the order the hub sent with the queue, else the rule applied to
                        // the edit by row identity (the kept rows keep their play order). It
                        // used to be regenerated wholesale, so every remote edit reshuffled.
                        placeOnRow(state, target, adopt, () =>
                            base.shuffled
                                ? orderAfterEdit(base.ids, base.order, nextIds)
                                : orderWithFirst(nextIds.length, target, shuffleInPlace),
                        );

                        cleanupOrphanedSongs(state);
                    });
                },
                setQueue: (items, index, position, play, adopt) => {
                    const newItems = items.map(toQueueSong);
                    const newUniqueIds = newItems.map((item) => item._uniqueId);

                    set((state) => {
                        newItems.forEach((item) => {
                            state.queue.songs[item._uniqueId] = item;
                        });

                        state.player.status =
                            play === false ? PlayerStatus.PAUSED : PlayerStatus.PLAYING;
                        state.player.playerNum = 1;
                        state.queue.default = newUniqueIds;
                        // W1: `index` is a row. Under shuffle it used to be written into the
                        // play position over the previous queue's order, which then named
                        // another song. A new queue under shuffle: its start row first.
                        const row = index ?? 0;
                        placeOnRow(state, row, adopt, () =>
                            orderWithFirst(newUniqueIds.length, row, shuffleInPlace),
                        );
                    });

                    eventEmitter.emit('QUEUE_RESTORED', {
                        data: items,
                        index: index ?? 0,
                        position: position ?? 0,
                    });
                },
                ...initialState,
                setCrossfadeDuration: (duration: number) => {
                    set((state) => {
                        const normalizedDuration = Math.max(3, Math.min(21, duration));
                        state.player.crossfadeDuration = normalizedDuration;
                    });
                },
                setCrossfadeStyle: (style: CrossfadeStyle) => {
                    set((state) => {
                        state.player.crossfadeStyle = style;
                    });
                },
                setPauseOnNextSongEnd: (value: boolean) => {
                    set((state) => {
                        state.player.pauseOnNextSongEnd = value;
                    });
                },
                setRepeat: (repeat: PlayerRepeat) => {
                    set((state) => {
                        state.player.repeat = repeat;
                    });
                },
                setShuffle: (shuffle: PlayerShuffle, order) => {
                    set((state) => {
                        const row = playingQueueIndex(state);
                        const rows = state.queue.default.length;

                        state.player.shuffle = shuffle;

                        if (shuffle === PlayerShuffle.TRACK) {
                            if (isPermutation(order, rows)) {
                                // A hub's do:setShuffle: its order, adopted as sent.
                                state.queue.shuffled = [...order];
                                if (row >= 0) state.player.index = Math.max(0, order.indexOf(row));
                            } else {
                                // W1: the playing row first (it used to land anywhere).
                                reshuffle(state, row);
                            }
                        } else {
                            // The play position becomes the playing row again.
                            if (row >= 0) state.player.index = row;
                            state.queue.shuffled = [];
                        }
                        cleanupOrphanedSongs(state);
                    });
                },
                setSpeed: (speed: number) => {
                    set((state) => {
                        const normalizedSpeed = Math.max(0.5, Math.min(2, speed));
                        state.player.speed = normalizedSpeed;
                    });
                },
                setTransitionType: (transitionType: PlayerStyle) => {
                    set((state) => {
                        state.player.transitionType = transitionType;
                    });
                },
                setVolume: (volume: number) => {
                    set((state) => {
                        state.player.volume = Math.min(100, Math.max(0, volume));
                    });
                },
                shuffle: () => {
                    set((state) => {
                        if (state.player.shuffle === PlayerShuffle.TRACK) {
                            // A re-shuffle: the playing row first. It used to regenerate the
                            // order under an unchanged play position, which changed the song.
                            reshuffle(state, playingQueueIndex(state));
                        }
                    });
                },
                shuffleAll: () => {
                    set((state) => {
                        const currentRow = playingQueueIndex(state);
                        const currentUniqueId =
                            currentRow >= 0 ? state.queue.default[currentRow] : undefined;

                        // If there's a current song playing, keep it in place
                        if (currentUniqueId) {
                            const beforeItems = state.queue.default.slice(0, currentRow);
                            const afterItems = state.queue.default.slice(currentRow + 1);

                            const shuffledBefore = shuffleInPlace([...beforeItems]);
                            const shuffledAfter = shuffleInPlace([...afterItems]);

                            state.queue.default = [
                                ...shuffledBefore,
                                currentUniqueId,
                                ...shuffledAfter,
                            ];
                        } else {
                            // No current song, shuffle everything
                            state.queue.default = shuffleInPlace([...state.queue.default]);
                        }

                        // Under shuffle this is a re-shuffle too: the playing row first.
                        if (state.player.shuffle === PlayerShuffle.TRACK) {
                            reshuffle(state, currentRow);
                        }
                    });
                },
                shuffleSelected: (items: QueueSong[]) => {
                    set((state) => {
                        const base = editBase(state);
                        const itemUniqueIds = items.map((item) => item._uniqueId);

                        // Find positions of selected items in the default queue
                        const selectedPositions = itemUniqueIds
                            .map((id) => state.queue.default.findIndex((i) => i === id))
                            .filter((idx) => idx !== -1)
                            .sort((a, b) => a - b); // Sort to maintain order

                        if (selectedPositions.length === 0) {
                            return;
                        }

                        // Get the selected items in their current order
                        const selectedItems = selectedPositions.map(
                            (pos) => state.queue.default[pos],
                        );

                        // Shuffle the selected items
                        const shuffledItems = shuffleInPlace([...selectedItems]);

                        // Rebuild the default queue with shuffled selected items
                        const newDefaultQueue = [...state.queue.default];
                        selectedPositions.forEach((pos, i) => {
                            newDefaultQueue[pos] = shuffledItems[i];
                        });

                        state.queue.default = newDefaultQueue;

                        // A reorder: every row keeps its play position, and the playing row its
                        // place (it may have moved in the queue).
                        followEdit(state, base);
                    });
                },
                toggleRepeat: () => {
                    set((state) => {
                        if (state.player.repeat === PlayerRepeat.NONE) {
                            state.player.repeat = PlayerRepeat.ONE;
                        } else if (state.player.repeat === PlayerRepeat.ONE) {
                            state.player.repeat = PlayerRepeat.ALL;
                        } else {
                            state.player.repeat = PlayerRepeat.NONE;
                        }
                    });
                },
                toggleShuffle: () => {
                    set((state) => {
                        const row = playingQueueIndex(state);

                        state.player.shuffle =
                            state.player.shuffle === PlayerShuffle.NONE
                                ? PlayerShuffle.TRACK
                                : PlayerShuffle.NONE;

                        if (state.player.shuffle === PlayerShuffle.TRACK) {
                            // Enabling shuffle: the playing row first, the rest at random.
                            reshuffle(state, row);
                        } else {
                            // Disabling shuffle: the play position becomes the playing row.
                            if (row >= 0) state.player.index = row;
                            state.queue.shuffled = [];
                        }
                    });
                },
            })),
        ),
        {
            merge: (persistedState: any, currentState: any) => {
                const merged = merge(currentState, persistedState);

                if (merged.player) {
                    merged.player.volume = Math.min(100, Math.max(0, merged.player.volume));
                }

                return merged;
            },
            migrate: async (persistedState, oldVersion) => {
                if (oldVersion < 3) {
                    return {} as PlayerState;
                }

                if (oldVersion === 3) {
                    await migratePlayerStorePersist('player-store');
                    return persistedState as Partial<PlayerState>;
                }

                return persistedState as Partial<PlayerState>;
            },
            name: 'player-store',
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                const playback = useSettingsStore.getState().playback;
                if (playback.previousLocalVolume !== undefined) {
                    state.player.volume = Math.min(100, Math.max(0, playback.previousLocalVolume));
                }
                usePlayerStoreBase.setState({ hydrated: true });
            },
            partialize: (state) => {
                const shouldRestorePlayQueue = useSettingsStore.getState().general.resume;

                // Exclude playerNum, seekToTimestamp, and status from stored player object
                // These are not needed to be stored since they are ephemeral properties
                // Note: timestamp is now in a separate store and doesn't need to be excluded here
                const excludedPlayerKeys = ['playerNum', 'seekToTimestamp', 'status'];

                // If we're not restoring the play queue, we don't need the index property
                // (it is meaningless without the queue)
                if (!shouldRestorePlayQueue) {
                    excludedPlayerKeys.push('index');
                }

                const player = Object.fromEntries(
                    Object.entries(state.player).filter(
                        ([key]) => !excludedPlayerKeys.includes(key),
                    ),
                ) as typeof state.player;

                if (!shouldRestorePlayQueue) {
                    return { player };
                }

                // Queue pruning and IDB writes are handled in `playerStoreStorage` so we only
                // serialize the large queue when the queue slice reference actually changes.
                return { player, queue: state.queue };
            },
            storage: playerStoreStorage,
            version: 4,
        },
    ),
);

export const usePlayerStore = createSelectors(usePlayerStoreBase);

export const usePlayerActions = () => {
    const actions = usePlayerStoreBase(
        useShallow((state) => ({
            addToQueueByType: state.addToQueueByType,
            addToQueueByUniqueId: state.addToQueueByUniqueId,
            clearQueue: state.clearQueue,
            clearSelected: state.clearSelected,
            decreaseVolume: state.decreaseVolume,
            getQueue: state.getQueue,
            increaseVolume: state.increaseVolume,
            isFirstTrackInQueue: state.isFirstTrackInQueue,
            isLastTrackInQueue: state.isLastTrackInQueue,
            keepCurrentAndReplaceRest: state.keepCurrentAndReplaceRest, // navi-connect (B-175)
            mediaAutoNext: state.mediaAutoNext,
            mediaNext: state.mediaNext,
            mediaPause: state.mediaPause,
            mediaPlay: state.mediaPlay,
            mediaPlayByIndex: state.mediaPlayByIndex,
            mediaPrevious: state.mediaPrevious,
            mediaSeekToTimestamp: state.mediaSeekToTimestamp,
            mediaSkipBackward: state.mediaSkipBackward,
            mediaSkipForward: state.mediaSkipForward,
            mediaStop: state.mediaStop,
            mediaToggleMute: state.mediaToggleMute,
            mediaTogglePlayPause: state.mediaTogglePlayPause,
            moveSelectedTo: state.moveSelectedTo,
            moveSelectedToBottom: state.moveSelectedToBottom,
            moveSelectedToNext: state.moveSelectedToNext,
            moveSelectedToTop: state.moveSelectedToTop,
            reconcileQueue: state.reconcileQueue,
            setCrossfadeDuration: state.setCrossfadeDuration,
            setCrossfadeStyle: state.setCrossfadeStyle,
            setPauseOnNextSongEnd: state.setPauseOnNextSongEnd,
            setQueue: state.setQueue,
            setRepeat: state.setRepeat,
            setShuffle: state.setShuffle,
            setSpeed: state.setSpeed,
            setTransitionType: state.setTransitionType,
            setVolume: state.setVolume,
            shuffle: state.shuffle,
            shuffleAll: state.shuffleAll,
            shuffleSelected: state.shuffleSelected,
            toggleRepeat: state.toggleRepeat,
            toggleShuffle: state.toggleShuffle,
        })),
    );

    return useMemo(
        () => ({
            ...actions,
            setTimestamp: setTimestampStore,
        }),
        [actions],
    );
};

export type AddToQueueByPlayType = Play;

export type AddToQueueByUniqueId = {
    edge: 'bottom' | 'left' | 'right' | 'top' | null;
    uniqueId: string;
};

export type AddToQueueOptions = {
    filter?: (song: Song) => boolean;
    skipConfirmation?: boolean;
};

export type AddToQueueType = AddToQueueByPlayType | AddToQueueByUniqueId;

export async function addToQueueByData(type: AddToQueueType, data: Song[]) {
    const items = data.map(toQueueSong);

    if (typeof type === 'string') {
        usePlayerStoreBase.getState().addToQueueByType(items, type);
    } else {
        const normalizedEdge = type.edge === 'top' ? 'top' : 'bottom';
        usePlayerStoreBase.getState().addToQueueByUniqueId(items, type.uniqueId, normalizedEdge);
    }
}

export const subscribePlayerQueue = (
    onChange: (queue: QueueData, prevQueue: QueueData) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.queue,
        (queue, prevQueue) => {
            onChange(queue, prevQueue);
        },
    );
};

export const subscribeCurrentTrack = (
    onChange: (
        properties: { index: number; song: QueueSong | undefined },
        prev: { index: number; song: QueueSong | undefined },
    ) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => {
            const queue = state.getQueue();
            let index = state.player.index;

            if (isShuffleEnabled(state)) {
                index = mapShuffledToQueueIndex(index, state.queue.shuffled);
            }

            return { index, song: queue.items[index] };
        },
        (song, prevSong) => {
            onChange(song, prevSong);
        },
        {
            equalityFn: (a, b) => {
                return a.song?._uniqueId === b.song?._uniqueId;
            },
        },
    );
};

export const subscribeNextSongInsertion = (onChange: (song: QueueSong | undefined) => void) => {
    return usePlayerStoreBase.subscribe(
        (state) => {
            const queue = state.getQueue();
            let queueIndex = state.player.index;
            const repeat = state.player.repeat;

            // If shuffle is enabled, map shuffled position to actual queue position
            if (isShuffleEnabled(state)) {
                queueIndex = mapShuffledToQueueIndex(queueIndex, state.queue.shuffled);
            }

            const currentSong = queue.items[queueIndex];

            // Calculate next song based on shuffle and repeat settings
            let nextSong: QueueSong | undefined;
            if (isShuffleEnabled(state) && repeat !== PlayerRepeat.ONE) {
                // Calculate next in shuffled order
                const nextShuffledIndex = state.player.index + 1;
                if (nextShuffledIndex < state.queue.shuffled.length) {
                    const nextQueueIndex = state.queue.shuffled[nextShuffledIndex];
                    nextSong = queue.items[nextQueueIndex];
                } else if (repeat === PlayerRepeat.ALL) {
                    // Wrap to first in shuffled order
                    const firstQueueIndex = state.queue.shuffled[0];
                    nextSong = queue.items[firstQueueIndex];
                }
            } else {
                nextSong = calculateNextSong(queueIndex, queue.items, repeat);
            }

            return {
                currentUniqueId: currentSong?._uniqueId,
                nextSong,
            };
        },
        (current, prev) => {
            if (!prev) {
                return;
            }

            // Still on the same track, but the upcoming song changed (queue edit: insert, reorder, etc.).
            // Do not require the current track's queue index to stay fixed — e.g. inserting *before* the
            // current item shifts its index in `queue.default`, and the old check missed that case.
            const sameTrackStillPlaying =
                current.currentUniqueId !== undefined &&
                current.currentUniqueId === prev.currentUniqueId;

            if (sameTrackStillPlaying && current.nextSong?._uniqueId !== prev.nextSong?._uniqueId) {
                onChange(current.nextSong);
            }
        },
        {
            // Always allow the subscription to fire so we can check conditions in the callback
            equalityFn: () => false,
        },
    );
};

export const subscribePlayerVolume = (
    onChange: (properties: { volume: number }, prev: { volume: number }) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.player.volume,
        (volume, prevVolume) => {
            onChange({ volume }, { volume: prevVolume });
        },
    );
};

export const subscribePlayerStatus = (
    onChange: (properties: { status: PlayerStatus }, prev: { status: PlayerStatus }) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.player.status,
        (status, prevStatus) => {
            onChange({ status }, { status: prevStatus });
        },
    );
};

export const subscribePlayerSeekToTimestamp = (
    onChange: (properties: { timestamp: number }, prev: { timestamp: number }) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.player.seekToTimestamp,
        (timestamp, prevTimestamp) => {
            onChange(
                { timestamp: parseUniqueSeekToTimestamp(timestamp) },
                { timestamp: parseUniqueSeekToTimestamp(prevTimestamp) },
            );
        },
    );
};

export const subscribePlayerMute = (
    onChange: (properties: { muted: boolean }, prev: { muted: boolean }) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.player.muted,
        (muted, prevMuted) => {
            onChange({ muted }, { muted: prevMuted });
        },
    );
};

export const subscribePlayerSpeed = (
    onChange: (properties: { speed: number }, prev: { speed: number }) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.player.speed,
        (speed, prevSpeed) => {
            onChange({ speed }, { speed: prevSpeed });
        },
    );
};

export const subscribePlayerRepeat = (
    onChange: (properties: { repeat: PlayerRepeat }, prev: { repeat: PlayerRepeat }) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.player.repeat,
        (repeat, prevRepeat) => {
            onChange({ repeat }, { repeat: prevRepeat });
        },
    );
};

export const subscribePlayerShuffle = (
    onChange: (properties: { shuffle: PlayerShuffle }, prev: { shuffle: PlayerShuffle }) => void,
) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.player.shuffle,
        (shuffle, prevShuffle) => {
            onChange({ shuffle }, { shuffle: prevShuffle });
        },
    );
};

export const subscribeQueueCleared = (onChange: () => void) => {
    return usePlayerStoreBase.subscribe(
        (state) => state.queue,
        (queue, prevQueue) => {
            // Detect if queue became empty
            const wasNotEmpty = prevQueue.default.length > 0;
            const isEmpty = queue.default.length === 0;

            if (wasNotEmpty && isEmpty) {
                onChange();
            }
        },
    );
};

export const usePlayerProperties = () => {
    return usePlayerStoreBase(
        useShallow((state) => ({
            crossfadeDuration: state.player.crossfadeDuration,
            crossfadeStyle: state.player.crossfadeStyle,
            isMuted: state.player.muted,
            playerNum: state.player.playerNum,
            repeat: state.player.repeat,
            shuffle: state.player.shuffle,
            speed: state.player.speed,
            status: state.player.status,
            transitionType: state.player.transitionType,
            volume: state.player.volume,
        })),
    );
};

export const usePlayerDuration = () => {
    return usePlayerStoreBase((state) => {
        const queue = state.getQueue();
        let index = state.player.index;

        // If shuffle is enabled, map shuffled position to actual queue position
        if (state.player.shuffle === PlayerShuffle.TRACK && state.queue.shuffled.length > 0) {
            if (index >= 0 && index < state.queue.shuffled.length) {
                index = state.queue.shuffled[index];
            }
        }

        const currentTrack = queue.items[index];
        return currentTrack?.duration;
    });
};

export const usePlayerData = (): PlayerData => {
    return usePlayerStoreBase(
        useShallow((state) => {
            const queue = state.getQueue();
            const index = state.player.index;

            // If shuffle is enabled, map shuffled position to actual queue position for display
            let queueIndex = index;
            if (isShuffleEnabled(state)) {
                queueIndex = mapShuffledToQueueIndex(index, state.queue.shuffled);
            }

            const currentSong = queue.items[queueIndex];
            const repeat = state.player.repeat;

            // For previousSong calculation, we need to consider the shuffled order
            let previousSong: QueueSong | undefined;
            if (isShuffleEnabled(state)) {
                // Calculate previous in shuffled order
                const previousShuffledIndex = index - 1;
                if (previousShuffledIndex >= 0) {
                    const previousQueueIndex = state.queue.shuffled[previousShuffledIndex];
                    previousSong = queue.items[previousQueueIndex];
                } else if (repeat === PlayerRepeat.ALL) {
                    // Wrap to last in shuffled order
                    const lastShuffledIndex = state.queue.shuffled.length - 1;
                    const lastQueueIndex = state.queue.shuffled[lastShuffledIndex];
                    previousSong = queue.items[lastQueueIndex];
                }
            } else {
                previousSong = queueIndex > 0 ? queue.items[queueIndex - 1] : undefined;
            }

            // For nextSong calculation, we need to consider the shuffled order
            let nextSong: QueueSong | undefined;
            if (isShuffleEnabled(state) && repeat !== PlayerRepeat.ONE) {
                // Calculate next in shuffled order
                const nextShuffledIndex = index + 1;
                if (nextShuffledIndex < state.queue.shuffled.length) {
                    const nextQueueIndex = state.queue.shuffled[nextShuffledIndex];
                    nextSong = queue.items[nextQueueIndex];
                } else if (repeat === PlayerRepeat.ALL) {
                    // Wrap to first in shuffled order
                    const firstQueueIndex = state.queue.shuffled[0];
                    nextSong = queue.items[firstQueueIndex];
                }
            } else {
                nextSong = calculateNextSong(queueIndex, queue.items, repeat);
            }

            const { player1, player2 } = getDualPlayerSongs(
                state.player.playerNum,
                currentSong,
                nextSong,
                repeat,
            );

            return {
                currentSong,
                index: queueIndex, // Return the actual queue position for display
                nextSong,
                num: state.player.playerNum,
                player1,
                player2,
                previousSong,
                queueLength: state.queue.default.length,
                status: state.player.status,
            };
        }),
    );
};

export const updateQueueFavorites = (ids: string[], favorite: boolean) => {
    usePlayerStoreBase.setState((state) => {
        Object.values(state.queue.songs).forEach((song) => {
            if (ids.includes(song.id)) {
                song.userFavorite = favorite;
            }
        });
    });
};

export const updateQueueRatings = (ids: string[], rating: null | number) => {
    usePlayerStoreBase.setState((state) => {
        Object.values(state.queue.songs).forEach((song) => {
            if (ids.includes(song.id)) {
                song.userRating = rating;
            }
        });
    });
};

export const incrementQueuePlayCount = (ids: string[]) => {
    usePlayerStoreBase.setState((state) => {
        Object.values(state.queue.songs).forEach((song) => {
            if (ids.includes(song.id)) {
                song.playCount = (song.playCount || 0) + 1;
            }
        });
    });
};

export const updateQueueSong = (songId: string, updatedSong: Song) => {
    usePlayerStoreBase.setState((state) => {
        Object.values(state.queue.songs).forEach((song) => {
            if (song.id === songId) {
                const uniqueId = song._uniqueId;
                state.queue.songs[song._uniqueId] = {
                    ...updatedSong,
                    _contextPlaylistId: song._contextPlaylistId,
                    _uniqueId: uniqueId,
                };
            }
        });
    });
};

export const useCurrentPlaylistContextId = () => {
    return usePlayerStoreBase((state) => state.getCurrentSong()?._contextPlaylistId ?? null);
};

export const usePlayerMuted = () => {
    return usePlayerStoreBase((state) => state.player.muted);
};

export const usePlayerRepeat = () => {
    return usePlayerStoreBase((state) => state.player.repeat);
};

export const usePlayerShuffle = () => {
    return usePlayerStoreBase((state) => state.player.shuffle);
};

export const usePlayerStatus = () => {
    return usePlayerStoreBase((state) => state.player.status);
};

export const usePlayerHydrated = () => {
    return usePlayerStoreBase((state) => state.hydrated);
};

export const useMpvInitialized = () => {
    return usePlayerStoreBase((state) => state.mpvInitialized);
};

export const setMpvInitialized = (mpvInitialized: boolean) => {
    usePlayerStoreBase.setState({ mpvInitialized });
};

export const usePlayerVolume = () => {
    return usePlayerStoreBase((state) => state.player.volume);
};

export const usePlayerSpeed = () => {
    return usePlayerStoreBase((state) => state.player.speed);
};

export const usePlayerSong = () => {
    return usePlayerStoreBase(
        (state) => {
            return state.getCurrentSong();
        },
        (prev, next) => {
            return (
                prev?._uniqueId === next?._uniqueId &&
                prev?.userFavorite === next?.userFavorite &&
                prev?.userRating === next?.userRating
            );
        },
    );
};

export const usePlayerSongProperties = <T extends keyof QueueSong>(
    properties: T[],
): Partial<Pick<QueueSong, T>> => {
    return usePlayerStoreBase(
        useShallow((state) => {
            const song = state.getCurrentSong();
            if (!song) {
                return {};
            }

            const result = {} as Pick<QueueSong, T>;

            for (const prop of properties) {
                result[prop] = song[prop];
            }
            return result;
        }),
    );
};

export const usePlayerNum = () => {
    return usePlayerStoreBase((state) => state.player.playerNum);
};

export const usePlayerQueue = () => {
    return usePlayerStoreBase(
        useShallow((state) => {
            const songs = state.queue.songs;
            const queue = state.queue.default;
            const result: QueueSong[] = [];
            for (const id of queue) {
                const song = songs[id];
                if (song) result.push(song);
            }
            return result;
        }),
    );
};

function cleanupOrphanedSongs(state: any): boolean {
    const allQueueIds = new Set([
        ...state.queue.default,
        // shuffled now contains indexes, not uniqueIds, so we don't include it here
    ]);

    const songs = state.queue.songs;
    const songIds = Object.keys(songs);
    let hasOrphans = false;

    // Membership is decided against `allQueueIds` both times. The rebuild used to test
    // against an ARRAY of orphans (`orphanedIds.includes`), making this quadratic in the
    // queue length — which the reconcileQueue path above now walks into on every remote
    // queue edit.
    for (const songId of songIds) {
        if (!allQueueIds.has(songId)) {
            hasOrphans = true;
            break;
        }
    }

    if (hasOrphans) {
        const cleanedSongs: Record<string, QueueSong> = {};
        for (const songId of songIds) {
            if (allQueueIds.has(songId)) {
                cleanedSongs[songId] = songs[songId];
            }
        }
        state.queue.songs = cleanedSongs;
    }

    return hasOrphans;
}

function findIndexWithPreviousAlbum(queueItems: QueueSong[], currentIndex: number) {
    const queueBeforeCurrent = queueItems.slice(0, currentIndex);
    const currentItem = queueItems[currentIndex];

    const previousAlbumIdInQueue = queueBeforeCurrent.findLast(
        (i) => i.albumId !== currentItem.albumId,
    )?.albumId;

    let prevIndex = -1;

    if (previousAlbumIdInQueue) {
        for (let index = queueBeforeCurrent.length - 1; index > -1; index--) {
            const element = queueBeforeCurrent[index];
            if (element.albumId === previousAlbumIdInQueue) {
                prevIndex = index;
            }
            if (prevIndex > -1 && element.albumId !== previousAlbumIdInQueue) {
                break;
            }
        }
    }

    return prevIndex;
}

function findLastAlbumRange(queueItems: QueueSong[]) {
    const lastAlbumId = queueItems.at(-1)?.albumId;
    const rangeEnd = queueItems.length - 1;
    let rangeStart = rangeEnd;

    for (let index = rangeEnd; index > -1; index--) {
        const element = queueItems[index];
        rangeStart = index;
        if (element.albumId !== lastAlbumId) {
            break;
        }
    }

    return [rangeStart + 1, rangeEnd];
}

function parseUniqueSeekToTimestamp(timestamp: string) {
    return Number(timestamp.split('-')[0]);
}

function toQueueSong(item: Song): QueueSong {
    return {
        ...item,
        _uniqueId: nanoid(),
    };
}
