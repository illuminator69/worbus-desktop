import type { StationCatalog } from '/@/shared/types/station-types';

import { persist } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
    applySessionStationId,
    applyStationFrame,
    ARM_TTL_MS,
    bindingFromCursor,
    boundByAnotherDevice,
    LOCAL_BINDING_HOLD_MS,
    StationBinding,
    StationCursor,
    StationMode,
    stationMode,
} from '/@/renderer/features/player/station/station-logic';
import { onQueueSessionBegin } from '/@/renderer/features/player/utils/saved-queue-source';
import { useHubStore } from '/@/renderer/store/hub.store';

/**
 * navi-connect stations (I-040): which station the queue being listened to belongs to, and
 * whether the hub's engine can be used at all. Only the station client and the hub frames write
 * it; every surface (the queue chip, the autoplay popover, Settings) reads it, never the
 * settings, so what they say is what built the queue.
 *
 * Fed by:
 *  - this client: a radio it starts (armed, then bound when the new queue session begins), the
 *    answers to its own `start` / `next`, and any new queue session that is not a station's
 *    (which unbinds);
 *  - the hub: `session.stationId`, `welcome.station` and `station` frames (use-hub.tsx).
 *
 * `bound` and the last catalogue are persisted, so a relaunch still names the radio and can
 * restart an expired station from its seed; the hub's `welcome` then states the truth.
 */

interface StationActions {
    actions: {
        /** Applied by the autoplay hook after an answer: the binding moves on. */
        adopt: (
            binding: null | StationBinding,
            options?: { elsewhere?: boolean; hold?: boolean },
        ) => void;
        /** Arm a binding for the queue a radio is about to play (see onQueueSessionBegin). */
        arm: (binding: StationBinding) => void;
        connectionLost: () => void;
        consumeFallbackKick: () => boolean;
        /** Set the fallback kick on its own: Auto DJ was just switched on from a chip. */
        kickAutoDj: () => void;
        latchFallback: () => void;
        /** Ids the bound station served this client. */
        noteServed: (stationId: string, ids: string[]) => void;
        sessionStationId: (incoming: unknown) => void;
        setCatalog: (catalog: null | StationCatalog) => void;
        setInFlight: (inFlight: boolean) => void;
        stationFrame: (cursor: StationCursor) => void;
        welcome: (station: null | StationCursor, sessionStationId: unknown) => void;
    };
}

interface StationState {
    /** A binding a radio entry point set up for the queue it is about to play. */
    armed: null | { at: number; binding: StationBinding };
    /** This connection's probe said the engine answers. */
    available: boolean;
    bound: null | StationBinding;
    /** The last readable `GET /sonic/station/characters` answer, kept for its words. */
    catalog: null | StationCatalog;
    /** Cursors heard in `station` frames, for stations not (yet) bound here. At most 8. */
    cursors: Record<string, StationCursor>;
    /** When another device last moved the bound station's cursor (SERVED_ELSEWHERE_GRACE_MS). */
    elsewhereAt: number;
    /** Set with the latch; the fallback Auto DJ checks it once when it takes over, so a queue
     *  that ran out while the engine failed is still continued. */
    fallbackKick: boolean;
    /** A `start` or `next` answered 503: no tier is usable until a probe says otherwise. */
    fallbackLatched: boolean;
    /** One of this client's station requests is out (the "finding more" state). */
    inFlight: boolean;
    /** The last answer was partial: fewer tracks than asked, retried at the next trigger. */
    lastPartial: boolean;
    /** Until when a local change of `bound` outranks a disagreeing `session` frame. */
    localUntil: number;
    /** Whether this connection's probe has answered. */
    probed: boolean;
    /**
     * The ids this client received from the bound station (I-041), so a chip can tell the
     * station's rows from the user's in a queue whose rows carry no mark of their own: a remote
     * session's, where only ids travel. Reset when the binding moves to another station.
     */
    served: { ids: string[]; stationId: string };
}

const MAX_CURSORS = 8;
const MAX_SERVED = 600;

const keepCursor = (
    cursors: Record<string, StationCursor>,
    cursor: StationCursor,
): Record<string, StationCursor> => {
    const next = { ...cursors, [cursor.stationId]: cursor };
    const ids = Object.keys(next);
    if (ids.length > MAX_CURSORS) delete next[ids[0]];
    return next;
};

