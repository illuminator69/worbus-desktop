export interface FingerprintRequest {
    init: { body?: string; headers: Record<string, string>; method: 'GET' | 'POST' };
    url: string;
}

/**
 * The sonic-fingerprint request, as a pure function of the route (`fingerprint-request.harness.ts`).
 * Today's rule, moved here unchanged: a GET with `n`; the direct route adds the Navidrome account
 * the core reads play history with as query parameters.
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
    const url = new URL(
        `${ep.base}${ep.viaHub ? '/sonic/fingerprint' : '/api/sonic_fingerprint/generate'}`,
    );
    url.searchParams.set('n', String(args.count));
    // The core needs Navidrome creds to read play history. Through the hub
    // they're injected server-side from HUB_ND_USER/HUB_ND_PASS (and a
    // client-sent one would be dropped), so only the direct route sends them.
    if (!ep.viaHub) {
        if (args.ndUser) url.searchParams.set('navidrome_user', args.ndUser);
        if (args.ndPassword) url.searchParams.set('navidrome_password', args.ndPassword);
    }
    return {
        init: { headers: { Authorization: `Bearer ${ep.token}` }, method: 'GET' },
        url: url.toString(),
    };
};
