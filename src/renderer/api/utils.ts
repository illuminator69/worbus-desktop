import isElectron from 'is-electron';

import i18n from '/@/i18n/i18n';
import { useAuthStore } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { ServerListItem } from '/@/shared/types/types';
import { createPasswordAsk } from '/@/shared/utils/saved-password';

const localSettings = isElectron() ? window.api.localSettings : null;

const AUTH_FAILURE_TOAST_ID = 'auth-failure';

/**
 * B-338: what "ask for the password again" opens (the server's sign-in form), registered by the
 * app at start so the API layer does not import the UI.
 */
let askHandler: ((server: ServerListItem) => void) | null = null;

export const setAskForPassword = (ask: (server: ServerListItem) => void): void => {
    askHandler = ask;
};

/**
 * B-338: the session was refused and the saved password cannot be read here. Ask for it; log
 * nobody out, keep the saved password, leave the Worbus Server signed in.
 */
const askOnce = createPasswordAsk<ServerListItem>((server) => askHandler?.(server));

export const askForPasswordAgain = (server: null | ServerListItem): void => {
    if (server) askOnce(server);
};

export const authenticationFailure = (currentServer: null | ServerListItem, message?: string) => {
    const store = useAuthStore.getState();
    const serverId = currentServer?.id ?? store.currentServer?.id;

    toast.error({
        id: AUTH_FAILURE_TOAST_ID,
        message: message ?? (i18n.t('error.sessionExpiredError') as string),
    });

    if (!serverId) {
        return;
    }

    // B-338: the session token is a credential; it is not written to the console.
    console.error('token is expired');
    localSettings?.passwordRemove(serverId);

    // logout() clears credentials on the server list entry and sets currentServer to null.
    // If there is no current server, still clear the matching server list entry.
    if (store.currentServer) {
        store.actions.logout();
    } else {
        store.actions.updateServer(serverId, {
            credential: '',
            ndCredential: undefined,
            savePassword: false,
        });
    }
};
