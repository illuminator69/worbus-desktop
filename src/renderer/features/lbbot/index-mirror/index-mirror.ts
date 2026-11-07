import type { MirrorSyncState } from '/@/renderer/features/lbbot/utils/lbbot-data';
import type { LbBotDiscography, LbBotIndexArtist, LbBotStatus } from '/@/shared/types/lbbot-types';

import { clear, createStore, entries, promisifyRequest, UseStore } from 'idb-keyval';
import isElectron from 'is-electron';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
    currentServerKey,
    serverRecordKnown,
} from '/@/renderer/features/hub/utils/current-server-key';
import { hubSecretHeld, hubSetUp } from '/@/renderer/features/hub/utils/hub-credential';
import {
    EMPTY_MIRROR_META,
    lookupByNdId,
    MirrorMeta,
    mirrorTotals,
    mirrorVerdict,
    ndIdsOf,
    PageDelta,
    pageSeqLookup,
    planDrift,
    planPage,
    toDiscography,
} from '/@/renderer/features/lbbot/index-mirror/mirror-logic';
import { gapCount } from '/@/renderer/features/library/library-model';
import { queryClient } from '/@/renderer/lib/react-query';
import { hubSetUpNow, useHubSetUp } from '/@/renderer/store/hub-set-up';
import { lbBotDownNow, useHubStore } from '/@/renderer/store/hub.store';
import { useSettingsStore } from '/@/renderer/store/settings.store';
import { logger } from '/@/renderer/utils/logger';
import { routeAdvertised } from '/@/shared/utils/lbbot-wire';

/**
 * A local copy of lb-bot's library index, kept current through the hub.
 *
 * PLAN-lbbot-index-mirror-2026-09-23 §5. lb-bot is the only writer of the index;
 * this mirror changes only when a page of its change feed says so, never from a
 * user action — anything optimistic (a fill in flight) stays in the fill ledger,
 * which this file does not touch.
 *
 * - **Storage.** A dedicated IndexedDB database (`lbbot-index`), apart from the
 *   react-query persister's default `idb-keyval` store: one record per artist,
 *   keyed by lb-bot's `artist_key`, plus one `$meta` record holding the cursor,
 *   the epoch and the envelope's `scanVersion`/`ttlDays`. A page is written in ONE
 *   IndexedDB transaction together with its cursor, so a crash mid-sync leaves
 *   either the whole page and its cursor or neither — never an artist half
 *   replaced, and never a cursor past rows that were not written.
 * - **Memory.** Loaded once into a Map keyed by artist key, with a second index
 *   by Navidrome artist id, so a lookup is synchronous and a page can render its
 *   missing albums in the same pass as Navidrome's own data.
 * - **Sync.** Triggered by every hub `welcome`, every `index` frame and a 15-min
 *   interval (all wired in `use-hub.tsx`); one sync in flight, a trigger during
 *   one queues exactly one more. The rules — seq-gated artist replace, resync,
 *   drift — are the pure functions in `mirror-logic.ts`.
 * - **Shown only while the hub is configured** (Ruling R21). Every read below
 *   answers nothing while the hub is switched off in settings or lacks a URL
 *   or a token — see {@link mirrorShown}. The store itself is kept.
 */

const lbBot = isElectron() ? window.api.lbBot : null;

/** Bump when the stored record shape changes; a mismatched store is discarded
 *  and pulled again from 0, which costs one full sync and nothing else.
 *  2 (B-014): `$meta` gained `hubUrl`, so a store from before this fix is
 *  correctly treated as "no hub identity recorded" and discarded rather than
 *  read with an absent field. */
const MIRROR_SCHEMA = 2;
/** Artist keys are MBIDs or `nd:<id>`; neither can begin with `$`. */
const META_KEY = '$meta';

/** The advertised-route string a hub serving the feed lists (`/lb/status`,
 *  `welcome.lb.routes`). */
export const INDEX_CHANGES_ROUTE = 'GET /lb/index/changes';

/** The backstop, for a notify missed while the hub or this app was away. */
const PERIODIC_SYNC_MS = 15 * 60 * 1000;

/** Back-off after a transient failure. After the last step the sync stops
 *  retrying and waits for the next trigger — at worst the 15-min interval. */
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000];
/** "Busy" (the hub's one-slot sync pool is taken), "unreachable", "timed out",
 *  and a request that never left this process. Anything else is an answer. */
const RETRYABLE_STATUSES = new Set([0, 502, 503, 504]);

/** A resync is answered by pulling from 0 under the new epoch; one that answers
 *  resync again at once means something is wrong upstream, not here. */
