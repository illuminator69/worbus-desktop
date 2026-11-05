/**
 * Worbus P3: the Worbus Server's addresses (design §6.3). Pure and import-free, so main (the
 * transport, the finder) and the renderer (the Server tab) share one rule, and the harnesses run
 * it under `node --test`.
 *
 * A client keeps one server record: the server's id and name once a `welcome` has said them, and
 * its addresses - `typed` by the person, `found` by looking, `learned` from `welcome.server`. Every
 * address is stored normalised; the path is kept, and every derived URL appends to it
 * (`<base>/hub/info`, `<base>/hub/signin`, `<base>/lb/...`, the socket `<base>`).
 */

/** Feishin's stored default (`hub.url`). Looks like a value but means "never set" (design §6.3). */
export const DEFAULT_HUB_URL = 'ws://localhost:4790';

/** The Worbus Server's one port, where looking probes. */
export const HUB_PORT = 4790;

export const PRIVATE_PROBE_TIMEOUT_MS = 1500;
export const PUBLIC_PROBE_TIMEOUT_MS = 5000;

export type AddressSource = 'found' | 'learned' | 'typed';

export interface HubAddress {
    /** Wall-clock ms this address last passed (its `/hub/info` and its socket); null never. */
    lastOkAt: null | number;
    source: AddressSource;
    url: string;
}

/** The record each client persists, as JSON (Feishin: electron-store `hubServer`). */
export interface HubServerRecord {
    addresses: HubAddress[];
    /** The `learned` address is switched off ("Use away from home" off). */
    learnedOff: boolean;
    name: null | string;
    /** `serverId`s (or, for an older server, addresses) whose prompt was answered Not now. */
    promptDismissed: string[];
    serverId: null | string;
}

export const EMPTY_HUB_SERVER_RECORD: HubServerRecord = {
    addresses: [],
    learnedOff: false,
    name: null,
    promptDismissed: [],
    serverId: null,
};

export type AddressClass = 'private' | 'public' | 'tailscale';

/** Main's finder, as the Server tab reads it (`hub-finder-state`). No `NeedsPermission` here. */
export interface HubFinderState {
    kind: 'idle' | 'looking' | 'nothingBeside' | 'nothingOnNetwork' | 'notOnWifi' | 'results';
    results: HubFound[];
    scope: 'beside' | 'home' | 'network' | null;
}

/** What looking found (design §6.4): a server by id, an older one by address, a plain-text one. */
export type HubFound =
    | { address: string; kind: 'notEncrypted' }
    | { address: string; kind: 'olderAt' }
    | { addresses: string[]; kind: 'server'; name: string; serverId: string };

export const IDLE_FINDER: HubFinderState = { kind: 'idle', results: [], scope: null };

/** Main's `hub-server` event and `hub-server-state` answer: the record and the live socket's address. */
export interface HubServerState {
    activeAddress: null | string;
    record: HubServerRecord;
}

/** What one `GET <base>/hub/info` said, judged against the id the record holds. */
export type InfoOutcome =
    | { kind: 'match'; name: string; serverId: string }
    | { kind: 'notWorbus' }
    | { kind: 'older' }
    | { kind: 'otherServer'; serverId: string }
    | { kind: 'unreachable' };

const SERVER_ID = /^[0-9a-f]{32}$/;
const SCHEMES: Record<string, string> = { http: 'ws', https: 'wss', ws: 'ws', wss: 'wss' };

/**
 * Trim; no scheme becomes `ws://`; `http(s)://` becomes `ws(s)://`; a trailing `/`, then
 * `/connect`, then `/` again is dropped (controller ruling: `…/connect/` loses both); the path is
 * kept. Null for an empty value, another scheme, or no host.
 */
