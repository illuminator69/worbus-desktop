import type { HubFound, InfoOutcome, InfoProbe } from './addresses.ts';

import {
    classifyIpv4,
    HUB_PORT,
    isPrivateAddress,
    normaliseHubAddress,
    probeTimeoutMs,
} from './addresses.ts';

/**
 * Worbus P3 (design §6.4): looking for the Worbus Server. Only `GET /hub/info` is ever sent, and
 * only to these:
 * 1. Navidrome's host (the current server's `url` and `remoteUrl`, handed over by the renderer),
 *    port 4790, over `http://`;
 * 2. when that host is a DNS name of at least three labels, `https://hub.<parent>` and
 *    `https://worbus.<parent>`;
 * 3. on a tap only, every address of this machine's own private IPv4 /24 (at most two real
 *    interfaces), port 4790: at most 32 at a time, 700 ms each, stopped at 10 s.
 *
 * Answers are grouped by `serverId`. A 426 counts only at Navidrome's host (an older Worbus Server
 * is probably there); a plain-text answer on a public host is reported as not encrypted, never
 * offered. Relative imports only, so `finder.harness.ts` runs it.
 */

export type Found = HubFound;

/** `os.networkInterfaces()`'s shape (`family` is a number on Node 18.0-18.3). */
export type NetInterfaces = Record<
    string,
    undefined | { address: string; family: number | string; internal: boolean }[]
>;

export const SWEEP_CONCURRENCY = 32;
export const SWEEP_PROBE_MS = 700;
export const SWEEP_CAP_MS = 10_000;
const MAX_INTERFACES = 2;

/** Interfaces that are not this machine's home network: containers, VMs, VPNs, tunnels. */
const VIRTUAL =
    /^(lo|docker|br-|veth|virbr|vmnet|vboxnet|tailscale|tun|tap|utun|zt|wg|cni|flannel|podman|lxc|lxd|vEthernet)/i;