const MAX_RESYNCS_PER_SYNC = 2;

/** The hub URL setting, exactly as `use-hub.tsx` tracks it for R17 (raw
 *  string equality — a move is a move, not a normalised comparison). B-014's
 *  hub identity check is the same value for the same reason: the mirror and
 *  `lbStatus` both describe "the hub this app is currently pointed at". */
const currentHubUrl = (): string => useSettingsStore.getState().hub?.url ?? '';

/**
 * Worbus P3 (design §6.5): B-014's identity is the server key now (`id:<serverId>`, else the
 * address as before), so the same server at another address keeps its mirror and another id
 * still clears it (`mirrorVerdict`).
 */
const currentIdentity = () => ({
    hubUrl: currentHubUrl(),
    known: serverRecordKnown(),
    serverKey: currentServerKey(),
});

const identityStamp = (identity: { hubUrl: string; serverKey: string }) => ({
    hubUrl: identity.hubUrl,
    serverKey: identity.serverKey,
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const byKey = new Map<string, LbBotIndexArtist>();
const keysByNdId = new Map<string, Set<string>>();
let meta: MirrorMeta = EMPTY_MIRROR_META;
let loaded = false;

export interface IndexMirrorSnapshot {
    /** Number of artists mirrored. */
    artistCount: number;
    /** False until the stored mirror has been read into memory. A lookup that
     *  misses before then means "not read yet", not "not indexed". */
    loaded: boolean;
    meta: MirrorMeta;
    /** Moves on every change that could alter a lookup. */
    version: number;
}

let snapshot: IndexMirrorSnapshot = { artistCount: 0, loaded, meta, version: 0 };
const listeners = new Set<() => void>();

// Read-only record of the last sync RUN, for the settings panel's "Sync now" (it
// must report what the pull did, not guess from a timer). Deliberately outside
// the snapshot: a run starting must not look like a change that could alter a
// lookup. Nothing here feeds back into how the mirror syncs, retries or backs off.
let syncState: MirrorSyncState = { id: 0, phase: 'idle' };
const syncListeners = new Set<() => void>();
const setSyncState = (next: MirrorSyncState) => {
    syncState = next;
    for (const listener of syncListeners) listener();
};
export const getMirrorSyncState = (): MirrorSyncState => syncState;
export const subscribeMirrorSyncState = (listener: () => void): (() => void) => {
    syncListeners.add(listener);
    return () => {
        syncListeners.delete(listener);
    };
};

const notify = () => {
    snapshot = { artistCount: byKey.size, loaded, meta, version: snapshot.version + 1 };
    for (const listener of listeners) listener();
};

const indexNdIds = (artist: LbBotIndexArtist) => {
    for (const id of ndIdsOf(artist)) {
        const keys = keysByNdId.get(id) ?? new Set<string>();
        keys.add(artist.key);
        keysByNdId.set(id, keys);
    }
};

const unindexNdIds = (artist: LbBotIndexArtist) => {
    for (const id of ndIdsOf(artist)) {
        const keys = keysByNdId.get(id);
        if (!keys) continue;
        keys.delete(artist.key);
        if (keys.size === 0) keysByNdId.delete(id);
    }
};

const putInMemory = (artist: LbBotIndexArtist) => {
    const previous = byKey.get(artist.key);
    if (previous) unindexNdIds(previous);
    byKey.set(artist.key, artist);
    indexNdIds(artist);
};

const deleteInMemory = (key: string) => {
    const previous = byKey.get(key);
    if (!previous) return;
    unindexNdIds(previous);
    byKey.delete(key);
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let idb: null | UseStore = null;
// Opened on first use rather than at import, so a build that never touches
// lb-bot (the web build, no hub) never creates the database.
const store = (): UseStore => (idb ??= createStore('lbbot-index', 'mirror'));

interface StoredMeta extends MirrorMeta {
    schema: number;
}

const isStoredMeta = (value: unknown): value is StoredMeta => {
    const v = value as Partial<StoredMeta> | undefined;
    return (
        !!v &&
        v.schema === MIRROR_SCHEMA &&
        typeof v.cursor === 'number' &&
        typeof v.epoch === 'string' &&
        typeof v.hubUrl === 'string' &&
        (v.serverKey === undefined || typeof v.serverKey === 'string') &&
        typeof v.scanVersion === 'number' &&
        typeof v.ttlDays === 'number'
    );
};

const isStoredArtist = (value: unknown): value is LbBotIndexArtist => {
    const v = value as Partial<LbBotIndexArtist> | undefined;
    return !!v && typeof v.key === 'string' && typeof v.seq === 'number' && Array.isArray(v.rows);
};

let loading: null | Promise<void> = null;

/**
 * Read the stored mirror into memory, once. Every entry point awaits it, so a
 * sync can never start from an empty in-memory copy of a full store (which would
 * re-pull everything and, worse, compare its drift totals against nothing).
 *
 * A read failure leaves an empty mirror marked loaded: the next sync then pulls
 * from 0 and overwrites whatever the store held, and the drift check removes
 * anything the server no longer has.
 */
export const loadIndexMirror = (): Promise<void> => {
    loading ??= (async () => {
        // No Electron bridge (the web build): there is nothing to sync from, so
        // do not create a database just to report it empty.
        if (!lbBot) {
            loaded = true;
            notify();
            return;
        }
        try {
            const rows = await entries<IDBValidKey, unknown>(store());
            const storedMeta = rows.find(([key]) => key === META_KEY)?.[1];
            // B-014: a store built under a DIFFERENT hub URL is not this hub's
            // mirror, whatever its shape — reading it in would show the old
            // hub's library (and let the external-album route redirect into
            // it) under a hub that never built it. Empty `hubUrl` is a store
            // from before a page ever committed, or a genuinely unconfigured
            // hub; either way there is nothing to conflict with yet.
            // P3: by server key - the same id at another address is the same hub; a project 2
            // meta under the typed address is adopted (stamped at the next commit), not cleared.
            const verdict = isStoredMeta(storedMeta)
                ? mirrorVerdict(storedMeta, currentIdentity())
                : null;
            if (verdict === 'clear') {
                await clear(store());
            } else if (isStoredMeta(storedMeta)) {
                const identity = currentIdentity();
                meta = {
                    cursor: storedMeta.cursor,
                    epoch: storedMeta.epoch,
                    hubUrl: verdict === 'adopt' ? identity.hubUrl : storedMeta.hubUrl,
                    scanVersion: storedMeta.scanVersion,
                    serverKey: verdict === 'adopt' ? identity.serverKey : storedMeta.serverKey,
                    ttlDays: storedMeta.ttlDays,
                };
                for (const [key, value] of rows) {
                    if (key !== META_KEY && isStoredArtist(value)) putInMemory(value);
                }
            } else if (rows.length > 0) {
                // Written by another schema, or artists with no meta to say
                // which epoch they belong to. Neither can be trusted; start over.
                await clear(store());
            }
        } catch (error) {
            logger.error('[lbbot-index] could not read the stored mirror', { error });
        }
        loaded = true;
        notify();
    })();
    return loading;
};

/**
 * Write one page's delta and the new meta in a single IndexedDB transaction,
 * then — only once it has committed — apply the same to memory. Memory never
 * runs ahead of disk, so a failed write leaves both where they were and the
 * cursor unmoved.
 */
const commit = async (delta: PageDelta, next: MirrorMeta, wipe = false): Promise<void> => {
    await store()('readwrite', (os) => {
        if (wipe) os.clear();
        for (const artist of delta.puts) os.put(artist, artist.key);
        for (const key of delta.deletes) os.delete(key);
        const stored: StoredMeta = { ...next, schema: MIRROR_SCHEMA };
        os.put(stored, META_KEY);
        return promisifyRequest(os.transaction);
    });
    const envelopeChanged =
        next.epoch !== meta.epoch ||
        next.scanVersion !== meta.scanVersion ||
        next.ttlDays !== meta.ttlDays;
    if (wipe) {
        byKey.clear();
        keysByNdId.clear();
    }
    for (const artist of delta.puts) putInMemory(artist);
    for (const key of delta.deletes) deleteInMemory(key);
    meta = next;
    // The cursor alone moving changes nothing anyone renders.
    if (wipe || envelopeChanged || delta.puts.length > 0 || delta.deletes.length > 0) notify();
};

/**
 * B-014: repointing the hub URL must not leave the OLD hub's mirror standing —
 * `mirrorShown` only asks whether *a* hub is configured, which is still true
 * after a move, so nothing else would ever notice.
 *
 * Called from `use-hub.tsx` on the same URL-change effect that clears
 * `lbStatus` (R17), but only on an actual move: switching the hub off is a
 * DIFFERENT fact from switching to a different hub (R21 already hides the
 * mirror then, without deleting it, so it reappears at once when re-enabled).
 * A no-op until the stored mirror has been read — nothing to compare yet —
 * and then a no-op again if `meta.hubUrl` already agrees, which is the
 * common case: `pull()` stamps the current hub URL on every commit, so a
 * move that happens while this app is closed is instead caught by
 * `loadIndexMirror` reading the mismatch back in at the next launch.
 */
export const clearIndexMirrorForHubChange = (force = false): void => {
    void loadIndexMirror().then(() => {
        // Worbus P2: `force` - a Navidrome logout or account switch on the same hub. The mirror
        // was read under the old account and goes with it.
        if (!force) {
            const identity = currentIdentity();
            const verdict = mirrorVerdict(meta, identity);
            if (verdict === 'keep') return;
            // P3: the first welcome with the id - the same server's mirror, re-stamped, kept.
            if (verdict === 'adopt') {
                void commit({ deletes: [], puts: [] }, { ...meta, ...identityStamp(identity) });
                return;
            }
        }
        // Reset to the empty sentinel, not stamped with the new URL: no page
        // has been pulled under it yet, and `pull()` stamps it on the first
        // one that lands.
        void commit({ deletes: [], puts: [] }, EMPTY_MIRROR_META, true);
    });
};

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type IndexSyncTrigger = 'index' | 'interval' | 'retry' | 'welcome';

let running: null | Promise<void> = null;
let queued: IndexSyncTrigger | null = null;
let retryTimer: number | undefined;
let retryAttempt = 0;
/** The hub answered 404: it, or the lb-bot behind it, is older than the feed.
 *  Cleared on the next `welcome` (a hub can only get newer by reconnecting),
 *  and by lb-bot coming up or an `index` frame (a relayed 404 was lb-bot's own,
 *  and an upgraded lb-bot restarts without the hub socket noticing). */
let feedMissing = false;
/**
 * A `welcome` arrived while a sync was running, and its reset (above, and the
 * back-off) is owed to the run it queued — not applied on arrival.
 *
 * Applied on arrival, the reset landed on the wrong run: the sync already in
 * flight still ended by writing its own verdict over it — a 404 set
 * `feedMissing` again, a failure scheduled a retry from the back-off the
 * welcome had just zeroed — and the queued welcome pulled only because its
 * replay happened to pass through the reset a second time. Deferred, the old
 * connection's sync settles first and the welcome's reset is the last word by
 * construction, taken immediately before the pull it exists for (Ruling R17).
 */
let pendingWelcomeReset = false;

/** Forget the back-off: no retry pending, and the next failure starts the
 *  ladder again from its first step. */
const resetBackoff = () => {
    retryAttempt = 0;
    if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
    }
};

/** A `welcome` is new information about the hub: forget what the previous
 *  connection taught (a 404, a back-off) and pull from scratch. */
const applyWelcomeReset = () => {
    pendingWelcomeReset = false;
    feedMissing = false;
    resetBackoff();
};

/** The routes the hub advertises: `welcome.lb` when this hub sends it, else the
 *  `/lb/status` probe's answer for an older one. */
const advertisedRoutes = (): string[] | undefined =>
    useHubStore.getState().lbStatus?.routes ??
    queryClient.getQueryData<LbBotStatus>(['lbbot', 'status'])?.routes;

/** An empty or unknown list is an older hub that does not advertise: try, and
 *  let a 404 answer the question. Matches `useHubSupports`. */
const feedAdvertised = (): boolean => routeAdvertised(advertisedRoutes(), INDEX_CHANGES_ROUTE);

const scheduleRetry = (status: number) => {
    if (status === 404) {
        feedMissing = true;
        return;
    }
    // Not when the hub itself said lb-bot is down (or unconfigured): every retry
    // would fail the same way and log it. lb-bot announces itself when it comes
    // up — its index push at boot reaches this client as an `index` frame — and
    // the next welcome and the 15-min interval still pull.
    const hubSaysDown = lbBotDownNow();
    if (hubSaysDown || !RETRYABLE_STATUSES.has(status) || retryAttempt >= RETRY_DELAYS_MS.length) {
        retryAttempt = 0;
        return;
    }
    // Jittered, so two clients bounced off the same busy slot do not come back
    // in lockstep and collide again.
    const delay = RETRY_DELAYS_MS[retryAttempt] * (0.75 + Math.random() * 0.5);
    retryAttempt += 1;
    retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        requestIndexSync('retry');
    }, delay);
};

