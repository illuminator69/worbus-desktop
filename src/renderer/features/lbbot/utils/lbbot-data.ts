import type {
    LbBotAlbumOverrideRow,
    LbBotListeningStatus,
    LbBotMergeRow,
    LbBotOverride,
    LbBotSiblingGroup,
    LbBotToCheck,
} from '/@/shared/types/lbbot-types';

/**
 * I-020 / I-021: wording and bookkeeping for the Library Matches page and the My Listening sync,
 * as pure functions (`lbbot-data.harness.ts` runs them).
 */

/** The override query's cached body: the map every resolver reads, plus the
 *  I-021 list. `toCheck: null` = the lb-bot sent no such field (older), which
 *  is NOT the same as an empty list. */
export interface OverridesData {
    /** I-022 album overrides; null = unknown (older lb-bot), [] = none. */
    albums: LbBotAlbumOverrideRow[] | null;
    byNdId: Record<string, LbBotOverride>;
    /** I-023 merges that can be undone; null = unknown, [] = none. */
    merges: LbBotMergeRow[] | null;
    /** I-023 same-MBID artist groups; null = unknown, [] = none. */
    siblings: LbBotSiblingGroup[] | null;
    toCheck: LbBotToCheck[] | null;
}

const listOrNull = <T>(value: unknown): null | T[] =>
    Array.isArray(value) ? (value as T[]) : null;

/** Tolerates a body persisted before these lists existed (a bare map, or no new fields). */
export const normalizeOverridesData = (raw: unknown): OverridesData => {
    if (raw && typeof raw === 'object' && 'byNdId' in raw) {
        const r = raw as Record<string, unknown>;
        return {
            albums: listOrNull(r.albums),
            byNdId: (r.byNdId && typeof r.byNdId === 'object'
                ? r.byNdId
                : {}) as OverridesData['byNdId'],
            merges: listOrNull(r.merges),
            siblings: listOrNull(r.siblings),
            toCheck: listOrNull(r.toCheck),
        };
    }
    const none = { albums: null, merges: null, siblings: null, toCheck: null };
    if (raw && typeof raw === 'object') {
        return { ...none, byNdId: raw as OverridesData['byNdId'] };
    }
    return { ...none, byNdId: {} };
};

