import type { HubFinderState, HubServerState, ServerEdit } from '/@/shared/utils/hub-addresses';
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

/**
 * B-421: ask for a fresh `welcome` - call it once the page listens (`onMessage`). Once per page
 * load: a renderer reload runs this file again, a Fast Refresh or a re-subscription does not, so
 * only a page that lost its hub state makes the main process replace a socket it kept.
 */
let resynced = false;
const resync = () => {
    if (resynced) return;
    resynced = true;
    ipcRenderer.send('hub-resync');
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

/** P3: the record and active address now, then `onServer` for every change. */
const serverState = (): Promise<HubServerState> => ipcRenderer.invoke('hub-server-state');

/** P3: one edit to the server record (found tapped, address added or removed, switch, Not now). */
const serverEdit = (edit: ServerEdit): Promise<HubServerState> =>
    ipcRenderer.invoke('hub-server-edit', edit);

const onServer = (cb: (state: HubServerState) => void): (() => void) => {
    const handler = (_event: unknown, state: HubServerState) => cb(state);
    ipcRenderer.on('hub-server', handler);
    return () => ipcRenderer.removeListener('hub-server', handler);
};

/** P3: the current Navidrome server's `url` and `remoteUrl`, the hosts main may look beside. */
const setNavidromeUrls = (urls: string[]) => ipcRenderer.send('hub-navidrome-urls', urls);

/** P3: look beside Navidrome, on this network (a tap), or for a set server's home address. */
const finderLook = (
    scope: 'beside' | 'home' | 'network',
    urls: string[],
): Promise<HubFinderState> => ipcRenderer.invoke('hub-finder-look', scope, urls);

const finderCancel = () => ipcRenderer.send('hub-finder-cancel');

const finderState = (): Promise<HubFinderState> => ipcRenderer.invoke('hub-finder-state');

/** Worbus P5: the name this device goes by while none is saved (the computer's, else Worbus). */
const defaultName = (): Promise<string> => ipcRenderer.invoke('hub-default-name');

const onFinderState = (cb: (state: HubFinderState) => void): (() => void) => {
    const handler = (_event: unknown, state: HubFinderState) => cb(state);
    ipcRenderer.on('hub-finder-state', handler);
    return () => ipcRenderer.removeListener('hub-finder-state', handler);
};

const removeListeners = () => {
    ipcRenderer.removeAllListeners('hub-message');
};

export const hub = {
    authState,
    defaultName,
    finderCancel,
    finderLook,
    finderState,
    kick,
    onFinderState,
    onMessage,
    onServer,
    removeListeners,
    resync,
    send,
    serverEdit,
    serverState,
    setNavidromeUrls,
    setSettings,
    signIn,
    signOut,
};

export type Hub = typeof hub;
