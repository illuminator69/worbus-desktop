/**
 * The hub's device registry as the main hub client snoops it (PROTOCOL §3.2), for the cast
 * bridge's arbitration (§12.2). Out of index.ts so a harness can drive it (B-107). Pure.
 *
 * It belongs to one connection: `null` ("unknown") from the moment that connection ends or a new
 * one is started until the new one's first `welcome` / `devices` frame. Unknown is not empty: an
 * empty list is the hub saying nobody is there; `null` is this desktop not knowing. B-107: when a
 * drop emptied the list instead, the cast bridge read "nobody is bridging this speaker" and took
 * it from the phone's bridge.
 */

export interface DeviceRegistry {
    /** The connection it came from ended (a drop, a stop) or is being replaced. */
    connectionEnded: () => void;
    /** The current connection's registry; null while it has not delivered one. */
    current: () => HubDeviceInfo[] | null;
    /** A frame from the current connection; true when it carried the registry. */
    snoop: (msg: unknown) => boolean;
}

/** Shape of a hub `DeviceInfo` row (PROTOCOL §3.2) — only the fields we arbitrate on. */
export interface HubDeviceInfo {
    bridgedBy?: null | string;
    id: string;
    online: boolean;
    reachable?: boolean | null;
}

export const createDeviceRegistry = (): DeviceRegistry => {
    let rows: HubDeviceInfo[] | null = null;
    return {
        connectionEnded: () => {
            rows = null;
        },
        current: () => rows,
        snoop: (msg) => {
            const m = msg as null | { devices?: unknown; t?: unknown };
            if (m?.t !== 'welcome' && m?.t !== 'devices') return false;
            if (!Array.isArray(m.devices)) return false;
            rows = m.devices as HubDeviceInfo[];
            return true;
        },
    };
};
