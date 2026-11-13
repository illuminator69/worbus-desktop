import type { LbBotActivityRequest } from '../../../../shared/utils/lbbot-activity.ts';
import type { LbBotAttentionAlbum } from '../../../../shared/utils/lbbot-attention.ts';
import type { LedgerRow } from '../stores/active-fills.store.ts';

import { needsYou } from '../../sidebar/utils/sidebar-groups.ts';

/**
 * Activity's Need you: one set, one number, for the chip and the sidebar badge, from any client
 * (the owner, 2026-11-13: "no separation for requests between clients").
 *
 * Three sources, in the vocabulary each actually speaks (read in lb-bot's source, review H1):
 * - `/lb/activity`: lb-bot's album-fill LEDGER, every client's requests. Its states are the
 *   ledger's: searching, queued, downloading, placing, placed, verified, and the two side exits
 *   `failed` and `needs_match` - both need someone. Never `picking`. A gap fill writes a row only
 *   once its placement runs, so for a gap the row is the last fill that reached placement, not
 *   the gap's state now.
 * - `/lb/attention`'s `albums`: review groups whose own status is `failed` or `picking` NOW
 *   (`kind: gap`), and failed requests (`kind: request`). Another client's pick comes from here.
 * - this device's ledger (`useFillLedger`).
 *
 * Rows of one request are joined into one item (review L1): by release, by group, by release
 * group, and - only for a gap row lb-bot names but can no longer place in a group - by artist and
 * album. Then ONE state decides each item:
 * - lb-bot's side: the gap's own status (attention) when it lists one, unless a fill of it is in
 *   flight and newer (nobody has to pick while it runs); otherwise lb-bot's newest row. A finished
 *   fill row (verified, cancelled) never overrules a gap's status now: a partly filled gap still
 *   waits on a pick.
 * - lb-bot wins over this device's row only when its row is the NEWER state of the request
 *   (timestamps; review H1). A failure retried from another client and landed is done; this
 *   device's newer failure is not hidden by an older verified fill of the same group.
 * - a Dismiss (or Add to wishlist) here hides lb-bot's rows of that request that are not newer
 *   than the dismissal (review M1): they come back only as a newer state.
 * With no answer from lb-bot (an older one, a non-admin, not read yet) it is the ledger's set.
 *
 * Timestamps compare lb-bot's clock with this device's: the hub caches these reads up to 20 s,
 * so a `serverTime` correction would be off by as much as it corrects; on one LAN the clocks agree
 * well within a poll. For the same event the device always observes after lb-bot writes, so a
 * skew decides only between two states that already agree.
 */

/** A request this device dismissed (Dismiss, or Add to wishlist), remembered by its identity. */
export interface DismissedRequest {
    album: string;
    artist: string;
    /** Epoch ms, this device's clock. */
    at: number;
    groupId: string;
    isGap: boolean;
    releaseMbid: string;
    rgid: string;
}

export interface NeedYouInput<R extends NeedYouLedgerRow> {
    activity: null | readonly LbBotActivityRequest[];
    attention: null | readonly LbBotAttentionAlbum[];
    dismissed: readonly DismissedRequest[];
    ledger: readonly R[];
}

export interface NeedYouItem<R extends NeedYouLedgerRow> {
    /** Stable and unique: `here:<ledger key>` or `lb:<an identity of the request>`. */
    key: string;
    /** This device's row of the request (its buttons act on it); null when it holds none. */
    ledger: null | R;
    /** lb-bot's row when lb-bot's state decided; null when this device's did. */
    server: NeedYouServerEntry | null;
}

/** This device's row, as far as the join reads it. */
export type NeedYouLedgerRow = Pick<
    LedgerRow,
    | 'album'
    | 'artist'
    | 'groupId'
    | 'isGap'
    | 'key'
    | 'outcome'
    | 'releaseMbid'
    | 'rgid'
    | 'settled'
    | 'sortAt'
>;

/** One lb-bot row, from either read, in one shape. */
export interface NeedYouServerEntry {
    album: string;
    albumId: string;
    artist: string;
    failureKind: string;
    /** A gap: an attention `gap` row, or an activity row lb-bot names as a gap fill. */
    gap: boolean;
    groupId: string;
    reason: string;
    releaseMbid: string;
    retryable: boolean | null;
    rgid: string;
    source: 'activity' | 'attention';
    state: string;
    /** Epoch seconds, lb-bot's clock. */
    updatedAt: number;
}

/** The fill-ledger states of a fill in flight (`_album_fill_view`). */
const LIVE = new Set(['downloading', 'placed', 'placing', 'queued', 'searching']);

/** What lb-bot's state means for Need you: failed, waiting on a pick, or not needing anyone. */
export const serverOutcome = (state: string): 'failed' | 'needsPick' | null =>
    state === 'failed' || state === 'needs_match'
        ? 'failed'
        : state === 'picking'
          ? 'needsPick'
          : null;

