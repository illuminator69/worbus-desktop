/**
 * B-338: what a server's saved password reads as. `unreadable` is a password that is saved but
 * could not be decrypted (the keyring key follows the app's name, so one the old app saved may
 * not read in Worbus; or the keyring itself changed). It is not "no password": the person's
 * credentials were not refused, this computer just cannot read them.
 */
export type SavedPassword =
    | { kind: 'none' }
    | { kind: 'ok'; password: string }
    | { kind: 'unreadable' };

/**
 * The music server refused this app's session (a 401 or 403). With a readable saved password the
 * app signs in again by itself; with an unreadable one it asks the person for the password and
 * changes nothing else (no logout, the saved password kept, the Worbus Server left signed in); with
 * none saved the session has expired, as before: the sign-in form, by logging out.
 */
export const whenSessionRefused = (
    saved: SavedPassword,
): 'askAgain' | 'expire' | 'reauthenticate' =>
    saved.kind === 'ok' ? 'reauthenticate' : saved.kind === 'unreadable' ? 'askAgain' : 'expire';

/** The parts of a server entry that say which sign-in an ask is for. */
export interface AskedServer {
    credential?: string;
    id: string;
    ndCredential?: string;
    url: string;
    username: string;
}

/**
 * B-338: open the server's sign-in form for a refused session whose saved password cannot be read,
 * once per sign-in. After the person cancels it, later refused requests do not open it again (each
 * request still fails, nobody is logged out) until that server's sign-in changes: its address,
 * user name or stored credentials (a sign-in that worked writes new ones), or the app starts again.
 * The person can still open the form themselves from the server menu.
 */
export const createPasswordAsk = <S extends AskedServer>(
    open: (server: S) => void,
): ((server: S) => boolean) => {
    // Per server id: the sign-in last asked for. Memory only; never logged.
    const asked = new Map<string, string>();
    return (server) => {
        const signIn = JSON.stringify([
            server.url,
            server.username,
            server.credential ?? '',
            server.ndCredential ?? '',
        ]);
        if (asked.get(server.id) === signIn) return false;
        asked.set(server.id, signIn);
        open(server);
        return true;
    };
};