/** Overrides by name, case-blind; a nameless (orphaned) one last. */
export const sortOverrides = (byNdId: Record<string, LbBotOverride>): LbBotOverride[] =>
    Object.values(byNdId).sort((a, b) => {
        if (!a.name !== !b.name) return a.name ? -1 : 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

/** What was measured, in words. It asserts "worth a look", never "wrong". */
export const describeToCheck = (row: Pick<LbBotToCheck, 'albums' | 'kind'>): string =>
    row.kind === 'unmatched'
        ? `lb-bot guessed a MusicBrainz artist that matches none of your ${row.albums} ${row.albums === 1 ? 'album' : 'albums'}`
        : 'No MusicBrainz artist found';

/**
 * The index mirror's last sync run, read-only (`getMirrorSyncState`). `id` counts
 * runs, so a caller can tell a run that began after its click from one that was
 * already over. `status` on a failure is the HTTP status the pull ended on (0 =
 * an IPC or storage failure, no HTTP answer).
 */
export interface MirrorSyncState {
    id: number;
    phase: 'failed' | 'finished' | 'idle' | 'running' | 'skipped';
    reason?: string;
    status?: number;
}

export interface SyncSnapshot {
    cursor: number;
    epoch: string;
    listening: LbBotListeningStatus | null;
    sync: MirrorSyncState;
}

const MIRROR_START_MS = 5000;
const LISTENING_GIVE_UP_MS = 20_000;

const describePullFailure = (status: number | undefined): string => {
    if (status === 503) return 'the hub is busy (503); it will retry';
    if (status === 404) return 'the hub does not serve the index feed (404)';
    if (status === 0 || status === undefined) return 'no answer from the hub, or a storage error';
    return `the hub answered ${status}`;
};

/**
 * What the index mirror has visibly done since a refresh was asked for. The click is
 * not the answer: the answer is the mirror's cursor moving, read from the same
 * source the rest of the app reads. This judges the pull's OWN outcome (a run that
 * started after the click), never a timeout: "up to date" only after a pull that
 * finished with the cursor unchanged. It says nothing about listens.
 */
export const mirrorReport = (
    before: SyncSnapshot,
    now: SyncSnapshot,
    elapsedMs: number,
): { done: boolean; text: string } => {
    let text: string;
    let done = true;
    const ownRun = now.sync.id > before.sync.id;
    if (now.epoch !== before.epoch) {
        text = 'Index mirror: lb-bot rebuilt its index, so the mirror started over.';
    } else if (now.cursor !== before.cursor) {
        text = `Index mirror moved: cursor ${before.cursor} to ${now.cursor}.`;
        // The pull may still be running; the cursor already moved, which is the answer.
    } else if (!ownRun) {
        if (elapsedMs < MIRROR_START_MS) {
            text = 'Index mirror: waiting for the pull to start...';
            done = false;
        } else {
            text =
                'Index mirror: no pull has started (one may be queued, or backing off after an earlier failure).';
        }
    } else if (now.sync.phase === 'running') {
        text = 'Index mirror: the pull is still running...';
        done = false;
    } else if (now.sync.phase === 'failed') {
        text = `Index mirror: the pull failed (${describePullFailure(now.sync.status)}). The mirror is unchanged.`;
    } else if (now.sync.phase === 'skipped') {
        text = `Index mirror: the pull was not run (${now.sync.reason || 'lb-bot is not available'}).`;
    } else {
        text = `Index mirror: already up to date (cursor ${now.cursor}).`;
    }
    return { done, text };
};

/**
 * What a listening sync has visibly done since it was asked for. `before` is a
 * status read taken right BEFORE the POST (null when that read failed); `now` is
 * the status as it is now (null when it cannot be read). "Synced" is only ever said
 * for `ready` with `lastSyncAt` moved past the baseline: a count or state
 * difference against a cached read proves nothing about this tap, and with no
 * baseline nothing can be proved at all. It says nothing about the mirror.
 */
export const listeningReport = (
    before: LbBotListeningStatus | null,
    now: LbBotListeningStatus | null,
    elapsedMs: number,
): { done: boolean; text: string } => {
    const a = before;
    const b = now;
    if (!b) return { done: true, text: 'Listening: no status from lb-bot.' };
    if (b.state === 'off') {
        return {
            done: true,
            text: 'Listening: lb-bot has no ListenBrainz user, so there is nothing to sync.',
        };
    }
    if (b.state === 'importing') {
        return {
            done: false,
            text:
                b.total !== null
                    ? `Listening: Importing ${b.count} of ${b.total}.`
                    : `Listening: Importing ${b.count} listens so far.`,
        };
    }
    if (b.state === 'error') {
        // lb-bot's `error` persists until the next success, which is exactly
        // when a user presses the button: a failure already there with the same
        // text and an unmoved lastSyncAt is the earlier one, not this tap's.
        const earlier =
            !!a && a.state === 'error' && a.error === b.error && a.lastSyncAt === b.lastSyncAt;
        if (!a || earlier) {
            if (elapsedMs < LISTENING_GIVE_UP_MS) {
                return { done: false, text: 'Listening: waiting for lb-bot...' };
            }
            return {
                done: true,
                text: a
                    ? `Listening: lb-bot still reports the earlier failure: ${b.error || 'no reason given'}.`
                    : 'Listening: could not confirm a sync (there was no earlier reading to compare with).',
            };
        }
        return { done: true, text: `Listening: the sync failed: ${b.error || 'no reason given'}.` };
    }
    if (a && b.lastSyncAt !== null && (a.lastSyncAt === null || b.lastSyncAt > a.lastSyncAt)) {
        return { done: true, text: `Listening: synced, ${b.count} listens stored.` };
    }
    if (elapsedMs < LISTENING_GIVE_UP_MS) {
        return { done: false, text: 'Listening: waiting for lb-bot...' };
    }
    return {
        done: true,
        text: a
            ? 'Listening: no change reported (already up to date, or lb-bot is still working).'
            : 'Listening: could not confirm a sync (there was no earlier reading to compare with).',
    };
};

/**
 * Both halves side by side - what the old single "Sync now" reported. The
 * surfaces no longer use it (Library Matches reports {@link mirrorReport}, My
 * Listening {@link listeningReport}); it stays as the composition the original
 * cases pin.
 */
export const syncReport = (
    before: SyncSnapshot,
    now: SyncSnapshot,
    listeningRequested: boolean,
    elapsedMs: number,
): { done: boolean; listening: string; mirror: string } => {
    const mirror = mirrorReport(before, now, elapsedMs);
    const listening = listeningRequested
        ? listeningReport(before.listening, now.listening, elapsedMs)
        : { done: true, text: '' };
    return { done: mirror.done && listening.done, listening: listening.text, mirror: mirror.text };
};

/** Whether an About body holds anything to show. `found` is not content: lb-bot
 *  always sends it, and `found: false` with nothing else is an empty answer. Worbus
 *  P1: Find it links are content (a missing album's only section may be them). */
export const metaHasContent = (
    meta:
        | null
        | undefined
        | {
              credits?: readonly unknown[];
              findIt?: readonly unknown[];
              links?: readonly unknown[];
              paragraphs?: readonly unknown[];
              relations?: { members?: readonly unknown[]; related?: readonly unknown[] };
              summary?: string;
              wikidataDescription?: string;
          },
): boolean =>
    !!meta &&
    !!(
        meta.summary ||
        meta.wikidataDescription ||
        meta.paragraphs?.length ||
        meta.links?.length ||
        meta.findIt?.length ||
        meta.credits?.length ||
        meta.relations?.members?.length ||
        meta.relations?.related?.length
    );

/**
 * The sentence under "Refresh About". `same` = the answer had content and equals
 * what was already shown; only then is "the same" true. An answer WITHOUT content
 * (`found: false` and nothing else, or no body) is never "Refreshed" and never
 * replaces a shown body.
 */
export const classifyRefresh = (
    result: {
        data?: Parameters<typeof metaHasContent>[0];
        error?: string;
        ok: boolean;
        status: number;
    },
    same: boolean,
): string => {
    if (result.ok) {
        if (!metaHasContent(result.data)) {
            return result.data === null
                ? 'lb-bot returned nothing. What is shown is unchanged.'
                : 'lb-bot found nothing this time. What is shown is unchanged.';
        }
        return same ? "Checked: lb-bot's answer is the same as what is shown." : 'Refreshed.';
    }
    if (result.status === 0) return 'Could not reach lb-bot. What is shown is unchanged.';
    return `lb-bot answered an error (${result.status})${result.error ? `: ${result.error}` : ''}. What is shown is unchanged.`;
};

/**
 * "Sync now"'s listening half failing. A 404 without a code or a 405 (an lb-bot
 * older than the hub answers an unknown POST with "method not allowed") means it
 * has no listening history yet: said as a fact about lb-bot, not as an error, and
 * never with the raw text.
 */
export const listeningSyncFailure = (result: {
    error?: string;
    status: number;
}): { message: string; older: boolean } =>
    result.status === 404 || result.status === 405
        ? { message: 'This lb-bot has no listening history yet.', older: true }
        : { message: result.error || 'lb-bot did not accept the request.', older: false };
