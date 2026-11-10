import type { QueueSong } from '/@/shared/types/domain-types';
import type { PlayerRepeat, PlayerShuffle } from '/@/shared/types/types';

import merge from 'lodash/merge';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

// navi-connect: Symfonium-style "saved queues" + Continue Listening. A rolling, per-client history
// of automatically-captured queue snapshots. Mirrors Worbus for Android's SavedQueueRepository model (see
// navic .../domain/repositories/SavedQueueRepository.kt) so the two clients behave alike. Purely
// local (persisted to this renderer's storage); the hub is not involved.

export interface SavedQueue {
    // Cover art for the Continue Listening card — the queue's ORIGIN art (album/playlist, else
    // its first track), stamped once at creation so a card doesn't change as playback advances.
    coverImageUrl: null | string;
    createdAt: number;
    currentIndex: number;
    currentSongId?: string;
    currentSongName?: string;
    id: string;
    // User-assigned name (overrides sourceName in the UI when set).
    name?: string;
    positionSeconds: number;
    repeat: PlayerRepeat;
    serverId: string;
    shuffle: PlayerShuffle;
    songCount: number;
    // Full queue, so a restore is instant and independent of a re-fetch. Bounded by MAX_SAVED_QUEUES.
    songs: QueueSong[];
    sourceKind: SavedQueueKind;
    // e.g. the album/playlist name the queue came from.
    sourceName?: string;
    updatedAt: number;
}

/**
 * How a saved queue came to be — stored so the list can distinguish generated sessions (radio,
 * Mood Flow, Journey) from ordinary album/playlist/manual queues. String-valued (not a strict
 * union at the storage layer) for forward-compat with kinds from newer builds.
 */
export type SavedQueueKind = 'album' | 'journey' | 'manual' | 'moodFlow' | 'playlist' | 'radio';

/**
 * The subset [updateProgress] moves without rewriting the (large) song list. Deliberately
 * excludes coverImageUrl/sourceName: a queue's origin name is frozen at birth. The card's
 * title and artwork are the resume track's (`savedQueueTitle`, `savedQueueCoverSongId`), so
 * they follow this cursor.
 */
export interface SavedQueueProgress {
    currentIndex: number;
    currentSongId?: string;
    currentSongName?: string;
    positionSeconds: number;
}

export const MAX_SAVED_QUEUES = 20;

interface SavedQueuesSlice extends SavedQueuesState {
    actions: {
        clearAll: () => void;
        followCursor: (id: string, cursor: Omit<SavedQueueProgress, 'positionSeconds'>) => void;
        mergeFromHub: (incoming: SavedQueue[]) => void;
        remove: (id: string) => void;
        rename: (id: string, name: string) => void;
        /** B-329: the account this cache is filled under (at each welcome naming a user). */
        setOwner: (owner: null | string) => void;
        updateProgress: (id: string, progress: SavedQueueProgress) => void;
        upsert: (entry: SavedQueue) => void;
    };
}

interface SavedQueuesState {
    /** B-329: the account the cache was filled under; null before accounts (P1) or unknown. */
    owner: null | string;
    queues: SavedQueue[];
}

