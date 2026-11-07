/**
 * navi-connect F7 (Task 4, Call 13): the states an artist's discography scan really has, read from
 * lb-bot's scan record and from the scan this session started.
 *
 * The hub caches `GET /lb/artist/discography` for 60 s and the scan's POST does not drop that cache,
 * so a read right after the press can be the pre-scan answer. A scan this session started is
 * therefore running until a record carrying its own task id says it ended, or five minutes pass.
 */

/** `unresolved` (Worbus P1): lb-bot indexed the artist but found no MusicBrainz artist for it. */
export type ScanPhase =
    | 'empty'
    | 'failed'
    | 'idle'
    | 'never'
    | 'running'
    | 'unavailable'
    | 'unresolved';

/** How long a scan this session started counts as running without a record that ends it. */
export const SCAN_WAIT_MS = 5 * 60 * 1000;

/** The hub's cache of the discography read (`PROXY_CACHE_TTL`), and a margin for the clocks. */
export const HUB_CACHE_MS = 60_000 + 5_000;

export interface ScanInput {
    /** lb-bot reachable through the hub. */
    available: boolean;
    indexed: boolean;
    /** The discography read has not answered yet (no mirror entry, no network answer). */
    loading: boolean;
    nowMs: number;
    /** The start request is in flight. */
    pending: boolean;
    /** When the network read carrying `scan` answered (ms), or null before one has. */
    readAtMs: null | number;
    releaseCount: number;
    /** From the network read only: the index mirror carries no scan record. */
    scan: null | ScanRecord;
    /** lb-bot can scan this artist (`scanScannable`). */
    scannable: boolean;
    started: null | { atMs: number; taskId: string };
    /** Worbus P1, from the network read only: indexed with no MusicBrainz match. Absent from an
     *  older lb-bot, which reads as false. */
    unresolved?: boolean;
}

export interface ScanRecord {
    /** Worbus P1: release groups read so far, of `total`; 0 of 0 when lb-bot sends no counts. */
    done?: number;
    error: string;
    state: 'done' | 'failed' | 'running';
    /** `auto-index` is lb-bot's background worker, which has no task row. */
    taskId: string;
    total?: number;
}

export const scanPhase = (input: ScanInput): ScanPhase => {
    const { scan, started } = input;
    if (input.pending || scan?.state === 'running') return 'running';
    if (started && input.nowMs - started.atMs < SCAN_WAIT_MS) {
        const ours = scan && scan.taskId === started.taskId ? scan : null;
        // No record of our task yet: a read the hub may still be serving from before the press says
        // nothing; one made later than its cache can hold means lb-bot no longer has the scan (a
        // restart keeps scan records in memory only), so the page rests instead of spinning on.
        const lost =
            !ours && input.readAtMs !== null && input.readAtMs - started.atMs > HUB_CACHE_MS;
        if (!ours && !lost) return 'running';
        if (ours?.state === 'failed') return 'failed';
    } else if (scan?.state === 'failed') {
        return 'failed';
    }
    // Not known yet is not "never scanned": nothing is said or offered until the read answers.
    if (!input.indexed && input.loading) return 'unavailable';
    if (!input.indexed) return input.available ? 'never' : 'unavailable';
    // Shown even when library albums fill the page (Worbus for Android ruling 6): lb-bot has nothing to add.
    if (input.unresolved) return 'unresolved';
    return input.releaseCount === 0 ? 'empty' : 'idle';
};

/** The poll while a scan runs: every 3 s for a P1 peer (its lb-bot sends counts), else 5 s. */
export const scanPollMs = (phase: ScanPhase, p1Peer = false): null | number =>
    phase === 'running' ? (p1Peer ? 3000 : 5000) : null;

/**
 * Whether lb-bot can scan this artist. An MBID and a name, as always; or, for a P1 peer, the
 * Navidrome artist id alone (Scan now by `nd_id`) - unless its lb-bot answered that it needs an
 * MBID after all (`isOlderScanRefusal`). The virtual `mb:` page has no Navidrome id to send.
 */
export const scanScannable = (input: {
    mbid: null | string | undefined;
    name: string;
    ndId: string;
    olderLbBot: boolean;
    p1Peer: boolean;
}): boolean => {
    if (input.mbid && input.name) return true;
    return (
        !input.mbid &&
        input.p1Peer &&
        !input.olderLbBot &&
        !!input.ndId &&
        !input.ndId.startsWith('mb:')
    );
};

const counts = new Intl.NumberFormat('en-US');

/** "6 of 10 done" while a scan with counts runs; null for the indeterminate bar. */
export const scanCountsText = (scan: null | ScanRecord): null | string =>
    scan?.state === 'running' && (scan.total ?? 0) > 0
        ? `${counts.format(Math.min(scan.done ?? 0, scan.total!))} of ${counts.format(scan.total!)} done`
        : null;