const isIp = (host: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

/** The candidates beside Navidrome, in order: every host on 4790 first, then the siblings. */
export const candidatesFor = (urls: string[]): string[] => {
    const hosts: string[] = [];
    for (const raw of urls) {
        try {
            const host = new URL(raw.trim()).hostname.toLowerCase();
            if (host && !hosts.includes(host)) hosts.push(host);
        } catch {
            /* not a URL: nothing to look beside */
        }
    }
    const beside = hosts.map((host) => normaliseHubAddress(`http://${host}:${HUB_PORT}`));
    const siblings = hosts.flatMap((host) => {
        const labels = host.split('.');
        if (isIp(host) || labels.length < 3) return [];
        const parent = labels.slice(1).join('.');
        return [`https://hub.${parent}`, `https://worbus.${parent}`].map(normaliseHubAddress);
    });
    const all = [...beside, ...siblings].filter((url): url is string => url !== null);
    return all.filter((url, i) => all.indexOf(url) === i);
};

/** Navidrome's own host on 4790 (candidate 1): the only place a 426 is worth reporting. */
const atNavidromeHost = (url: string): boolean => url.startsWith('ws://');

const group = (answers: [string, InfoOutcome][], reportOlder: boolean): Found[] => {
    const servers = new Map<string, Extract<Found, { kind: 'server' }>>();
    const rest: Found[] = [];
    for (const [url, outcome] of answers) {
        if (outcome.kind === 'match') {
            if (url.startsWith('ws://') && !isPrivateAddress(url)) {
                rest.push({ address: url, kind: 'notEncrypted' });
                continue;
            }
            const known = servers.get(outcome.serverId);
            if (known) known.addresses.push(url);
            else {
                servers.set(outcome.serverId, {
                    addresses: [url],
                    kind: 'server',
                    name: outcome.name,
                    serverId: outcome.serverId,
                });
            }
        } else if (outcome.kind === 'older' && reportOlder && atNavidromeHost(url)) {
            rest.push({ address: url, kind: 'olderAt' });
        }
    }
    const olderFirst = (f: Found) => (f.kind === 'olderAt' ? 0 : 1);
    return [...servers.values(), ...rest.sort((a, b) => olderFirst(a) - olderFirst(b))];
};

/** Candidates 1 and 2 (design §6.4): found servers, an older one, a plain-text public one. */
export const lookBeside = async (urls: string[], probe: InfoProbe): Promise<Found[]> => {
    const candidates = candidatesFor(urls);
    const outcomes = await Promise.all(
        candidates.map((url) => probe(url, probeTimeoutMs(url), null)),
    );
    return group(
        candidates.map((url, i) => [url, outcomes[i]]),
        true,
    );
};

/**
 * This machine's own private IPv4 /24s (`a.b.c`), on at most two real interfaces: RFC 1918 only,
 * never loopback, link-local, Tailscale, a public address, or a container's, VM's or VPN's
 * interface. A /23 home network is swept as this machine's /24 only.
 */
export const ownSubnets = (interfaces: NetInterfaces): string[] => {
    const subnets: string[] = [];
    for (const [name, addresses] of Object.entries(interfaces)) {
        if (VIRTUAL.test(name)) continue;
        for (const a of addresses ?? []) {
            if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
            const octets = a.address.split('.').map(Number);
            if (octets.length !== 4 || classifyIpv4(octets) !== 'private') continue;
            if (octets[0] === 127 || (octets[0] === 169 && octets[1] === 254)) continue;
            const subnet = octets.slice(0, 3).join('.');
            if (!subnets.includes(subnet)) subnets.push(subnet);
        }
        if (subnets.length >= MAX_INTERFACES) break;
    }
    return subnets.slice(0, MAX_INTERFACES);
};

export interface SweepDeps {
    /** Stops the sweep (a sign-in tap): no probe starts after it says true. */
    cancelled?: () => boolean;
    interfaces: () => NetInterfaces;
    now: () => number;
    probe: InfoProbe;
}

export interface SweepResult {
    /** `notOnWifi`: no private address on a real interface - nothing was sent. */
    kind: 'notOnWifi' | 'results';
    results: Found[];
}

/** Candidate 3 (on a tap only): this machine's own /24, port 4790. Reports matches only. */
export const sweep = async (deps: SweepDeps): Promise<SweepResult> => {
    const subnets = ownSubnets(deps.interfaces());
    if (subnets.length === 0) return { kind: 'notOnWifi', results: [] };
    const hosts = subnets.flatMap((subnet) =>
        Array.from({ length: 254 }, (_, i) => `ws://${subnet}.${i + 1}:${HUB_PORT}`),
    );
    const deadline = deps.now() + SWEEP_CAP_MS;
    const answers: [string, InfoOutcome][] = [];
    let next = 0;
    const worker = async () => {
        while (next < hosts.length && !deps.cancelled?.()) {
            const left = deadline - deps.now();
            if (left <= 0) return;
            const url = hosts[next++];
            const outcome = await deps.probe(url, Math.min(SWEEP_PROBE_MS, left), null);
            if (outcome.kind === 'match') answers.push([url, outcome]);
        }
    };
    await Promise.all(Array.from({ length: SWEEP_CONCURRENCY }, worker));
    answers.sort(([a], [b]) => hosts.indexOf(a) - hosts.indexOf(b));
    return { kind: 'results', results: group(answers, false) };
};

/** "Find home address": the sweep, keeping only this server's id. */
export const findHomeAddress = async (
    serverId: string,
    deps: SweepDeps,
): Promise<null | string> => {
    const { results } = await sweep(deps);
    const same = results.find((f) => f.kind === 'server' && f.serverId === serverId);
    return same && same.kind === 'server' ? same.addresses[0] : null;
};

/**
 * A set server with no home address (design §6.4): candidate 1 only, silently, on a reconnect
 * over a home network. The private addresses that answer with this server's id.
 */
export const homeBesideNavidrome = async (
    urls: string[],
    serverId: string,
    probe: InfoProbe,
): Promise<string[]> => {
    const beside = candidatesFor(urls).filter(
        (url) => atNavidromeHost(url) && isPrivateAddress(url),
    );
    const outcomes = await Promise.all(
        beside.map((url) => probe(url, probeTimeoutMs(url), serverId)),
    );
    return beside.filter((_, i) => {
        const outcome = outcomes[i];
        return outcome.kind === 'match' && outcome.serverId === serverId;
    });
};