/**
 * One sync: pull pages until `more` is false, then check drift once.
 * Returns the HTTP status that stopped it, or null on success.
 */
const pull = async (): Promise<null | number> => {
    if (!lbBot) return null;
    let resyncs = 0;
    let driftChecked = false;
    // Q-010 (2): a resync is announced by an EARLIER round trip than the one
    // that actually carries the new epoch's first page. Committing the wipe
    // there — as this used to — blanked every tile for the gap between the
    // two requests. `cursor`/`epoch` track what this pull has adopted
    // LOCALLY; `meta` (and disk, and every reader) keeps showing the OLD
    // epoch's full data until a page with real content is ready to replace
    // it in the same transaction (`pendingWipe` below).
    let cursor = meta.cursor;
    let epoch = meta.epoch;
    let pendingWipe = false;
    // B-014 (review Important 1): the hub this pull is FOR, captured once —
    // never re-read as `currentHubUrl()` at commit time, which stamped
    // whatever hub happened to be configured when the response landed, not
    // the one that answered it. If the user repoints the hub mid-flight,
    // `clearIndexMirrorForHubChange` already wipes for the move; a page from
    // the OLD hub committing afterward with the NEW hub's URL would defeat
    // that wipe's own mismatch check forever. Guarded below, every time a
    // response lands.
    const hubUrl = currentHubUrl();
    // P3: the server this pull is for; a page that lands after it changed is not committed.
    const serverKey = currentServerKey();
    for (;;) {
        const since = cursor;
        const result = await lbBot.indexChanges(since, epoch);
        if (!result.ok || !result.data) {
            // The hub's own oversize-body 502 (B-013), not lb-bot being busy:
            // one artist's page is past PROXY_MAX_RESPONSE, every retry gets
            // the same answer, and RETRYABLE_STATUSES would otherwise back off
            // and try forever without ever saying why the mirror stopped
            // moving. Give up on THIS trigger the same way the resync and
            // drift loops below do — logged, and no retry scheduled — rather
            // than feed it to `scheduleRetry`.
            if (result.tooLarge) {
                logger.warn(
                    '[lbbot-index] lb-bot answered 502 tooLarge for the page at this cursor; the mirror will not advance past it until lb-bot trims that artist',
                    { epoch, since },
                );
                return null;
            }
            return result.status;
        }
        const page = result.data;

        // B-014 (review Important 1): the response just landed for `hubUrl`,
        // not necessarily the hub configured NOW. Abort without committing —
        // the new hub (if any) gets its own correctly-stamped pull from its
        // own welcome/interval trigger; there is nothing here worth keeping.
        if (currentServerKey() !== serverKey) return null;

        // `resync`, or a normal answer under an epoch that is not ours (which
        // lb-bot would itself have answered with resync, so this is defence
        // only): the only case that wipes. Adopt the new epoch, cursor 0, and
        // pull everything again — nothing committed yet, so the mirror still
        // shows the old epoch's data while this happens.
        if (page.resync || (epoch && page.epoch !== epoch)) {
            resyncs += 1;
            if (resyncs > MAX_RESYNCS_PER_SYNC) {
                logger.warn(
                    '[lbbot-index] lb-bot keeps answering resync; giving up until the next trigger',
                );
                return null;
            }
            cursor = 0;
            epoch = page.epoch;
            pendingWipe = true;
            continue;
        }

        await commit(
            // Review Critical 2: `pageSeqLookup` (mirror-logic.ts, harness-
            // tested) — while `pendingWipe` is true, `byKey` still holds the
            // OLD epoch's rows (the wipe is deferred into this same commit,
            // not applied yet), and planning a new epoch's page against an
            // unrelated epoch's held seqs silently drops it as a false no-op.
            planPage(pageSeqLookup(byKey, pendingWipe), page.items),
            {
                cursor: Math.max(cursor, page.nextSince),
                epoch: page.epoch,
                hubUrl,
                scanVersion: page.scanVersion,
                serverKey,
                ttlDays: page.ttlDays,
            },
            pendingWipe,
        );
        // Only the resync's FIRST real page wipes; the old data is gone the
        // moment this commit lands, together with (never before) its replacement.
        pendingWipe = false;
        cursor = Math.max(cursor, page.nextSince);
        epoch = page.epoch;

        if (page.more) {
            // `more` with a nextSince that did not move would loop forever.
            if (page.nextSince <= since) {
                logger.warn('[lbbot-index] a page said "more" without advancing; stopping');
                return null;
            }
            continue;
        }

        // Drift check, against the FINAL page's snapshot — never an earlier
        // page's, which a running bulk build would have moved past and turned
        // into a resync loop.
        const totals = mirrorTotals(byKey.values());
        if (totals.artistCount === page.artistCount && totals.seqSum === page.seqSum) return null;
        if (driftChecked) {
            logger.warn(
                `[lbbot-index] still differs after one reconcile (local ${totals.artistCount}/${totals.seqSum}, lb-bot ${page.artistCount}/${page.seqSum}); the next sync will try again`,
            );
            return null;
        }
        driftChecked = true;

        const keys = await lbBot.indexKeys();
        if (!keys.ok || !keys.data) return keys.status;
        // B-014: same guard as above — this response also crossed an await.
        if (currentServerKey() !== serverKey) return null;
        // A different epoch: the next changes read answers resync; loop to it.
        if (keys.data.epoch !== meta.epoch) continue;

        const local = new Map<string, number>();
        for (const [key, artist] of byKey) local.set(key, artist.seq);
        const plan = planDrift(local, keys.data.keys);
        await commit(
            { deletes: plan.deletes, puts: [] },
            {
                ...meta,
                // Only ever rewound: a differing key above the cursor is already
                // on its way through the normal pull.
                cursor: plan.rewindTo === null ? meta.cursor : Math.min(meta.cursor, plan.rewindTo),
            },
        );
        if (plan.rewindTo === null) return null;
        // Review Critical 3: the loop reads its OWN `cursor`/`epoch`, not
        // `meta`, at the top of the next iteration (`const since = cursor`).
        // Without this, the rewind above landed in `meta` and on disk but the
        // next request still went out at the old, high cursor — and that
        // page's own `Math.max(cursor, page.nextSince)` (above) then pushed
        // `meta.cursor` straight back up, so a missed update was never
        // actually re-pulled. Read back from `meta` rather than recomputing
        // the rewound value a second time: `commit()` above is the one place
        // that decides what was actually persisted, so it is the only source
        // the loop should trust for what to continue from.
        cursor = meta.cursor;
        epoch = meta.epoch;
    }
};

