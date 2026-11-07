import type { HubFound, ServerEdit } from '../../../../shared/utils/hub-addresses.ts';

/**
 * Worbus P3 (design §6.4): one tap from found to signed in. Saves the found server's addresses as
 * `found` (an older one by its address), puts the tapped address in `hub.url`, turns Connect on,
 * and runs project 2's sign-in. A sweep still running stops first. Pure, so the harness runs it.
 */
export interface FoundTapDeps {
    edit: (edit: ServerEdit) => Promise<unknown>;
    setHub: (patch: { enabled: boolean; url: string }) => void;
    signIn: () => Promise<unknown>;
    stopLooking: () => void;
}

export const createFoundTap =
    (deps: FoundTapDeps) =>
    async (found: HubFound, address: string): Promise<void> => {
        if (found.kind === 'notEncrypted') return;
        deps.stopLooking();
        await deps.edit({
            found:
                found.kind === 'server'
                    ? { addresses: found.addresses, name: found.name, serverId: found.serverId }
                    : { addresses: [found.address], name: null, serverId: null },
            op: 'adoptFound',
        });
        deps.setHub({ enabled: true, url: address });
        await deps.signIn();
    };
