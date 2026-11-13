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
 * B-400: one server's sign-in, as a key: its address, user name and stored credentials. A sign-in
 * that worked writes new credentials, so the key changes; nothing else does.
 */
export const signInKey = (server: Omit<AskedServer, 'id'>): string =>
    JSON.stringify([
        server.url,
        server.username,
        server.credential ?? '',
        server.ndCredential ?? '',
    ]);

/**
 * B-400 (review M3): what one native request's answer says about this app's Navidrome session. The
 * start check asks Navidrome (`probeNativeSession`) rather than reading the token's expiry against
 * this computer's clock: 401 or 403 is a refusal, for whatever reason; 2xx is a session; anything
 * else (no answer, a server error) says nothing, and the start goes on as before.
 */
export const nativeProbeVerdict = (status: number | undefined): 'ok' | 'refused' | 'unknown' =>
    status === 401 || status === 403
        ? 'refused'
        : status !== undefined && status >= 200 && status < 300
          ? 'ok'
          : 'unknown';

/**
 * B-338: open the server's sign-in form for a refused session whose saved password cannot be read,
 * once per sign-in. After the person cancels it, later refused requests do not open it again (each
 * request still fails, nobody is logged out) until that server's sign-in changes: its address,
 * user name or stored credentials (a sign-in that worked writes new ones), or the app starts again.
 * The person can still open the form themselves from the server menu; the first suppressed ask
 * for a sign-in says so (`pointOnce`).
 */
export const createPasswordAsk = <S extends AskedServer>(
    open: (server: S, closed: () => void) => void,
    pointOnce?: (server: S) => void,
): ((server: S) => boolean) => {
    // Per server id: the sign-in last asked for, whether its form is still open, and whether its
    // suppression was pointed out. Memory only; never logged.
    const asked = new Map<string, { open: boolean; pointed: boolean; signIn: string }>();
    return (server) => {
        const signIn = signInKey(server);
        const last = asked.get(server.id);
        if (last?.signIn === signIn) {
            // Fix round 4: while the form is open, a refusal of the same sign-in joins it (several
            // 401s arrive together). After it closed, the first one says where to sign in.
            if (!last.open && !last.pointed) {
                last.pointed = true;
                pointOnce?.(server);
            }
            return false;
        }
        const entry = { open: true, pointed: false, signIn };
        asked.set(server.id, entry);
        open(server, () => {
            entry.open = false;
        });
        return true;
    };
};

/** The parts of a server entry that say which sign-in a refusal or an expiry is about. */
export interface SignInOf {
    credential?: string;
    id: string;
    ndCredential?: string;
}

/**
 * Fix round 4 (2026-11-12): the refused request was sent under another sign-in than the current
 * one (no credential, or an older bearer, while a newer sign-in is current). Its 401 says nothing
 * about the current session: it fails, and nobody is logged out. With nothing current, or a current
 * server holding no session, a refusal is a real one, as before.
 */
export const sentWithAnotherSignIn = (
    sentAuthorization: unknown,
    current: null | Pick<SignInOf, 'ndCredential'> | undefined,
): boolean =>
    Boolean(current?.ndCredential) && sentAuthorization !== `Bearer ${current?.ndCredential}`;

/**
 * Fix round 4: whether an expiry decided for `refused` (debounced in the Navidrome path) still
 * applies when it runs. Not for a refusal made while logged out (no server), nor when the current
 * server is another one or the same one signed in again meanwhile (new credentials). With nothing
 * current any more, it still clears the refused server's entry, as before.
 */
export const expiryStillApplies = (
    refused: null | SignInOf | undefined,
    current: null | SignInOf | undefined,
): boolean => {
    if (!refused) return false;
    if (!current) return true;
    return (
        current.id === refused.id &&
        (current.ndCredential ?? '') === (refused.ndCredential ?? '') &&
        (current.credential ?? '') === (refused.credential ?? '')
    );
};