const runSync = async (): Promise<void> => {
    const runId = syncState.id + 1;
    setSyncState({ id: runId, phase: 'running' });
    if (pendingWelcomeReset) applyWelcomeReset();
    await loadIndexMirror();
    // Q-010 (3): two cases this used to attempt a doomed round trip for
    // rather than skip outright. `mirrorShown()` is R21 — the hub switched
    // off in settings, same as every read already refuses. The `available`
    // check is the hub's own verdict (`welcome.lb` / the `lb` frame) — an
    // unset LBBOT_URL and an unreachable lb-bot both answer `available:
    // false`, and `scheduleRetry` already suppresses a retry ladder against
    // it (`hubSaysDown`); this just stops the ONE request that would have
    // failed from firing at all. `undefined` (an older hub, or no welcome
    // yet) is NOT "down" — same "absence isn't evidence" rule as
    // `feedAdvertised` — so this only ever skips a hub that said so.
    if (
        !lbBot ||
        !useHubStore.getState().connected ||
        feedMissing ||
        !feedAdvertised() ||
        !mirrorShown() ||
        lbBotDownNow()
    ) {
        setSyncState({
            id: runId,
            phase: 'skipped',
            reason: !useHubStore.getState().connected
                ? 'not connected to the hub'
                : !mirrorShown()
                  ? 'the hub is switched off in settings'
                  : useHubStore.getState().lbRefused
                    ? 'lb-bot refused this hub'
                    : useHubStore.getState().lbTooOld
                      ? 'lb-bot is too old for this account'
                      : useHubStore.getState().lbStatus?.available === false
                        ? 'the hub reports lb-bot unavailable'
                        : 'this hub does not serve the index feed',
        });
        return;
    }
    let status: null | number;
    try {
        status = await pull();
    } catch (error) {
        // An IPC rejection or an IndexedDB write failure. Nothing was applied
        // past the last committed page, so this is a retry, not a repair.
        logger.error('[lbbot-index] sync failed', { error });
        status = 0;
    }
    setSyncState(
        status === null ? { id: runId, phase: 'finished' } : { id: runId, phase: 'failed', status },
    );
    // A pull that succeeded does NOT mark lb-bot available: that verdict is the
    // hub's alone (`welcome.lb` and the `lb` frame). Set here, it could stand
    // against a hub that still says down — and since the hub only broadcasts a
    // CHANGE of verdict, nothing would ever correct it once lb-bot really died.
    if (status === null) {
        retryAttempt = 0;
    } else {
        scheduleRetry(status);
    }
};