/**
 * What one visit to an artist page has seen of its scans (Worbus P1), for "Updated just now".
 * Stepped once per render by `nextScanVisit`; `justScanned` reads it.
 */
export interface ScanVisit {
    /** The `taskId` of a `done` record read before (or while) this visit saw a scan run: lb-bot
     *  keeps a record ten minutes, so that one is an older scan's end, not this visit's. */
    doneBefore: null | string;
    /** The artist's scannedAt (ms) at the first render after the discography answered; undefined
     *  until it has answered. */
    firstScannedAtMs: null | number | undefined;
    /** A `done` record (not `doneBefore`) was read after the phase left running. */
    sawDone: boolean;
    /** The phase read `running` at some point this visit. */
    sawRunning: boolean;
}

export const SCAN_VISIT_START: ScanVisit = {
    doneBefore: null,
    firstScannedAtMs: undefined,
    sawDone: false,
    sawRunning: false,
};

/** One render's step of the visit. Idempotent: the same input twice changes nothing. */
export const nextScanVisit = (
    visit: ScanVisit,
    input: {
        /** The discography read has answered (indexed or not). */
        answered: boolean;
        phase: ScanPhase;
        scan: null | ScanRecord;
        scannedAtMs: null | number;
    },
): ScanVisit => {
    const firstScannedAtMs =
        visit.firstScannedAtMs !== undefined || !input.answered
            ? visit.firstScannedAtMs
            : input.scannedAtMs;
    const sawRunning = visit.sawRunning || input.phase === 'running';
    const done = input.scan?.state === 'done' ? input.scan.taskId : null;
    // A done record read before any scan ran, or while one still runs, is an older scan's.
    const before = done !== null && (!sawRunning || input.phase === 'running');
    const doneBefore = before && !visit.sawDone ? done : visit.doneBefore;
    const sawDone = visit.sawDone || (done !== null && !before && done !== visit.doneBefore);
    return { doneBefore, firstScannedAtMs, sawDone, sawRunning };
};

/**
 * "Updated just now": a scan this visit saw run has REALLY finished - a record read `done`, or the
 * artist's scannedAt moved past the first value this visit read. Not after a start that failed, a
 * scan lb-bot lost or a wait that gave up. Only for a P1 peer: an older peer's line is unchanged.
 */
export const justScanned = (
    visit: ScanVisit,
    input: { p1Peer: boolean; phase: ScanPhase; scannedAtMs: null | number },
): boolean => {
    if (!input.p1Peer || !visit.sawRunning || input.phase === 'running') return false;
    if (visit.sawDone) return true;
    return (
        visit.firstScannedAtMs !== undefined &&
        (input.scannedAtMs ?? 0) > (visit.firstScannedAtMs ?? 0)
    );
};

const DAY_MS = 86_400_000;

const describeScan = (scannedAtMs: number, nowMs: number): string => {
    const days = Math.floor((nowMs - scannedAtMs) / DAY_MS);
    if (days <= 0) return 'Scanned today';
    if (days === 1) return 'Scanned yesterday';
    if (days < 30) return `Scanned ${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? 'Scanned a month ago' : `Scanned ${months} months ago`;
};

/** The one sentence each phase says. A failure is lb-bot's own sentence, verbatim. */
export const scanLine = (
    phase: ScanPhase,
    input: {
        /** Worbus P1: the running scan sends counts, so the bar says them. */
        counted?: boolean;
        error: string;
        /** A scan ran and ended during this visit: the idle line says so. */
        justScanned?: boolean;
        nowMs: number;
        scannable?: boolean;
        scannedAtMs: null | number;
        stale: boolean;
    },
): string => {
    switch (phase) {
        case 'empty':
            return 'lb-bot scanned this artist and found no releases. A rescan is idempotent if that looks wrong.';
        case 'failed':
            return input.error || 'The discography scan failed.';
        case 'idle':
            if (input.justScanned) return 'Updated just now';
            if (!input.scannedAtMs) return '';
            return `${describeScan(input.scannedAtMs, input.nowMs)}${input.stale ? ' · out of date' : ''}`;
        case 'never':
            return input.scannable === false
                ? "lb-bot needs this artist's MusicBrainz id and name to look up its releases."
                : 'Not scanned yet. Find missing albums looks up every release on MusicBrainz.';
        case 'running':
            return input.counted
                ? 'Looking up every release on MusicBrainz. You can leave this page; the scan keeps going.'
                : 'Looking up every release on MusicBrainz. This can take a minute and the count is unknown until it ends. You can leave this page; the scan keeps going.';
        case 'unresolved':
            return "lb-bot couldn't find this artist on MusicBrainz.";
        default:
            return '';
    }
};