export const normaliseHubAddress = (raw: string): null | string => {
    const value = raw.trim();
    if (value === '') return null;
    const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
    let scheme = 'ws';
    let rest = value;
    if (match) {
        const mapped = SCHEMES[match[1].toLowerCase()];
        if (!mapped) return null;
        scheme = mapped;
        rest = value.slice(match[0].length);
    } else if (value.includes('://')) {
        return null;
    }
    // M1: no `?query` or `#fragment` - a derived URL appends to the base, and a token pasted
    // into a query must never be stored or logged as part of an address.
    rest = rest
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
        .replace(/\/connect$/, '')
        .replace(/\/+$/, '');
    // No `user:password@`: nothing the person typed into an address is ever sent or stored as one.
    rest = rest.replace(/^[^/]*@/, '');
    const slash = rest.indexOf('/');
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    if (!authority) return null;
    try {
        if (!new URL(`${scheme}://${authority}`).hostname) return null;
    } catch {
        return null;
    }
    return `${scheme}://${rest}`;
};

/** `ws(s)://…` → `http(s)://…`, path kept; null when the address does not normalise. */
export const httpBaseOfAddress = (address: string): null | string => {
    const base = normaliseHubAddress(address);
    return base ? base.replace(/^ws/, 'http') : null;
};

/** The host of an address (IPv6 without brackets), lower-cased; null when it does not parse. */
export const hostOfAddress = (address: string): null | string => {
    const base = normaliseHubAddress(address);
    if (!base) return null;
    try {
        return new URL(base).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    } catch {
        return null;
    }
};

/** `host[:port]` of an address, as a person reads it ("192.168.1.20", "hub.example.com"). */
export const displayAddress = (address: string): string => {
    const base = normaliseHubAddress(address);
    return base ? base.replace(/^wss?:\/\//, '') : address;
};

const ipv4Of = (host: string): null | number[] => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    return parts.every((n) => n <= 255) ? parts : null;
};

/** The first 16 bits of an IPv6 address; null when it is not one. */
const ipv6Head = (host: string): null | number => {
    if (!host.includes(':')) return null;
    if (host.startsWith('::')) return 0;
    const head = host.split(':')[0];
    return /^[0-9a-f]{1,4}$/.test(head) ? parseInt(head, 16) : null;
};

/** Classify an IPv4 address (four octets). */
export const classifyIpv4 = ([a, b]: number[]): AddressClass => {
    if (a === 127 || a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 169 && b === 254) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'tailscale';
    return 'public';
};

/**
 * The private test, on the address's host (design §6.3): loopback, RFC 1918, link-local, `::1`,
 * `fc00::/7`, `fe80::/10`, `localhost` and `*.local` are private; `100.64.0.0/10` and `*.ts.net`
 * are Tailscale, which counts as private; everything else, any other DNS name included, is public.
 */
export const classifyHubAddress = (address: string): AddressClass => {
    const host = hostOfAddress(address);
    if (!host) return 'public';
    const v4 = ipv4Of(host);
    if (v4) return classifyIpv4(v4);
    if (host === '::1') return 'private';
    const head = ipv6Head(host);
    if (head !== null) {
        if ((head & 0xfe00) === 0xfc00) return 'private';
        if ((head & 0xffc0) === 0xfe80) return 'private';
        return 'public';
    }
    if (host === 'localhost' || host.endsWith('.local')) return 'private';
    if (host.endsWith('.ts.net')) return 'tailscale';
    return 'public';
};

/** Private or Tailscale: a plain `ws://` there may carry a credential. */
export const isPrivateAddress = (address: string): boolean =>
    classifyHubAddress(address) !== 'public';

/** 1500 ms for a private address, 5000 ms for any other. */
export const probeTimeoutMs = (address: string): number =>
    isPrivateAddress(address) ? PRIVATE_PROBE_TIMEOUT_MS : PUBLIC_PROBE_TIMEOUT_MS;

/** Whether a found or learned address may be kept: private, or `wss://`. */
const carriesSafely = (url: string): boolean => url.startsWith('wss://') || isPrivateAddress(url);

/** "Is a server set", Feishin's way (design §6.4): never an empty-string test. */
export const hubConfiguredFrom = (s: {
    enabled: boolean;
    hasCredential: boolean;
    url: string;
}): boolean => s.enabled || s.hasCredential || (s.url.trim() !== '' && s.url !== DEFAULT_HUB_URL);

