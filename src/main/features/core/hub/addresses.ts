import type { HubServerRecord, InfoOutcome } from '../../../../shared/utils/hub-addresses.ts';

import {
    classifyInfoAnswer,
    EMPTY_HUB_SERVER_RECORD,
    httpBaseOfAddress,
    migrateFrom,
    normaliseHubAddress,
    parseHubServerRecord,
    removeAddress,
    withTyped,
} from '../../../../shared/utils/hub-addresses.ts';

export * from '../../../../shared/utils/hub-addresses.ts';

/**
 * Worbus P3 (design §6.3): main's half of the Worbus Server's addresses - the server record,
 * persisted as JSON under electron-store `hubServer`, and the `/hub/info` probe. The pure rules
 * (normaliser, private test, order, `welcome.server`, selection) are in
 * `shared/utils/hub-addresses.ts`, re-exported here, so the renderer reads the same ones.
 *
 * `hub.url` is not renamed or dropped: it keeps the address the person typed or tapped (never a
 * learned one), so a build rolled back to project 2 still works. This record is added beside it.
 *
 * Relative imports only (no Electron), so `addresses.harness.ts` runs it under `node --test`.
 */

/** electron-store key: the server record (JSON, design §6.3). Never a secret (§6.3, §4). */
export const HUB_SERVER_KEY = 'hubServer';

export interface ServerRecordStore {
    /** The record as it stands (the stored one before the first reconcile). */
    current: () => HubServerRecord;
    /**
     * Follow a push of the hub settings. The first one migrates `hub.url` when nothing is stored
     * (an unconfigured profile, the default address included, gets an empty record); after that a
     * configured address not in the record is added as `typed`. An unconfigured push ("no server
     * set": Connect off, no credential, the default address) forgets the server and its addresses,
     * keeping the Not now answers. M6: when the typed address changed (`previousUrl`), the
     * `typed` entry equal to the previous one is replaced, so typed addresses do not pile up.
     */
    reconcile: (url: string, configured: boolean, previousUrl?: string) => HubServerRecord;
    update: (change: (record: HubServerRecord) => HubServerRecord) => HubServerRecord;
}

export interface ServerRecordStoreDeps {
    /** Every change to the record, after it is stored (the `hub-server` IPC event). */
    onChange: (record: HubServerRecord) => void;
    /**
     * Review C1: the record's id was cleared or replaced (an address removal that forgot the
     * server, a found server with another id, an unconfigured push, a welcome naming another id).
     * That is a server change: the credential held for `from` must not be presented again.
     */
    onServerChange?: (from: string, to: null | string) => void;
    store: { get: (key: string) => unknown; set: (key: string, value: unknown) => void };
}

export const createServerRecordStore = (deps: ServerRecordStoreDeps): ServerRecordStore => {
    let record: HubServerRecord | null = null;
    const stored = () => parseHubServerRecord(deps.store.get(HUB_SERVER_KEY));

    const save = (next: HubServerRecord, force = false): HubServerRecord => {
        const before = record;
        const fromId = (before ?? stored())?.serverId ?? null;
        record = next;
        if (!force && before && JSON.stringify(before) === JSON.stringify(next)) return next;
        deps.store.set(HUB_SERVER_KEY, next);
        if (fromId !== null && next.serverId !== fromId)
            deps.onServerChange?.(fromId, next.serverId);
        deps.onChange(next);
        return next;
    };

    const current = (): HubServerRecord => record ?? stored() ?? EMPTY_HUB_SERVER_RECORD;

    return {
        current,
        reconcile: (url, configured, previousUrl) => {
            const first = record === null;
            const base = record ?? stored();
            let next = base ?? migrateFrom(url, configured);
            if (!configured) {
                if (next.addresses.length > 0 || next.serverId !== null) {
                    next = { ...EMPTY_HUB_SERVER_RECORD, promptDismissed: next.promptDismissed };
                }
            } else {
                const previous = previousUrl ? normaliseHubAddress(previousUrl) : null;
                const replaced =
                    previous !== null &&
                    previous !== normaliseHubAddress(url) &&
                    next.addresses.some((a) => a.url === previous && a.source === 'typed');
                // Through the removal rule: a replaced address that was the last one to pass
                // forgets the server (and `onServerChange` stops presenting its credential).
                if (replaced) next = removeAddress(next, previous);
                next = withTyped(next, url);
            }
            return save(next, first && base === null);
        },
        update: (change) => save(change(current())),
    };
};

export type InfoFetch = (
    url: string,
    init: {
        headers: Record<string, string>;
        method: 'GET';
        redirect: 'manual';
        signal: AbortSignal;
    },
) => Promise<{ status: number; text: () => Promise<string> }>;

export type InfoProbe = (
    base: string,
    timeoutMs: number,
    expectedId: null | string,
) => Promise<InfoOutcome>;

/**
 * `GET <base>/hub/info` and nothing else: no Authorization, no query, no body, no cookie, no
 * redirect followed (design §4: looking sends nothing but this). Refused, timed out or dropped is
 * `unreachable`.
 */
export const createInfoProbe =
    (fetchImpl: InfoFetch): InfoProbe =>
    async (base, timeoutMs, expectedId) => {
        const http = httpBaseOfAddress(base);
        if (!http) return { kind: 'unreachable' };
        try {
            const res = await fetchImpl(`${http}/hub/info`, {
                headers: { Accept: 'application/json' },
                method: 'GET',
                redirect: 'manual',
                signal: AbortSignal.timeout(timeoutMs),
            });
            return classifyInfoAnswer(res.status, await res.text(), expectedId);
        } catch {
            return { kind: 'unreachable' };
        }
    };

/** The probe on Node's own fetch. */
export const probeInfo: InfoProbe = createInfoProbe((url, init) => fetch(url, init));
