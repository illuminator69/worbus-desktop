import { ipcMain } from 'electron';

import log from '/@/main/logger';
import { DiscoveredServerItem } from '/@/shared/types/types';

/**
 * B-382: the sign-in page's music-server discovery finds only servers Worbus signs in to, which
 * is Navidrome. Upstream Feishin's one probe was a Jellyfin UDP broadcast (`who is
 * JellyfinServer?` on 7359); it offered a server that leads nowhere, and is gone. Navidrome
 * answers no broadcast, so today this finds nothing and the page shows no found row; the Worbus
 * Server has its own finder (Settings, Server). A Navidrome probe would go here.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the reply a probe would call
function discoverAll(_reply: (server: DiscoveredServerItem) => void): Promise<void> {
    return Promise.resolve();
}

ipcMain.on('autodiscover-ping', (ev) => {
    if (ev.ports.length === 0) throw new Error('Expected a port to stream autodiscovery results');
    const port = ev.ports[0];

    discoverAll((result) => port.postMessage(result))
        .then(() => port.close())
        .catch((err) => log.error(err));
});