const fromActivity = (req: LbBotActivityRequest): NeedYouServerEntry => ({
    album: req.album,
    albumId: req.albumId,
    artist: req.artist,
    failureKind: req.failureKind,
    gap: req.gapFill,
    groupId: req.groupId,
    reason: req.reason,
    releaseMbid: req.releaseMbid,
    retryable: req.retryable,
    rgid: req.rgid,
    source: 'activity',
    state: req.state,
    updatedAt: req.updatedAt,
});

const fromAttention = (album: LbBotAttentionAlbum): NeedYouServerEntry => ({
    album: album.album,
    albumId: album.albumId,
    artist: album.artist,
    failureKind: '',
    gap: album.kind === 'gap',
    groupId: album.groupId,
    reason: '',
    releaseMbid: album.releaseMbid,
    retryable: null,
    rgid: album.rgid,
    source: 'attention',
    state: album.state,
    updatedAt: album.updatedAt,
});

const norm = (s: string) => s.trim().toLowerCase();
const nameId = (artist: string, album: string): string =>
    artist.trim() && album.trim() ? `n:${norm(artist)}\u0000${norm(album)}` : '';

/** The identities a row is joined by; empty ids never join anything. */
const ids = (row: { groupId: string; releaseMbid: string; rgid: string }): string[] => [
    ...(row.releaseMbid ? [`r:${row.releaseMbid}`] : []),
    ...(row.groupId ? [`g:${row.groupId}`] : []),
    ...(row.rgid ? [`rg:${row.rgid}`] : []),
];

type Node<R> =
    | { dismissed: DismissedRequest; kind: 'dismissed' }
    | { entry: NeedYouServerEntry; kind: 'server' }
    | { kind: 'ledger'; row: R };

const newest = <T>(rows: T[], at: (row: T) => number): T | undefined =>
    rows.reduce<T | undefined>(
        (best, row) => (best === undefined || at(row) > at(best) ? row : best),
        undefined,
    );

const serverEntries = (
    activity: NeedYouInput<NeedYouLedgerRow>['activity'],
    attention: NeedYouInput<NeedYouLedgerRow>['attention'],
): NeedYouServerEntry[] => [
    ...(activity ?? []).map(fromActivity),
    ...(attention ?? []).map(fromAttention),
];