export const useSavedQueuesStore = createWithEqualityFn<SavedQueuesSlice>()(
    persist(
        devtools(
            immer((set, get) => ({
                actions: {
                    clearAll: () => {
                        set((state) => {
                            state.queues = [];
                        });
                    },
                    // B-046: the live session moved to another track. The hub sends
                    // `savedQueues` only when a queue is edited, never on a track change, so
                    // the active card kept the index of the last edit — its artwork and title
                    // a track behind for an ordinary queue, and one behind ALWAYS for radio,
                    // whose top-up lands just before each track boundary. Not a new write:
                    // `updatedAt` stays, so the history's order is the hub's.
                    followCursor: (id, cursor) => {
                        // Called on every ~1 Hz hub `progress` frame, so "nothing moved" must
                        // be decided BEFORE `set`: persist and devtools both act on every
                        // `set` call, changed or not - one stringifies the whole history into
                        // localStorage, the other ships it to the Redux DevTools extension
                        // (~300 KB a second; its worker held 3.8 GB after 4.5 h of `pnpm dev`).
                        const current = get().queues.find((q) => q.id === id);
                        if (!current || current.currentIndex === cursor.currentIndex) return;
                        set((state) => {
                            const entry = state.queues.find((q) => q.id === id);
                            if (!entry) return;
                            entry.currentIndex = cursor.currentIndex;
                            entry.currentSongId = cursor.currentSongId;
                            entry.currentSongName = cursor.currentSongName;
                        });
                    },
                    // navi-connect: adopt the hub's AUTHORITATIVE history when connected. This is a
                    // replace, not a union — that's what lets a delete on one client propagate here
                    // (a union could only ever add). It's safe because every ONLINE write goes
                    // through the hub, and OFFLINE-captured entries are pushed up via syncSavedQueues
                    // at `welcome` before any broadcast arrives. Local user-assigned names are kept.
                    mergeFromHub: (incoming) => {
                        set((state) => {
                            const localById = new Map(state.queues.map((q) => [q.id, q]));
                            const next = incoming
                                .filter((r) => r?.id && (r.songs?.length ?? 0) > 0)
                                .map((r) => {
                                    // Keep local-only enrichment the hub record can't
                                    // carry (a Worbus for Android-origin row has no cover URL for this
                                    // server, and an offline rename may not be up yet).
                                    const local = localById.get(r.id);
                                    // The hub's copy of a record carries wire-shaped
                                    // tracks; when our local copy holds the same tracks
                                    // as REAL library songs (album ids, containers, …),
                                    // keep those — they restore with richer metadata.
                                    const keepLocalSongs =
                                        local &&
                                        local.songs.length === r.songs.length &&
                                        local.songs.every((s, n) => s.id === r.songs[n]?.id) &&
                                        local.songs.some((s) => Boolean(s.albumId));
                                    return {
                                        ...r,
                                        coverImageUrl:
                                            r.coverImageUrl ?? local?.coverImageUrl ?? null,
                                        name: r.name ?? local?.name,
                                        songs: keepLocalSongs ? local.songs : r.songs,
                                        sourceName: r.sourceName ?? local?.sourceName,
                                    };
                                })
                                .sort((a, b) => b.updatedAt - a.updatedAt);
                            if (next.length > MAX_SAVED_QUEUES) next.length = MAX_SAVED_QUEUES;
                            state.queues = next;
                        });
                    },
                    remove: (id) => {
                        set((state) => {
                            state.queues = state.queues.filter((q) => q.id !== id);
                        });
                    },
                    rename: (id, name) => {
                        set((state) => {
                            const entry = state.queues.find((q) => q.id === id);
                            if (entry) {
                                entry.name = name.trim() || undefined;
                            }
                        });
                    },
                    setOwner: (owner) => {
                        set((state) => {
                            state.owner = owner;
                        });
                    },
                    updateProgress: (id, progress) => {
                        set((state) => {
                            const entry = state.queues.find((q) => q.id === id);
                            if (!entry) return;
                            entry.currentIndex = progress.currentIndex;
                            entry.currentSongId = progress.currentSongId;
                            entry.currentSongName = progress.currentSongName;
                            entry.positionSeconds = progress.positionSeconds;
                            entry.updatedAt = Date.now();
                        });
                    },
                    upsert: (entry) => {
                        set((state) => {
                            const idx = state.queues.findIndex((q) => q.id === entry.id);
                            if (idx >= 0) {
                                // A refresh of an existing session must not restate its
                                // identity: creation time, user name, origin name/kind and
                                // cover are all established at birth.
                                const existing = state.queues[idx];
                                state.queues[idx] = {
                                    ...entry,
                                    coverImageUrl: existing.coverImageUrl ?? entry.coverImageUrl,
                                    createdAt: existing.createdAt,
                                    name: existing.name ?? entry.name,
                                    sourceKind: existing.sourceKind ?? entry.sourceKind,
                                    sourceName: existing.sourceName ?? entry.sourceName,
                                };
                            } else {
                                state.queues.push(entry);
                            }
                            // Rolling cache: keep the most-recently-updated MAX_SAVED_QUEUES.
                            state.queues.sort((a, b) => b.updatedAt - a.updatedAt);
                            if (state.queues.length > MAX_SAVED_QUEUES) {
                                state.queues.length = MAX_SAVED_QUEUES;
                            }
                        });
                    },
                },
                owner: null,
                queues: [],
            })),
            { name: 'store_saved_queues' },
        ),
        {
            merge: (persistedState, currentState) => merge(currentState, persistedState),
            name: 'store_saved_queues',
            // Persist only the data, never the action closures.
            partialize: (state) => ({ owner: state.owner, queues: state.queues }),
            version: 1,
        },
    ),
);

export const useSavedQueuesActions = () => useSavedQueuesStore((state) => state.actions);

export const useSavedQueues = () => useSavedQueuesStore((state) => state.queues, shallow);

/** Most-recently-updated saved queues for the given server, newest first (Continue Listening). */
export const useContinueListening = (serverId: null | string | undefined, limit = 10) =>
    useSavedQueuesStore(
        (state) =>
            state.queues
                // An empty serverId means "unknown", not "some other server" — Worbus for Android-origin rows
                // never carry one. Excluding them hid the phone's queues from this list entirely.
                .filter((q) => !serverId || !q.serverId || q.serverId === serverId)
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, limit),
        shallow,
    );
