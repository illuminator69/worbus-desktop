/**
 * The cast bridge's claim arbitration (PROTOCOL §12.2), out of index.ts so a harness can replay it
 * (B-107). Pure: the registry and the bridge's identity come in as arguments.
 *
 * The rule reads three answers, not two: the speaker is held by another client, it is free, or
 * this desktop does not know, because the main hub client has no registry from its current
 * connection (device-registry.ts). Unknown never claims; the bridge waits for the next registry,
 * which the main client's `devices` event delivers (navi-connect/CLAUDE.md §3: unknown is not
 * evidence). There is no time limit on that wait: the old 10 s bound (REGISTRY_WAIT_MS) only ever
 * covered a bridge's first 10 s, so a blip after that claimed at once (B-107), and since P3 a
 * bridge cannot dial without the main socket's live address anyway, so a hub that never connects
 * gives it nothing to claim with.
 */
import type { HubDeviceInfo } from '../hub/device-registry';

export type SpeakerHolder = 'free' | 'held' | 'unknown';

/**
 * Is another client already bridging this speaker? PROTOCOL §12.2 step 1. `castHubId` is the
 * speaker's hub device id, `selfHubId` this desktop's (our own previous socket is no competitor).
 */
export const speakerHolder = (
    registry: null | readonly HubDeviceInfo[],
    castHubId: string,
    selfHubId: string,
): SpeakerHolder => {
    if (registry === null) return 'unknown';
    const row = registry.find((d) => d.id === castHubId);
    if (!row || !row.online) return 'free';
    return row.bridgedBy !== selfHubId ? 'held' : 'free';
};

export interface ArbitrationInput {
    castHubId: string;
    registry: null | readonly HubDeviceInfo[];
    selfHubId: string;
}

const holder = (input: ArbitrationInput) =>
    speakerHolder(input.registry, input.castHubId, input.selfHubId);

/** `reevaluate` (a `devices` emit) for a bridge standing down with no socket: claim now? */
export const reevaluateClaims = (input: ArbitrationInput): boolean => holder(input) === 'free';

/** What `scheduleClaim`'s timer does once the stand-down window is over. */
export type ClaimStep = 'await-registry' | 'connect' | 'stand-down';

export const claimStep = (input: ArbitrationInput): ClaimStep => {
    const h = holder(input);
    if (h === 'unknown') return 'await-registry';
    return h === 'held' ? 'stand-down' : 'connect';
};