export const needYouItems = <R extends NeedYouLedgerRow>({
    activity,
    attention,
    dismissed,
    ledger,
}: NeedYouInput<R>): NeedYouItem<R>[] => {
    const server = serverEntries(activity, attention);
    // A gap lb-bot names but no longer holds a group for (`groupId` ""): joined by its names, and
    // only to a gap row here or a gap dismissal (review L1, P6).
    const orphanNames = new Set(
        server.filter((e) => e.gap && !e.groupId).map((e) => nameId(e.artist, e.album)),
    );
    orphanNames.delete('');
    const named = (isGap: boolean, artist: string, album: string): string[] => {
        const id = isGap ? nameId(artist, album) : '';
        return id && orphanNames.has(id) ? [id] : [];
    };

    const nodes: Node<R>[] = [
        ...ledger.map((row): Node<R> => ({ kind: 'ledger', row })),
        ...server.map((entry): Node<R> => ({ entry, kind: 'server' })),
        ...dismissed.map((d): Node<R> => ({ dismissed: d, kind: 'dismissed' })),
    ];
    const idsOf = (node: Node<R>): string[] => {
        if (node.kind === 'ledger') {
            const { row } = node;
            return [...ids(row), ...named(row.isGap, row.artist, row.album)];
        }
        if (node.kind === 'server') {
            const { entry } = node;
            return [
                ...ids(entry),
                ...(entry.gap && !entry.groupId ? named(true, entry.artist, entry.album) : []),
            ];
        }
        const d = node.dismissed;
        return [...ids(d), ...named(d.isGap, d.artist, d.album)];
    };

    // Union-find over the identities.
    const parent = nodes.map((_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const owner = new Map<string, number>();
    const nodeIds = nodes.map(idsOf);
    nodeIds.forEach((list, i) => {
        for (const id of list) {
            const j = owner.get(id);
            if (j === undefined) owner.set(id, i);
            else parent[find(i)] = find(j);
        }
    });
    const groups = new Map<number, number[]>();
    nodes.forEach((_, i) => {
        const root = find(i);
        groups.set(root, [...(groups.get(root) ?? []), i]);
    });

    const out: { at: number; item: NeedYouItem<R> }[] = [];
    for (const members of groups.values()) {
        const here: R[] = [];
        const theirs: NeedYouServerEntry[] = [];
        let dismissedAt = -Infinity;
        for (const i of members) {
            const node = nodes[i];
            if (node.kind === 'ledger') here.push(node.row);
            else if (node.kind === 'server') theirs.push(node.entry);
            else dismissedAt = Math.max(dismissedAt, node.dismissed.at);
        }
        // M1: what was there when this device dismissed the request stays dismissed here.
        const shownHere = here.filter((row) => row.sortAt > dismissedAt);
        const shownTheirs = theirs.filter((e) => e.updatedAt * 1000 > dismissedAt);
        const mine = newest(shownHere, (row) => row.sortAt);
        const gapNow = newest(
            shownTheirs.filter((e) => e.source === 'attention' && e.gap),
            (e) => e.updatedAt,
        );
        const live = newest(
            shownTheirs.filter((e) => e.source === 'activity' && LIVE.has(e.state)),
            (e) => e.updatedAt,
        );
        const lbbot = gapNow
            ? live && live.updatedAt > gapNow.updatedAt
                ? live
                : gapNow
            : newest(shownTheirs, (e) => e.updatedAt);
        const lbbotDecides = !!lbbot && (!mine || lbbot.updatedAt * 1000 > mine.sortAt);
        const counts = lbbotDecides
            ? serverOutcome(lbbot!.state) !== null
            : !!mine && needsYou(mine);
        if (!counts) continue;
        // A request this device holds no row of is keyed by its smallest identity: the same
        // request gives the same key on every read, whatever order lb-bot listed its rows in.
        const key = mine
            ? `here:${mine.key}`
            : `lb:${members.flatMap((i) => nodeIds[i]).sort()[0] ?? ''}`;
        out.push({
            at: lbbotDecides ? lbbot!.updatedAt * 1000 : mine!.sortAt,
            item: { key, ledger: mine ?? null, server: lbbotDecides ? lbbot! : null },
        });
    }
    return out.sort((a, b) => b.at - a.at || (a.item.key < b.item.key ? -1 : 1)).map((o) => o.item);
};

export const needYouCount = (input: NeedYouInput<NeedYouLedgerRow>): number =>
    needYouItems(input).length;

/**
 * The dismissals lb-bot still lists something for (review M1: "until lb-bot drops it"). Only a
 * full answer forgets one: with either read missing (not read yet, failed, an older lb-bot),
 * every dismissal is kept.
 */
export const dismissalsStillListed = (
    dismissed: readonly DismissedRequest[],
    activity: NeedYouInput<NeedYouLedgerRow>['activity'],
    attention: NeedYouInput<NeedYouLedgerRow>['attention'],
): DismissedRequest[] => {
    if (activity === null || attention === null) return [...dismissed];
    const listed = new Set(
        serverEntries(activity, attention).flatMap((e) => [
            ...ids(e),
            ...(e.gap && !e.groupId ? [nameId(e.artist, e.album)] : []),
        ]),
    );
    return dismissed.filter((d) =>
        [...ids(d), ...(d.isGap ? [nameId(d.artist, d.album)] : [])].some(
            (id) => id && listed.has(id),
        ),
    );
};

/**
 * A request only lb-bot knows, as a ledger row for `describeFill`: lb-bot's own words, settled,
 * no buttons of this device's (PROTOCOL §15.6).
 */
export const serverLedgerRow = (e: NeedYouServerEntry): LedgerRow => ({
    album: e.album,
    allFiles: false,
    artist: e.artist,
    attempts: 0,
    bytesDone: 0,
    bytesTotal: 0,
    cancellable: false,
    done: 0,
    failed: 0,
    failureKind: e.failureKind as LedgerRow['failureKind'],
    groupId: e.groupId,
    isGap: e.gap,
    key: e.releaseMbid || e.groupId,
    lastCheckedAt: 0,
    lastError: '',
    lastErrorTicks: 0,
    lastSourcePeer: '',
    leftOut: 0,
    mp3WouldHelp: false,
    otherSourceExcludes: [],
    outcome: serverOutcome(e.state) ?? 'failed',
    percent: 0,
    reason: e.reason,
    releaseMbid: e.releaseMbid,
    retryable: e.retryable ?? e.gap,
    retryAt: 0,
    rgid: e.rgid,
    settled: true,
    sortAt: e.updatedAt * 1000,
    speedBps: 0,
    stalledPlacement: false,
    state: e.state,
    total: 0,
    verifyGaveUp: false,
});

/**
 * The row an item is drawn as (review L3): from the state that decided it counts. This device's
 * row keeps its key, kind and peers - its buttons act on it - and takes lb-bot's state, words and
 * failure when lb-bot's newer row decided. null for a request only lb-bot knows (`serverLedgerRow`).
 */
export const drawnRow = (item: NeedYouItem<LedgerRow>): LedgerRow | null => {
    if (!item.ledger) return null;
    if (!item.server) return item.ledger;
    const e = item.server;
    return {
        ...item.ledger,
        attempts: 0,
        cancellable: false,
        failureKind: e.failureKind as LedgerRow['failureKind'],
        mp3WouldHelp: false,
        outcome: serverOutcome(e.state) ?? item.ledger.outcome,
        percent: 0,
        reason: e.reason,
        retryable: e.retryable ?? item.ledger.retryable,
        retryAt: 0,
        settled: true,
        sortAt: e.updatedAt * 1000,
        state: e.state,
        verifyGaveUp: false,
    };
};