/**
 * Upgrade: today's typed address becomes the one `typed` entry, unless the hub was never
 * configured (Feishin's default `ws://localhost:4790`, judged by `isHubConfigured`).
 */
export const migrateFrom = (url: string, configured: boolean): HubServerRecord => {
    const typed = configured ? normaliseHubAddress(url) : null;
    if (!typed) return { ...EMPTY_HUB_SERVER_RECORD, addresses: [], promptDismissed: [] };
    return {
        ...EMPTY_HUB_SERVER_RECORD,
        addresses: [{ lastOkAt: null, source: 'typed', url: typed }],
        promptDismissed: [],
    };
};

/** A stored record, read defensively: allow-listed fields only, every url normalised. */
export const parseHubServerRecord = (raw: unknown): HubServerRecord | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const addresses: HubAddress[] = [];
    for (const item of Array.isArray(r.addresses) ? r.addresses : []) {
        const a = item as Record<string, unknown>;
        const url = typeof a?.url === 'string' ? normaliseHubAddress(a.url) : null;
        const source = a?.source;
        if (!url || (source !== 'typed' && source !== 'found' && source !== 'learned')) continue;
        if (addresses.some((x) => x.url === url)) continue;
        if (source === 'learned' && !url.startsWith('wss://')) continue;
        const lastOkAt = typeof a.lastOkAt === 'number' ? a.lastOkAt : null;
        addresses.push({ lastOkAt, source, url });
    }
    return {
        addresses,
        learnedOff: r.learnedOff === true,
        name: typeof r.name === 'string' ? r.name : null,
        promptDismissed: Array.isArray(r.promptDismissed)
            ? r.promptDismissed.filter((x): x is string => typeof x === 'string')
            : [],
        serverId: typeof r.serverId === 'string' && SERVER_ID.test(r.serverId) ? r.serverId : null,
    };
};

/**
 * The order addresses are tried in: private and Tailscale first, then the rest; within each, the
 * one that worked last first. A `learned` address is left out while `learnedOff`.
 */
export const connectOrder = (record: HubServerRecord): HubAddress[] =>
    record.addresses
        .filter((a) => !(a.source === 'learned' && record.learnedOff))
        .map((a, i) => ({ a, i, pub: isPrivateAddress(a.url) ? 0 : 1 }))
        .sort(
            (x, y) =>
                x.pub - y.pub ||
                (y.a.lastOkAt ?? -Infinity) - (x.a.lastOkAt ?? -Infinity) ||
                x.i - y.i,
        )
        .map(({ a }) => a);

/**
 * `welcome.server` = `{id, name, publicUrl?}`: fills the id and name, and adds, replaces or
 * removes the one `learned` entry. Only a `wss://` address is ever learned (`https://` is the same
 * thing). A malformed `server` returns the record unchanged.
 */
export const applyWelcomeServer = (record: HubServerRecord, server: unknown): HubServerRecord => {
    if (typeof server !== 'object' || server === null) return record;
    const s = server as Record<string, unknown>;
    if (typeof s.id !== 'string' || !SERVER_ID.test(s.id)) return record;
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : null;
    const learnedUrl = typeof s.publicUrl === 'string' ? normaliseHubAddress(s.publicUrl) : null;
    const learnable =
        learnedUrl !== null &&
        learnedUrl.startsWith('wss://') &&
        !record.addresses.some((a) => a.url === learnedUrl && a.source !== 'learned');
    const previous = record.addresses.find((a) => a.source === 'learned');
    const others = record.addresses.filter((a) => a.source !== 'learned');
    const addresses = learnable
        ? [
              ...others,
              {
                  lastOkAt: previous?.url === learnedUrl ? previous.lastOkAt : null,
                  source: 'learned' as const,
                  url: learnedUrl,
              },
          ]
        : others;
    return { ...record, addresses, name, serverId: s.id };
};

