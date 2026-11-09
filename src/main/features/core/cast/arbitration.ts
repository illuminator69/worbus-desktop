/**
 * The cast bridge's claim arbitration (PROTOCOL §12.2), out of index.ts so a harness can replay it
 * (B-107). Pure: the registry, the clock and the bridge's own state come in as arguments.
 */
import type { HubDeviceInfo } from '../hub/device-registry';

// An empty registry is ambiguous: nobody is bridging this speaker, OR the main hub
// client hasn't delivered `welcome` yet. Claiming during that window is how the desktop
// would steal a speaker Worbus for Android was already serving on every single launch. Wait for the
// registry, but not forever — a hub that never connects must not disable casting.
export const REGISTRY_WAIT_MS = 10_000;

/**
 * Is another client already bridging this speaker? PROTOCOL §12.2 step 1. `castHubId` is the
 * speaker's hub device id, `selfHubId` this desktop's (our own previous socket is no competitor).
 */
export const claimedElsewhere = (
    registry: readonly HubDeviceInfo[],
    castHubId: string,
    selfHubId: string,
): boolean => {
    const row = registry.find((d) => d.id === castHubId);
    if (!row || !row.online) return false;
    return row.bridgedBy !== selfHubId;
};

export interface ArbitrationInput {
    castHubId: string;
    /** When this bridge was created (ms). */
    createdAt: number;
    hubConnected: boolean;
    now: number;
    registry: readonly HubDeviceInfo[];
    selfHubId: string;
}

/** `reevaluate` (a `devices` emit) for a bridge standing down with no socket: claim now? */
export const reevaluateClaims = (input: ArbitrationInput): boolean =>
    !claimedElsewhere(input.registry, input.castHubId, input.selfHubId);

/** What `scheduleClaim`'s timer does once the stand-down window is over. */
export type ClaimStep = 'check-again-soon' | 'connect' | 'stand-down';

export const claimStep = (input: ArbitrationInput): ClaimStep => {
    // Don't decide on a registry we haven't been given yet (see REGISTRY_WAIT_MS).
    if (!input.hubConnected && input.now - input.createdAt < REGISTRY_WAIT_MS) {
        return 'check-again-soon';
    }
    if (claimedElsewhere(input.registry, input.castHubId, input.selfHubId)) return 'stand-down';
    return 'connect';
};
