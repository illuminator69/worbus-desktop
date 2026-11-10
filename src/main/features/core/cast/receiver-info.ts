// navi-connect (I-032, I-033): what a Cast receiver says about itself, read for its row in the
// device picker. Pure, so both readings can be tested without a speaker (receiver-info.harness.ts);
// the bridge (index.ts) puts them on the wire.

/** What a cast row is, for `hello.device.kind`. */
export type CastKind = 'group' | 'speaker' | 'tv';

// Capability bits in `ca` of the `_googlecast._tcp` TXT record: the values of Android's
// `CastDevice.CAPABILITY_*` constants, and the two VLC's renderer discovery tells audio from
// video by.
const CAP_VIDEO_OUT = 1;
const CAP_AUDIO_OUT = 4;
const CAP_MULTIZONE_GROUP = 32;

/** A `_googlecast._tcp` service as bonjour-service hands it over. */
export interface CastService {
    addresses?: string[];
    name: string;
    port?: number;
    txt?: Record<string, string>;
}

/**
 * The kind of a receiver from its `ca` bits: a speaker group, else something with a picture (a
 * TV), else something with sound only (a speaker). Undefined when the record has no usable
 * `ca`, or names neither output: the row then gets the generic icon instead of a guess.
 */
export function castKind(ca: unknown): CastKind | undefined {
    const bits =
        typeof ca === 'number' ? ca : typeof ca === 'string' && /^\d+$/.test(ca) ? Number(ca) : NaN;
    if (!Number.isSafeInteger(bits) || bits < 0) return undefined;
    // A group is audio out as well; it is asked first.
    if (hasBit(bits, CAP_MULTIZONE_GROUP)) return 'group';
    if (hasBit(bits, CAP_VIDEO_OUT)) return 'tv';
    if (hasBit(bits, CAP_AUDIO_OUT)) return 'speaker';
    return undefined;
}

/**
 * The level (0..100) in the `volume` of a RECEIVER_STATUS - `{ level: 0..1, muted }`. A muted
 * receiver is at 0 whatever its level says. Null when it carries no level: nothing is reported
 * then, and the row keeps what it had.
 */
export function receiverLevel(volume: unknown): null | number {
    if (typeof volume !== 'object' || volume === null) return null;
    const { level, muted } = volume as { level?: unknown; muted?: unknown };
    if (muted === true) return 0;
    if (typeof level !== 'number' || !Number.isFinite(level)) return null;
    return Math.min(100, Math.max(0, Math.round(level * 100)));
}

/** The device a service names, or null when it has no address to dial. */
export function serviceToDevice(
    service: CastService,
): null | { host: string; id: string; kind: CastKind | undefined; name: string } {
    const txt = (service.txt ?? {}) as Record<string, string>;
    const host =
        service.addresses?.find((address) => address.includes('.')) ?? service.addresses?.[0];
    if (!host) return null;
    return {
        host,
        id: txt.id || service.name,
        // `ca`: the capability bits - a group, a TV or a speaker (receiver-info.ts).
        kind: castKind(txt.ca),
        name: txt.fn || service.name,
    };
}

// Not `&`: that works on 32 bits, and the record is a decimal string of whatever the device sent.
function hasBit(bits: number, bit: number): boolean {
    return Math.floor(bits / bit) % 2 === 1;
}
