import type { HubServerRecord } from '/@/shared/utils/hub-addresses';
import type { HubAuthState, HubSignInResult, SignInPair } from '/@/shared/utils/hub-signin';

import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for the navi-connect hub transport. The main process
 * passes raw protocol frames both ways; the renderer (use-hub.tsx) does all the
 * protocol work.
 */
const onMessage = (cb: (msg: any) => void): (() => void) => {
    const handler = (_event: unknown, data: string) => {
        try {
            cb(JSON.parse(data));
        } catch {
            /* ignore malformed frame */
        }
    };
    ipcRenderer.on('hub-message', handler);
    // Return a disposer that removes THIS handler only — removeAllListeners
    // would clobber any other subscriber and re-subscribing stacked duplicates.
    return () => ipcRenderer.removeListener('hub-message', handler);
};

const send = (obj: unknown) => {
    ipcRenderer.send('hub-send', obj);
};

/**
 * The network came back: have the transport look at its connection now instead of waiting out
 * its backoff or heartbeat. It decides what that means (main's `kick`); an open socket that
 * still answers is left alone.
 */
const kick = () => {
    ipcRenderer.send('hub-kick');
};

const setSettings = (
    enabled: boolean,
    url: string,
    token: string,
    name: string,
): Promise<null | string> => {
    return ipcRenderer.invoke('hub-settings', enabled, url, token, name);
};

/**
 * Worbus P2: sign this device in with the current Navidrome server's `u`/`s`/`t`. Main posts it to
 * the Worbus Server, keeps the device secret it gets back, and answers with the result only.
 */
const signIn = (pair: SignInPair): Promise<HubSignInResult> =>
    ipcRenderer.invoke('hub-signin', pair);

/**
 * Sign this device out of the Worbus Server and forget its secret. `reconnect: false` leaves the
 * transport down (a Navidrome logout); otherwise it reconnects with whatever credential is left.
 */
const signOut = (opts?: { reconnect?: boolean }): Promise<null> =>
    ipcRenderer.invoke('hub-signout', opts);

/** Whether a secret is held, kept in memory only, or owed after a restart. Never the secret. */
const authState = (): Promise<HubAuthState> => ipcRenderer.invoke('hub-auth-state');

/** P3: the server record and the address the live socket is on (null while none). */
export interface HubServerState {
    activeAddress: null | string;
    record: HubServerRecord;
}

/** P3: the record and active address now, then `onServer` for every change. */
const serverState = (): Promise<HubServerState> => ipcRenderer.invoke('hub-server-state');

const onServer = (cb: (state: HubServerState) => void): (() => void) => {
    const handler = (_event: unknown, state: HubServerState) => cb(state);
    ipcRenderer.on('hub-server', handler);
    return () => ipcRenderer.removeListener('hub-server', handler);
};

const removeListeners = () => {
    ipcRenderer.removeAllListeners('hub-message');
};

export const hub = {
    authState,
    kick,
    onMessage,
    onServer,
    removeListeners,
    send,
    serverState,
    setSettings,
    signIn,
    signOut,
};

export type Hub = typeof hub;