/**
 * Ask for a sync. Cheap to call often: one runs at a time, and a trigger that
 * arrives during one queues a single follow-up rather than a pile.
 *
 * While backing off after a failure, only a `welcome` jumps the queue — a new
 * socket is new information about the hub, where an `index` frame arriving
 * every two seconds during a bulk build is not a reason to hammer a hub that
 * just answered "busy". The pending retry will pull everything those frames
 * announced.
 */
export const requestIndexSync = (trigger: IndexSyncTrigger): void => {
    if (!lbBot) return;
    if (trigger === 'welcome') {
        if (running) {
            // Owed to the queued run, not applied now (see pendingWelcomeReset).
            // A welcome outranks whatever was queued, since it resets the back-off.
            pendingWelcomeReset = true;
            queued = 'welcome';
            return;
        }
        applyWelcomeReset();
    } else if (trigger !== 'retry' && retryTimer !== undefined) {
        return;
    }
    if (running) {
        if (queued !== 'welcome') queued = trigger;
        return;
    }
    running = runSync().finally(() => {
        running = null;
        const next = queued;
        queued = null;
        if (next) requestIndexSync(next);
    });
};

/**
 * lb-bot is known to be up (an `lb` frame with `available: true`, Ruling R22,
 * or an lb-bot call that just succeeded): pull now, whatever the sync learned
 * while it was down.
 *
 * `requestIndexSync('index')` alone would be dropped while a retry is pending —
 * right for a burst of `index` frames against a busy hub, wrong here: the
 * back-off was almost certainly earned while lb-bot was down, and this is the
 * news that ends it. Likewise a 404: behind a current hub it was lb-bot's own,
 * and the lb-bot that has just come up may be a newer one. So this is a
 * welcome's reset and pull exactly — deferred past a run in flight, as a
 * welcome's is, so that run cannot write its stale verdict over it.
 */
