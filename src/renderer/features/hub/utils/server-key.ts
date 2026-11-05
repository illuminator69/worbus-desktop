import type { HubServerRecord } from '../../../../shared/utils/hub-addresses.ts';

import { serverKey } from '../../../../shared/utils/hub-addresses.ts';

/**
 * Worbus P3 (design §6.5): the key per-server data is kept under in the renderer - the lb-bot
 * mirror, the downloads mode per hub, the mood catalogue's query, the `lbStatus` reset. It is
 * `id:<serverId>` once the server has said its id, else the typed address (`hub.url`, raw, as
 * project 2 keyed it), so an older server keeps today's keys. It never reads the active address:
 * moving between home and away is the same server.
 *
 * Pure (relative imports only), so `server-key.harness.ts` runs it.
 */
export const serverKeyOf = (
    record: HubServerRecord | null | undefined,
    typedUrl: string,
): string => (record ? serverKey(record, typedUrl) : typedUrl);

/**
 * What a change of key means:
 * - `same`: nothing moved;
 * - `rekey`: the first welcome carrying `server.id` - the address key becomes the id key, and what
 *   was stored under the address is copied, never wiped;
 * - `moved`: another server (another id, or another address of an id-less older server) - the
 *   existing wipe rules apply as today.
 */
export const serverKeyMove = (previous: string, next: string): 'moved' | 'rekey' | 'same' => {
    if (previous === next) return 'same';
    if (!previous.startsWith('id:') && next.startsWith('id:')) return 'rekey';
    return 'moved';
};