export const useStationStore = createWithEqualityFn<StationActions & StationState>()(
    persist(
        (set, get) => ({
            actions: {
                adopt: (binding, options = {}) =>
                    set({
                        bound: binding,
                        ...(options.elsewhere ? { elsewhereAt: Date.now() } : {}),
                        ...(options.hold ? { localUntil: Date.now() + LOCAL_BINDING_HOLD_MS } : {}),
                    }),
                arm: (binding) => set({ armed: { at: Date.now(), binding } }),
                connectionLost: () => set({ available: false, inFlight: false, probed: false }),
                consumeFallbackKick: () => {
                    if (!get().fallbackKick) return false;
                    set({ fallbackKick: false });
                    return true;
                },
                kickAutoDj: () => set({ fallbackKick: true }),
                latchFallback: () => set({ fallbackKick: true, fallbackLatched: true }),
                noteServed: (stationId, ids) =>
                    set((s) => {
                        const kept = s.served.stationId === stationId ? s.served.ids : [];
                        const next = [...new Set([...ids, ...kept])];
                        return {
                            served: {
                                ids: next.length > MAX_SERVED ? next.slice(-MAX_SERVED) : next,
                                stationId,
                            },
                        };
                    }),
                sessionStationId: (incoming) => {
                    const s = get();
                    const next = applySessionStationId({
                        bound: s.bound,
                        cursors: s.cursors,
                        incoming,
                        localUntil: s.localUntil,
                        now: Date.now(),
                    });
                    if (next.bound !== s.bound || next.localUntil !== s.localUntil) {
                        set({
                            ...next,
                            ...(boundByAnotherDevice(s.bound, next.bound, s.inFlight)
                                ? { elsewhereAt: Date.now() }
                                : {}),
                        });
                    }
                },
                setCatalog: (catalog) =>
                    set((s) => ({
                        // No answer (an unreachable hub, one too old to route the probe) is
                        // "unavailable" for this connection; the words of the last real answer
                        // are kept for the next one.
                        available: catalog?.available === true,
                        catalog: catalog ?? s.catalog,
                        // Only a probe that says "available" ends a 503 latch.
                        fallbackLatched: catalog?.available === true ? false : s.fallbackLatched,
                        probed: true,
                    })),
                setInFlight: (inFlight) => set({ inFlight }),
                stationFrame: (cursor) =>
                    set((s) => ({
                        bound: applyStationFrame(s.bound, cursor),
                        cursors: keepCursor(s.cursors, cursor),
                        // A cursor past the one this client holds, while this client is not
                        // asking, was moved by another device: its batch is on its way.
                        ...(!s.inFlight &&
                        s.bound?.stationId === cursor.stationId &&
                        cursor.seq > s.bound.seq
                            ? { elsewhereAt: Date.now() }
                            : {}),
                    })),
                welcome: (station, sessionStationId) => {
                    const s = get();
                    // `welcome.station` describes the session's own station, with its name and
                    // seed, so a device connecting mid-station knows `after` at once.
                    const cursors = station ? keepCursor(s.cursors, station) : s.cursors;
                    const next = applySessionStationId({
                        bound: s.bound,
                        cursors,
                        incoming: sessionStationId,
                        localUntil: s.localUntil,
                        now: Date.now(),
                    });
                    const bound =
                        station && next.bound?.stationId === station.stationId
                            ? bindingFromCursor(station, next.bound)
                            : next.bound;
                    set({ bound, cursors, localUntil: next.localUntil });
                },
            },
            armed: null,
            available: false,
            bound: null,
            catalog: null,
            cursors: {},
            elsewhereAt: 0,
            fallbackKick: false,
            fallbackLatched: false,
            inFlight: false,
            lastPartial: false,
            localUntil: 0,
            probed: false,
            served: { ids: [], stationId: '' },
        }),
        {
            name: 'store_station',
            partialize: (state) => ({
                bound: state.bound,
                catalog: state.catalog,
                served: state.served,
            }),
            version: 1,
        },
    ),
);

/**
 * A new listening session began on this client (a replace of the queue: an album, a playlist, a
 * saved queue, a radio). A radio armed its binding just before; anything else is not a station's
 * queue, so the binding goes. Either way this client's word outranks the frames still in flight
 * for a moment (applySessionStationId).
 */
onQueueSessionBegin(() => {
    const { armed } = useStationStore.getState();
    const now = Date.now();
    const binding = armed && now - armed.at <= ARM_TTL_MS ? armed.binding : null;
    useStationStore.setState({
        armed: null,
        bound: binding,
        // The last queue's short batch says nothing about this one.
        lastPartial: false,
        localUntil: now + LOCAL_BINDING_HOLD_MS,
    });
});

export const getStationMode = (): StationMode => {
    const hub = useHubStore.getState();
    const s = useStationStore.getState();
    return stationMode({
        available: s.available,
        connected: hub.connected,
        fallbackLatched: s.fallbackLatched,
        hasFeature: hub.features.includes('station'),
        probed: s.probed,
    });
};

export const useStationMode = (): StationMode => {
    const hub = useHubStore(
        (s) => ({ connected: s.connected, hasFeature: s.features.includes('station') }),
        shallow,
    );
    const s = useStationStore(
        (state) => ({
            available: state.available,
            fallbackLatched: state.fallbackLatched,
            probed: state.probed,
        }),
        shallow,
    );
    return stationMode({
        available: s.available,
        connected: hub.connected,
        fallbackLatched: s.fallbackLatched,
        hasFeature: hub.hasFeature,
        probed: s.probed,
    });
};

/**
 * The station id a `setQueue` names for the queue it publishes: the bound one, while the hub
 * speaks stations. A `setQueue` without it unbinds the session (PROTOCOL §18.2), so every
 * publication of a station's queue (each top-up republishes the whole queue) must carry it.
 */
export const stationIdForPublish = (): string | undefined => {
    const hub = useHubStore.getState();
    if (!hub.connected || !hub.features.includes('station')) return undefined;
    const bound = useStationStore.getState().bound;
    // A station the hub declined to bind continues from this device without the session
    // naming it: naming it here would be the retried bind the hub said no to.
    return bound && !bound.unbound ? bound.stationId : undefined;
};

/**
 * The ids the bound station served this client, only while `served` is that station's: how a
 * remote session's rows, which carry ids only, are told apart from the user's. A row is the
 * station's when it carries `_stationId` (local) or its id is in this set.
 */
export const servedIdsOf = (state: Pick<StationState, 'bound' | 'served'>): Set<string> =>
    new Set(
        state.served.stationId && state.served.stationId === state.bound?.stationId
            ? state.served.ids
            : [],
    );

export const useStationBinding = () => useStationStore((s) => s.bound, shallow);
export const useStationCatalog = () => useStationStore((s) => s.catalog, shallow);
export const useStationInFlight = () => useStationStore((s) => s.inFlight);
export const useStationActions = () => useStationStore((s) => s.actions);