export const onLbBotAvailable = (): void => requestIndexSync('welcome');

/**
 * The hub's `{t: "index", seq, epoch}` frame: lb-bot's head moved.
 *
 * It is a hint to pull, and one this mirror may already have acted on — a page
 * that committed up to `seq` under the same epoch has everything the frame
 * announces, so that case is skipped. Anything else pulls. (It says lb-bot is
 * alive, but that verdict is the hub's to state: the inbound push that caused
 * this frame also flips the hub's own, which arrives as an `lb` frame.)
 */
export const onIndexFrame = (seq: number, epoch: string): void => {
    if (loaded && epoch === meta.epoch && seq <= meta.cursor) return;
    // Only an lb-bot serving the feed pushes its head, so the frame disproves an
    // earlier 404 — typically lb-bot upgraded behind a hub that stayed up.
    if (feedMissing) onLbBotAvailable();
    else requestIndexSync('index');
};

/**
 * Worbus P1: what the mirror has pulled up to, for telling a progress-only `index` frame from a
 * head move (`isProgressOnlyFrame`) - the same comparison {@link onIndexFrame} skips on. Null
 * before the stored mirror is read.
 */
export const indexMirrorCursor = (): null | { epoch: string; seq: number } =>
    loaded ? { epoch: meta.epoch, seq: meta.cursor } : null;

