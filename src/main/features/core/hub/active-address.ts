import type { InfoOutcome, InfoProbe, ServerRecordStore } from './addresses.ts';

import {
    admitsAddress,
    applyWelcomeServer,
    connectOrder,
    markAddressOk,
    probeTimeoutMs,
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
 * - **`url()`** feeds `getHubConfig().url`: the active address, else the first address in the
 *   order this launch has not seen answer as another server or as something else (so a sign-in
 *   works before the first connect).
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
    /** No socket at all (the transport stopped). */
    reset: () => void;
    /** What `getHubConfig().url` answers. Empty when there is nothing of this server to call. */
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

export const createActiveAddress = (deps: ActiveAddressDeps): ActiveAddress => {
    let active: null | string = null;
    /** This launch's last answer per address. */
    const verdicts = new Map<string, InfoOutcome>();
    /** `<address> <id>` pairs already logged as another server. */
    const loggedOther = new Set<string>();

    return {
        active: () => active,

        choose: async () => {
            const record = deps.records.current();
            for (const address of connectOrder(record)) {
                const outcome = await deps.probe(
                    address.url,
                    probeTimeoutMs(address.url),
                    record.serverId,
                );
                verdicts.set(address.url, outcome);
                if (admitsAddress(record, address, outcome)) {
                    if (outcome.kind === 'older' && record.serverId) {
                        deps.log.info(
                            `[hub] ${address.url} answers as an older Worbus Server; it last passed as this one - used without the check`,
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
        },

        closed: (url) => {
            if (active === url) active = null;
        },

        opened: (url) => {
            active = url;
        },

        reset: () => {
            active = null;
        },

        url: () => {
            if (active) return active;
            const usable = connectOrder(deps.records.current()).find((a) => {
                const kind = verdicts.get(a.url)?.kind;
                return kind !== 'otherServer' && kind !== 'notWorbus';
            });
            return usable?.url ?? '';
        },

        welcome: (url, server) => {
            const before = deps.records.current().serverId;
            const next = deps.records.update((record) =>
                markAddressOk(applyWelcomeServer(record, server), url, deps.now()),
            );
            return { after: next.serverId, before };
        },
    };
};
