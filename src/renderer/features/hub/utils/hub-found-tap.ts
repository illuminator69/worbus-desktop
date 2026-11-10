import type { HubFound, ServerEdit } from '../../../../shared/utils/hub-addresses.ts';

import { normaliseHubAddress } from '../../settings/components/server/server-status.ts';

/**
 * Worbus P3 (design §6.4), B-330: the one rule for choosing a server while none is set, whichever
 * way it was chosen. A found row's tap and a typed address both save the address in the record
 * (found: its addresses as `found`; typed: as `typed`), put it in `hub.url`, turn Connect on and
 * run project 2's sign-in. A sweep still running stops first. The address is in the record before
 * the sign-in, which goes only to a recorded address. Pure, so the harness runs it.
 */
export interface ChooseServerDeps {
    edit: (edit: ServerEdit) => Promise<unknown>;
    setHub: (patch: { enabled: boolean; url: string }) => void;
    signIn: () => Promise<unknown>;
    stopLooking: () => void;
}

export type ServerChoice =
    | { address: string; found: HubFound; kind: 'found' }
    | { kind: 'typed'; raw: string };

/** What a choice saves and connects to; null when it chooses nothing. */
const chosen = (choice: ServerChoice): null | { edit: ServerEdit; url: string } => {
    if (choice.kind === 'typed') {
        // An empty field chooses nothing. A value the shared rule cannot read is kept as typed
        // (the record skips it), and the connection says it cannot reach it.
        if (choice.raw.trim() === '') return null;
        const url = normaliseHubAddress(choice.raw);
        return { edit: { op: 'add', url }, url };
    }
    const { address, found } = choice;
    if (found.kind === 'notEncrypted') return null;
    return {
        edit: {
            found:
                found.kind === 'server'
                    ? { addresses: found.addresses, name: found.name, serverId: found.serverId }
                    : { addresses: [found.address], name: null, serverId: null },
            op: 'adoptFound',
        },
        url: address,
    };
};

export const createChooseServer =
    (deps: ChooseServerDeps) =>
    async (choice: ServerChoice): Promise<void> => {
        const step = chosen(choice);
        if (!step) return;
        deps.stopLooking();
        await deps.edit(step.edit);
        deps.setHub({ enabled: true, url: step.url });
        await deps.signIn();
    };