/** Mount once (from `useHub`): reads the stored mirror at startup and runs the
 *  15-minute backstop sync. */
export const useLbBotIndexSync = (): void => {
    useEffect(() => {
        if (!lbBot) return undefined;
        void loadIndexMirror();
        const timer = window.setInterval(() => requestIndexSync('interval'), PERIODIC_SYNC_MS);
        return () => window.clearInterval(timer);
    }, []);
};

// ---------------------------------------------------------------------------
// Reading the mirror — the API artist and `mb:` pages consume
// ---------------------------------------------------------------------------

/**
 * Whether the mirror is shown at all: the hub is switched on in settings and
 * has a URL and a credential (Ruling R21; Worbus P2: a device secret held, or a
 * typed token - hub-credential.ts) — the same definition as Worbus for Android's
 * `LbBotManager.isConfigured`, and as `hubRouteConfigured` in the AudioMuse
 * client here. A preference read, not a probe.
 *
 * A hub the user switched off, or never set up, means "forget what the hub
 * said" — the same principle that clears `lbStatus` on disable (R17b) — so
 * every surface falls back to exactly what it shows with no hub. What this
 * deliberately does NOT follow is `available`: lb-bot being down, or this
 * machine being offline, is the case the mirror exists for, and it still
 * renders then. Nothing is deleted either; the stored mirror stays in memory
 * and on disk, so switching the hub back on shows it again at once.
 */
export const mirrorShown = (): boolean => hubSetUpNow();

