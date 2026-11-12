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
 * B-338: open the server's sign-in form for a refused session whose saved password cannot be read.
 * Today's rule, moved here unchanged for `session-refused.harness.ts`: every refusal opens it.
 */
export const createPasswordAsk = <S extends AskedServer>(
    open: (server: S) => void,
): ((server: S) => boolean) => {
    return (server) => {
        open(server);
        return true;
    };
};
