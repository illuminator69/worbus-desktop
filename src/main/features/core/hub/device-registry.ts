/**
 * The hub's device registry as the main hub client snoops it (PROTOCOL §3.2), for the cast
 * bridge's arbitration (§12.2). Out of index.ts so a harness can drive it (B-107). Pure.
 */

/** Shape of a hub `DeviceInfo` row (PROTOCOL §3.2) — only the fields we arbitrate on. */
export interface HubDeviceInfo {
    bridgedBy?: null | string;
    id: string;
    online: boolean;
    reachable?: boolean | null;
}

export interface DeviceRegistry {
    /** The connection it came from ended (a drop, a stop). */
    connectionEnded: () => void;
    current: () => HubDeviceInfo[];
    /** A frame from the current connection; true when it carried the registry. */
    snoop: (msg: unknown) => boolean;
}

export const createDeviceRegistry = (): DeviceRegistry => {
    let rows: HubDeviceInfo[] = [];
    return {
        connectionEnded: () => {
            rows = [];
        },
        current: () => rows,
        snoop: (msg) => {
            const m = msg as { devices?: unknown; t?: unknown } | null;
            if (m?.t !== 'welcome' && m?.t !== 'devices') return false;
            if (!Array.isArray(m.devices)) return false;
            rows = m.devices as HubDeviceInfo[];
            return true;
        },
    };
};