/** {@link mirrorShown} as a hook, re-rendering when it flips — for the lb-bot
 *  answers kept outside the mirror (react-query's persisted reads), which the
 *  same rule governs. */
export const useMirrorShown = (): boolean => useHubSetUp();

let watchingHubSetting = false;

/** Re-render every reader when {@link mirrorShown} flips. The setting lives in
 *  another store, so nothing else here would notice; one subscription for the
 *  module, set up by the first reader, fired only on a flip. */
const watchHubSetting = () => {
    if (watchingHubSetting) return;
    watchingHubSetting = true;
    useSettingsStore.subscribe(
        (state) => hubSetUp(state.hub, hubSecretHeld(useHubStore.getState())),
        () => notify(),
    );
    // Worbus P2: a sign-in (or a sign-out) flips it too, with no setting moving.
    useHubStore.subscribe((state, prev) => {
        if (hubSecretHeld(state) !== hubSecretHeld(prev)) notify();
    });
};

/** Called on every change that could alter a lookup. Subscribing starts the
 *  load if nothing has yet. */
export const subscribeIndexMirror = (listener: () => void): (() => void) => {
    listeners.add(listener);
    watchHubSetting();
    void loadIndexMirror();
    return () => {
        listeners.delete(listener);
    };
};

export const getIndexMirrorSnapshot = (): IndexMirrorSnapshot => snapshot;

/** Synchronous lookup by Navidrome artist id, in lb-bot's own order (see
 *  `lookupByNdId`). Pass the artist's MBID when the page has one. Nothing while
 *  the hub is not configured ({@link mirrorShown}). */
export const getMirrorArtistByNdId = (
    ndId: string,
    mbid?: null | string,
): LbBotIndexArtist | undefined =>
    mirrorShown() ? lookupByNdId(byKey, keysByNdId, ndId, mbid) : undefined;

/**
 * F6: the Library's "N with gaps" pill: how many of a library artist's indexed releases are
 * `incomplete`. Null when lb-bot has not indexed the artist or the hub is not configured
 * ({@link mirrorShown}): no pill, never "0 with gaps".
 */
export const mirrorArtistGaps = (ndId: string, mbid?: null | string): null | number => {
    const artist = getMirrorArtistByNdId(ndId, mbid);
    return artist ? gapCount(artist.rows) : null;
};

/**
 * F6: every mirrored artist with an MBID that names a Navidrome artist, for the Library's ownership
 * by MBID (an artist Navidrome holds without its own MBID tag can still own a MusicBrainz candidate).
 * Empty while the hub is not configured.
 */
export const mirrorLibraryArtists = (): { mbid: string; ndArtistId: string }[] => {
    if (!mirrorShown()) return [];
    const out: { mbid: string; ndArtistId: string }[] = [];
    for (const artist of byKey.values()) {
        if (artist.mbid && artist.ndArtistId) {
            out.push({ mbid: artist.mbid, ndArtistId: artist.ndArtistId });
        }
    }
    return out;
};

/** {@link mirrorLibraryArtists}, read again only when the mirror changes. */
export const useMirrorLibraryArtists = (): { mbid: string; ndArtistId: string }[] => {
    const version = useSyncExternalStore(
        subscribeIndexMirror,
        () => getIndexMirrorSnapshot().version,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => mirrorLibraryArtists(), [version]);
};

/** {@link mirrorArtistGaps} for one row, re-rendering only when its number changes. */
export const useMirrorGaps = (ndId: string, mbid?: null | string): null | number =>
    useSyncExternalStore(subscribeIndexMirror, () => mirrorArtistGaps(ndId, mbid));

/** A mirrored artist in the network discography read's shape (`scan: null`),
 *  with `stale` computed against the envelope the mirror last saw. */
export const mirrorDiscography = (artist: LbBotIndexArtist, nowMs = Date.now()): LbBotDiscography =>
    toDiscography(artist, meta, nowMs / 1000);

/**
 * The mirrored artist a Navidrome artist page shows, re-rendering only when that
 * answer changes (a stored artist object is replaced, never mutated, so identity
 * is the change signal). Undefined while the mirror loads, for an artist
 * lb-bot has not indexed, and for every artist while the hub is not configured
 * ({@link mirrorShown}) — check `getIndexMirrorSnapshot().loaded` to tell the
 * first apart from the second.
 */
export const useMirrorArtistByNdId = (
    ndId: string,
    mbid?: null | string,
): LbBotIndexArtist | undefined =>
    useSyncExternalStore(subscribeIndexMirror, () => getMirrorArtistByNdId(ndId, mbid));
