export interface FingerprintRequest {
    init: { body?: string; headers: Record<string, string>; method: 'GET' | 'POST' };
    url: string;
}

/**
 * The sonic-fingerprint request, as a pure function of the route (`fingerprint-request.harness.ts`).
 *
 * The core needs a Navidrome account to read play history. Through the hub it is injected
 * server-side from HUB_ND_USER/HUB_ND_PASS (a client-sent one would be dropped), so the hub route
 * stays a GET with `n` only. The direct route sends the account in a POST JSON body, never in the
 * URL, where AudioMuse's access log and any proxy's would keep the password (the desktop half of
 * B-359; AudioMuse 3.7.1 reads the same fields from a POST body). A field not set is left out and
 * the core falls back to its own account.
 */
export interface FingerprintRoute {
    base: string;
    token: string;
    viaHub: boolean;
}

export const fingerprintRequest = (
    ep: FingerprintRoute,
    args: { count: number; ndPassword: string; ndUser: string },
): FingerprintRequest => {
    const auth = { Authorization: `Bearer ${ep.token}` };
    if (ep.viaHub) {
        const url = new URL(`${ep.base}/sonic/fingerprint`);
        url.searchParams.set('n', String(args.count));
        return { init: { headers: auth, method: 'GET' }, url: url.toString() };
    }
    const body: Record<string, number | string> = { n: args.count };
    if (args.ndUser) body.navidrome_user = args.ndUser;
    if (args.ndPassword) body.navidrome_password = args.ndPassword;
    return {
        init: {
            body: JSON.stringify(body),
            headers: { ...auth, 'Content-Type': 'application/json' },
            method: 'POST',
        },
        url: `${ep.base}/api/sonic_fingerprint/generate`,
    };
};