/**
 * `GET /hub/info`'s answer: 426 or 404 is an older server (a project 2 hub answers every plain GET
 * with the handshake's 426); a 200 with `service: "worbus"` and an id is this server, or another
 * one when the record knows a different id; anything else is not a Worbus Server.
 */
export const classifyInfoAnswer = (
    status: number,
    body: string,
    expectedId: null | string,
): InfoOutcome => {
    if (status === 426 || status === 404) return { kind: 'older' };
    if (status !== 200) return { kind: 'notWorbus' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { kind: 'notWorbus' };
    }
    const p = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
        string,
        unknown
    >;
    if (p.service !== 'worbus' || typeof p.serverId !== 'string' || !SERVER_ID.test(p.serverId)) {
        return { kind: 'notWorbus' };
    }
    if (expectedId && p.serverId !== expectedId) {
        return { kind: 'otherServer', serverId: p.serverId };
    }
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Worbus Server';
    return { kind: 'match', name, serverId: p.serverId };
};

/**
 * Whether the device secret may go to this address after this probe (design §6.3): a match with
 * this server's id; or, for an older answer (426/404), a `typed` or `found` address - when the
 * record knows an id, only one that last passed WITH that id (a rollback, or a proxy that passes
 * only upgrades; `welcome` clears every other address's `lastOkAt` when the id is first learned or
 * changes), never a `learned` one. Another server's id and no answer: never. Not a Worbus Server:
 * only a `typed` address while no id is known (M5: project 2 dialled a typed address blindly, and
 * a proxy in front of it may answer `/hub/info` with a page or a 5xx) - never a found or learned
 * one, never once an id is known.
 */
export const admitsAddress = (
    record: HubServerRecord,
    address: HubAddress,
    outcome: InfoOutcome,
): boolean => {
    switch (outcome.kind) {
        case 'match':
            return record.serverId === null || outcome.serverId === record.serverId;
        case 'notWorbus':
            return record.serverId === null && address.source === 'typed';
        case 'older':
            if (address.source === 'learned') return false;
            return record.serverId === null || address.lastOkAt !== null;
        default:
            return false;
    }
};

/** The first address in `connectOrder` whose probe admits it; null for none. */
export const selectAddress = (
    record: HubServerRecord,
    outcomes: ReadonlyMap<string, InfoOutcome>,
): HubAddress | null =>
    connectOrder(record).find((a) => {
        const outcome = outcomes.get(a.url);
        return outcome !== undefined && admitsAddress(record, a, outcome);
    }) ?? null;

/** Per-server data's key: `id:<serverId>` once known, else the address (an older server). */
export const serverKey = (record: HubServerRecord, address: string): string =>
    record.serverId ? `id:${record.serverId}` : address;

/** This address passed now: its `lastOkAt`. */
export const markAddressOk = (
    record: HubServerRecord,
    url: string,
    now: number,
): HubServerRecord => ({
    ...record,
    addresses: record.addresses.map((a) => (a.url === url ? { ...a, lastOkAt: now } : a)),
});

/**
 * A `welcome` on `url`: the record follows `welcome.server` and `url` passed. Review I3: an
 * address's `lastOkAt` says it passed as THIS id; when the id is first learned or changes, what
 * the other addresses passed as is unknown, so theirs are cleared - the rollback fallback never
 * admits one that passed with no id or with another id.
 */
export const welcomeAt = (
    record: HubServerRecord,
    url: string,
    server: unknown,
    now: number,
): HubServerRecord => {
    const applied = applyWelcomeServer(record, server);
    const fresh =
        applied.serverId === record.serverId
            ? applied
            : {
                  ...applied,
                  addresses: applied.addresses.map((a) =>
                      a.url === url ? a : { ...a, lastOkAt: null },
                  ),
              };
    return markAddressOk(fresh, url, now);
};

