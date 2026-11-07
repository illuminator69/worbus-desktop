// F1: which hub device "just connected", for the player bar's "Switch to <name>" pill. Pure, so
// the rules can be tested without React or the hub store (device-arrivals.harness.ts);
// use-device-control-state.ts feeds it the store's `devices` and reads the proposal.
//
// The hub re-sends the whole list on `welcome` and on every `devices` frame, including frames
// that only change a volume or the active flag, so only presence is compared. The first snapshot
// of a connection is a baseline: a reconnect lists every device, and none of them just arrived.
// A device that drops for a moment (a network blip) is not an arrival either: it must have been
// offline or missing for ARRIVAL_MIN_ABSENCE_MS. `lastSeen` is bumped by every inbound frame, so
// it says nothing about presence and is not read.
//
// The minimum is short on purpose. Worbus for Android keeps its hub socket while it is in the background, so
// bringing it forward is not a connection at all; it reconnects when its process restarts or the
// network changes, and its backoff starts at 1 s, so it is back within seconds. A 15 s minimum
// hid exactly those arrivals.

/** How long a device must have been gone before coming back counts as connecting. */
export const ARRIVAL_MIN_ABSENCE_MS = 3_000;

/** How long "Switch to <name>" is offered after the device connects. */
export const ARRIVAL_PROPOSAL_MS = 30_000;

/** Who is who right now, from the hub store and settings. */
export interface ArrivalContext {
    activeId: null | string;
    hiddenIds: ReadonlySet<string>;
    myId: null | string;
}

/** The fields of a hub `DeviceInfo` the tracker reads; the store's `HubDevice` satisfies it. */
export interface ArrivalDevice {
    id: string;
    name: string;
    /** A socket claiming this id is attached. */
    online: boolean;
    /** A bridge's verdict on its hardware; null or absent for an ordinary client. */
    reachable?: boolean | null;
}

export interface ArrivalTracker {
    /** Stop proposing this device until it connects again. */
    dismiss(id: string): void;
    /** When the proposal of this device ends, or null if it is not an arrival. */
    expiresAt(id: string): null | number;
    /** Feed one `devices` snapshot, taken at `now`. Returns the devices that just arrived. */
    observe(devices: readonly ArrivalDevice[], now: number): ArrivalDevice[];
    /** The device to propose at `now`, or null. */
    proposal(now: number, ctx: ArrivalContext): ArrivalDevice | null;
    /** Forget everything: the next snapshot is a baseline (hub disconnect, reconnect). */
    reset(): void;
}

// Must stay equal to `isHubDeviceTransferable` in store/hub.store.ts (not imported: this module
// stays free of the store so node --test can load it).
const isTransferable = (device: ArrivalDevice): boolean =>
    device.online && device.reachable !== false;

interface Presence {
    lastOnline: boolean;
    /** When it was first seen offline or missing, while it still is. */
    offlineSince?: number;
}

export function createArrivalTracker(): ArrivalTracker {
    let baseline = true;
    let presence = new Map<string, Presence>();
    let latest = new Map<string, ArrivalDevice>();
    let arrivals: { at: number; id: string }[] = [];

    return {
        dismiss(id) {
            arrivals = arrivals.filter((a) => a.id !== id);
        },

        expiresAt(id) {
            const arrival = arrivals.find((a) => a.id === id);
            return arrival ? arrival.at + ARRIVAL_PROPOSAL_MS : null;
        },

        observe(devices, now) {
            const next = new Map<string, Presence>();
            const arrived: ArrivalDevice[] = [];
            for (const device of devices) {
                const prev = presence.get(device.id);
                if (device.online) {
                    const isArrival =
                        !baseline &&
                        (!prev ||
                            (!prev.lastOnline &&
                                prev.offlineSince !== undefined &&
                                now - prev.offlineSince >= ARRIVAL_MIN_ABSENCE_MS));
                    if (isArrival) {
                        arrivals = arrivals.filter((a) => a.id !== device.id);
                        arrivals.push({ at: now, id: device.id });
                        arrived.push(device);
                    }
                    next.set(device.id, { lastOnline: true });
                } else {
                    next.set(device.id, {
                        lastOnline: false,
                        offlineSince: prev && !prev.lastOnline ? prev.offlineSince : now,
                    });
                }
            }
            // A device the snapshot no longer lists is as gone as an offline one.
            for (const [id, prev] of presence) {
                if (next.has(id)) continue;
                next.set(id, {
                    lastOnline: false,
                    offlineSince: prev.lastOnline ? now : prev.offlineSince,
                });
            }
            presence = next;
            latest = new Map(devices.map((d) => [d.id, d]));
            arrivals = arrivals.filter((a) => now - a.at < ARRIVAL_PROPOSAL_MS);
            baseline = false;
            return arrived;
        },

        proposal(now, ctx) {
            for (let i = arrivals.length - 1; i >= 0; i -= 1) {
                const { at, id } = arrivals[i];
                if (now - at >= ARRIVAL_PROPOSAL_MS) continue;
                if (id === ctx.myId || id === ctx.activeId || ctx.hiddenIds.has(id)) continue;
                const device = latest.get(id);
                if (device && isTransferable(device)) return device;
            }
            return null;
        },

        reset() {
            baseline = true;
            presence = new Map();
            latest = new Map();
            arrivals = [];
        },
    };
}
