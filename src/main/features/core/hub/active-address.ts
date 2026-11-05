import type { HubServerRecord, InfoOutcome, InfoProbe, ServerRecordStore } from './addresses.ts';

import {
    admitsAddress,
    connectOrder,
    httpBaseOfAddress,
    normaliseHubAddress,
    probeTimeoutMs,
    welcomeAt,
} from './addresses.ts';

/**
 * Worbus P3 (design §6.3): which address this device talks to its Worbus Server on.
 *
 * - **Choosing**, on every (re)connect: walk `connectOrder()`, probe each `GET /hub/info`, and hand
 *   the transport the first one the selection rule admits. Only that address ever receives the
 *   device secret: one that answers as another server is skipped (never removed, logged once).
 * - **The active address** is the live socket's base, set when it opens and cleared when it
 *   closes. Nothing here moves a socket: a network change, a new `welcome.server` and a newly
 *   found address only change what the NEXT choice sees.
 * - **`url()`** feeds `getHubConfig().url`: the active address only, else empty. Every bearer
 *   call reads it and fails soft on empty: no HTTP call carries the device secret to an address
 *   no probe passed (review C2).
 * - **`requestBase()`** is where sign-in and sign-out go: the active address, else a fresh choice
 *   (probe in order, the first admitted). With none, nothing is sent.
 *
 * Relative imports only, so `active-address.harness.ts` runs it.
 */

export interface ActiveAddress {
    active: () => null | string;
    /** Probe in order; the address to dial, or null when none passes. */
    choose: () => Promise<null | string>;
    /** The socket on `url` closed. */
    closed: (url: string) => void;
    /** The socket on `url` opened: it is the active address. */
    opened: (url: string) => void;
    /**
     * Where a sign-in or sign-out goes: the active address's `http(s)://` base, else the first
     * address a fresh choice admits; `noServer` when the record holds none, `unreachable` when
     * none passed.
     */
    requestBase: () => Promise<RequestBase>;
    /** No socket at all (the transport stopped). */
    reset: () => void;
    /** What `getHubConfig().url` answers: the live socket's address, else empty. */
    url: () => string;
    /**
     * A `welcome` arrived on `url`, with `server` (absent from an older hub): the id, the name and
     * the learned address follow it, and `url` passed. Returns the id before and after.
     */
    welcome: (url: string, server: unknown) => { after: null | string; before: null | string };
}

export interface ActiveAddressDeps {
    log: { info: (message: string) => void; warn: (message: string) => void };
    now: () => number;
    probe: InfoProbe;
    records: ServerRecordStore;
}

export type RequestBase = { base: string } | { kind: 'noServer' | 'unreachable' };

export const createActiveAddress = (deps: ActiveAddressDeps): ActiveAddress => {
    let active: null | string = null;
    /** `<address> <id>` pairs already logged as another server. */
    const loggedOther = new Set<string>();

    const choose = async (): Promise<null | string> => {
        const record = deps.records.current();
        for (const address of connectOrder(record)) {
            const outcome: InfoOutcome = await deps.probe(
                address.url,
                probeTimeoutMs(address.url),
                record.serverId,
            );
            if (admitsAddress(record, address, outcome)) {
                if (outcome.kind === 'older' && record.serverId) {
                    deps.log.info(
                        `[hub] ${address.url} answers as an older Worbus Server; it last passed as this one - used without the check`,
                    );
                }
                if (outcome.kind === 'notWorbus') {
                    deps.log.info(
                        `[hub] ${address.url} does not answer as a Worbus Server; typed, and no server known yet - dialled as before`,
                    );
                }
                return address.url;
            }
            if (outcome.kind === 'otherServer') {
                const key = `${address.url} ${outcome.serverId}`;
                if (!loggedOther.has(key)) {
                    loggedOther.add(key);
                    deps.log.warn(
                        `[hub] ${address.url} answers as another Worbus Server - skipped, nothing sent there`,
                    );
                }
            }
        }
        return null;
    };

    return {
        active: () => active,

        choose,

        closed: (url) => {
            if (active === url) active = null;
        },

        opened: (url) => {
            active = url;
        },

        requestBase: async () => {
            if (deps.records.current().addresses.length === 0) return { kind: 'noServer' };
            const url = active ?? (await choose());
            const base = url ? httpBaseOfAddress(url) : null;
            return base ? { base } : { kind: 'unreachable' };
        },

        reset: () => {
            active = null;
        },

        url: () => active ?? '',

        welcome: (url, server) => {
            const before = deps.records.current().serverId;
            const next = deps.records.update((record) =>
                welcomeAt(record, url, server, deps.now()),
            );
            if (before !== null && next.serverId !== before) {
                deps.log.warn(
                    `[hub] ${url} welcomed as another Worbus Server than the record held - the record follows it; the held credential is not sent again`,
                );
            }
            return { after: next.serverId, before };
        },
    };
};

/** One push of the hub settings, as `hub-settings` sees it (before and after). */
export interface SettingsPush {
    credentialMoved: boolean;
    enabled: { after: boolean; before: boolean };
    name: { after: string; before: string };
    recordMoved: boolean;
    url: { after: string; before: string };
}

/**
 * What a settings push does to the transport (review I2):
 * - `none`: nothing changed;
 * - `keep`: only the typed address moved (an address removed from the list that was `hub.url`),
 *   the new one is already in the record, and the live socket's address is still in it - the
 *   record was reconciled, and a working socket (the hub pauses a session when it closes,
 *   PROTOCOL §7) and the cast bridges stay;
 * - `restart`: anything else - the transport restarts and the bridges are rebuilt.
 */
export const settingsAction = (
    push: SettingsPush,
    ctx: { live: null | string; record: HubServerRecord },
): 'keep' | 'none' | 'restart' => {
    const urlMoved = push.url.before !== push.url.after;
    const othersSame =
        !push.credentialMoved &&
        push.enabled.before === push.enabled.after &&
        push.name.before === push.name.after;
    if (othersSame && !urlMoved && !push.recordMoved) return 'none';
    const inRecord = (url: null | string) =>
        url !== null && ctx.record.addresses.some((a) => a.url === url);
    if (
        othersSame &&
        urlMoved &&
        inRecord(ctx.live) &&
        inRecord(normaliseHubAddress(push.url.after))
    ) {
        return 'keep';
    }
    return 'restart';
};