/** The person's address, added as `typed` unless the record already holds it. */
export const withTyped = (record: HubServerRecord, raw: string): HubServerRecord => {
    const url = normaliseHubAddress(raw);
    if (!url) return record;
    const existing = record.addresses.find((a) => a.url === url);
    if (existing && existing.source !== 'learned') return record;
    return {
        ...record,
        addresses: [
            ...record.addresses.filter((a) => a.url !== url),
            { lastOkAt: null, source: 'typed', url },
        ],
    };
};

export interface FoundServer {
    addresses: string[];
    name: null | string;
    /** Null for an older server found by its 426 (offered by address only). */
    serverId: null | string;
}

/**
 * A tapped found server's addresses, saved as `found`. Another server's id starts a new record
 * (the Not now answers stay); the same id, or none known yet, merges. A plain `ws://` on a public
 * host is never kept (design §6.3).
 */
export const withFound = (record: HubServerRecord, found: FoundServer): HubServerRecord => {
    const urls = found.addresses
        .map((raw) => normaliseHubAddress(raw))
        .filter((url): url is string => url !== null && carriesSafely(url));
    const replace =
        found.serverId !== null && record.serverId !== null && found.serverId !== record.serverId;
    const base: HubServerRecord = replace
        ? { ...EMPTY_HUB_SERVER_RECORD, promptDismissed: record.promptDismissed }
        : record;
    const added = urls
        .filter((url, i) => urls.indexOf(url) === i && !base.addresses.some((a) => a.url === url))
        .map((url) => ({ lastOkAt: null, source: 'found' as const, url }));
    return {
        ...base,
        addresses: [...base.addresses, ...added],
        name: base.name ?? found.name,
        serverId: base.serverId ?? found.serverId,
    };
};

/**
 * Remove a `typed` or `found` address (a `learned` one is switched off instead). Once no address
 * left has ever passed, the record forgets which server it was: whatever is left is tried as a
 * new server, its id taken from the next welcome.
 */
export const removeAddress = (record: HubServerRecord, url: string): HubServerRecord => {
    const addresses = record.addresses.filter((a) => a.url !== url || a.source === 'learned');
    if (addresses.length === record.addresses.length) return record;
    if (addresses.some((a) => a.lastOkAt !== null)) return { ...record, addresses };
    return {
        ...record,
        addresses: addresses.filter((a) => a.source !== 'learned'),
        name: null,
        serverId: null,
    };
};

/** The Server tab's edits to the record (main's `hub-server-edit`). */
export type ServerEdit =
    | { found: FoundServer; op: 'adoptFound' }
    | { key: string; op: 'dismiss' }
    | { op: 'add'; url: string }
    | { op: 'learnedOff'; value: boolean }
    | { op: 'remove'; url: string };

const PROMPT_DISMISSED_MAX = 16;

/** One edit, applied; anything malformed changes nothing. */
export const applyServerEdit = (record: HubServerRecord, edit: unknown): HubServerRecord => {
    if (typeof edit !== 'object' || edit === null) return record;
    const e = edit as Record<string, unknown>;
    switch (e.op) {
        case 'add':
            return typeof e.url === 'string' ? withTyped(record, e.url) : record;
        case 'adoptFound': {
            const f = (e.found ?? {}) as Record<string, unknown>;
            if (!Array.isArray(f.addresses)) return record;
            return withFound(record, {
                addresses: f.addresses.filter((a): a is string => typeof a === 'string'),
                name: typeof f.name === 'string' ? f.name : null,
                serverId:
                    typeof f.serverId === 'string' && SERVER_ID.test(f.serverId)
                        ? f.serverId
                        : null,
            });
        }
        case 'dismiss':
            if (typeof e.key !== 'string' || !e.key || record.promptDismissed.includes(e.key)) {
                return record;
            }
            return {
                ...record,
                promptDismissed: [...record.promptDismissed, e.key].slice(-PROMPT_DISMISSED_MAX),
            };
        case 'learnedOff':
            return typeof e.value === 'boolean' ? { ...record, learnedOff: e.value } : record;
        case 'remove':
            return typeof e.url === 'string' ? removeAddress(record, e.url) : record;
        default:
            return record;
    }
};
