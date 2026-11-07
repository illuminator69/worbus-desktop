import { createHash } from 'node:crypto';

/**
 * Worbus P5 (design §6.9): Discord presence runs on Worbus's own Discord application, never on
 * upstream's. The owner creates it (step D); until then the ID is empty and presence is off. A
 * person's own Application ID (Settings) always wins. Free of Electron, so
 * `application-id.harness.ts` runs it under `node --test`.
 */
export const WORBUS_DISCORD_APPLICATION_ID = '';

/**
 * Upstream's Application ID was the old app's default `clientId`, so every profile copied from it
 * carries it as if a person had typed it. It counts as unset. Held as its SHA-256, so the ID itself
 * appears nowhere in the source.
 */
const UPSTREAM_DEFAULT_SHA256 = 'c0e322f540f79c017809f0abfb2639d57bfa1b3f1500186c981931c9a0396dbf';
const isUpstreamDefault = (id: string) =>
    createHash('sha256').update(id).digest('hex') === UPSTREAM_DEFAULT_SHA256;

let saidOff = false;

/** Log in to Discord as `userClientId`, else as Worbus's application; null when there is none. */
export const connectDiscord = async <
    C extends { destroy: () => Promise<unknown>; login: () => Promise<unknown> },
>(
    userClientId: string | undefined,
    deps: { create: (clientId: string) => C; log: { info: (line: string) => void } },
): Promise<C | null> => {
    const own = userClientId?.trim() ?? '';
    const clientId = own && !isUpstreamDefault(own) ? own : WORBUS_DISCORD_APPLICATION_ID;
    if (!clientId) {
        if (!saidOff) {
            saidOff = true;
            deps.log.info(
                'Discord presence is off: Worbus has no Discord application yet (an Application ID set in Settings would be used)',
            );
        }
        return null;
    }
    const client = deps.create(clientId);
    try {
        await client.login();
    } catch (error) {
        // Never handed out, so nobody else would close it.
        await client.destroy().catch(() => undefined);
        throw error;
    }
    return client;
};
