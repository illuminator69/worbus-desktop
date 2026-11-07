import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { LbBotFailureKind, LbBotResolvedEdition } from '/@/shared/types/lbbot-types';

/**
 * The fill ledger: every download this client has asked lb-bot for, in flight and
 * finished, keyed by release-group id (or review-group id for a gap).
 *
 * A download outlives the sheet that started it by a long way — search, transfer,
 * placement and the Navidrome verify add up to minutes — so the watch cannot live
 * in the modal's own state. This is what keeps the artist page polling after the
 * sheet is closed, what puts a progress ring on the tile, and what tells the page
 * to re-read the discography once a fill lands.
 *
 * Persisted, because minutes is long enough to quit the app in. lb-bot's own
 * ledger is in memory, so a rehydrated fill may well find nothing on the other
 * end — but `unknown` is already the bounded-patience case in useLbBotFillStatus,
 * so that resolves itself in about ninety seconds instead of leaving the user
 * with an album that silently stopped being tracked.
 *
 * Settled rows used to be *deleted*, which made settling and never-having-happened
 * the same thing: a fill that failed while the modal was closed left no trace and
 * no way to ask why. They are now kept with their outcome for a week, which is
 * what the downloads view lists and what a retry re-issues from.
 */

/** How long a finished row stays readable, and how many are kept at all. */
const LEDGER_RETAIN_MS = 7 * 24 * 60 * 60 * 1000;
const LEDGER_MAX = 50;

export interface ActiveFill {
    /** Display fields, captured at the tap. The downloads view may be opened days
     *  later, on a page with no artist behind it, and by then lb-bot may have
     *  forgotten the fill entirely — its own record of these is in memory. */
    album?: string;
    /** B-084: the current source was asked for every file (lb-bot's `allFiles`). */
    allFiles?: boolean;
    /** Started with the MP3 opt-in, so a Retry re-sends it. */
    allowMp3?: boolean;
    artist?: string;
    /** How many fills lb-bot has recorded for this release. Its count, not ours —
     *  it survives an lb-bot restart and includes its own automatic retries. */
    attempts?: number;
    /** Live progress, as the last poll or push reported it. Kept on the row so
     *  the downloads view renders a bar without a read of its own. */
    bytesDone?: number;
    bytesTotal?: number;
    /** The server's Cancel rule for this fill (PROTOCOL §15). */
    cancellable?: boolean;
    done?: number;
    /** The pressing the user actually chose. Kept so a Retry re-sends it instead of
     *  letting lb-bot re-resolve the release-group to "official, earliest" — which
     *  silently overrules the choice *and* re-enters its five-minute MusicBrainz
     *  failure cache. */
    edition?: LbBotResolvedEdition;
    /** Peers "Try another source" has already ruled out for this album, so a
     *  second go does not hand the fill back to the first slow peer. */
    excludedPeers?: string[];
    failedFiles?: number;
    /** What kind of failure this was, from lb-bot rather than inferred from the
     *  wording of `reason`. Empty on anything that has not failed. */
    failureKind?: LbBotFailureKind;
    finishedAt?: number;
    /** An id learned from a status poll, whose MEANING depends on state — never
     *  a stable "review group" handle the way `ActiveGap.groupId` is. Before
     *  `needs_match` it is the transfer-group id (`ag…`); at `needs_match` lb-bot
     *  repoints it at an import-recovery record (`rec…`,
     *  `listenbrainz_bot.py`'s `_album_fill_set`). Allow MP3 is keyed on this
     *  (not the rgid, which silently no-ops), but **B-026: it is not a
     *  `#/gaps/<id>` page for any state** — that route only resolves an
     *  `ActiveGap.groupId`. See `fill-announce-logic.ts` for the one place
     *  that decides what to link to. */
    groupId?: string;
    /** When a poll last reached lb-bot for this row, and what the last failed
     *  poll said. A failed poll is NOT `unknown`: it leaves the state alone and
     *  says "can't reach" — see `applyFillStatus`. */
    lastCheckedAt?: number;
    lastError?: string;
    lastErrorTicks?: number;
    /** When the row last MOVED — state, files or bytes. Expiry is measured from
     *  here, not from the tap: a slow peer is not a dead fill. */
    lastProgressAt?: number;
    /** The peer lb-bot actually queued from, learned from a status poll — the one
     *  to exclude when the user asks for another source. */
    lastSource?: string;
    /** B-084: audio files of the current source's folder that were not asked for. */
    leftOut?: number;
    /** The search rejected mp3s and would have found something with them. */
    mp3WouldHelp?: boolean;
    outcome?: FillOutcome;
    percent?: number;
    /** The quality override the download was started with; '' = lb-bot's default. */
    quality: string;
    /** lb-bot's own sentence for a failure. Shown verbatim — it names the cause. */
    reason?: string;
    /** The release lb-bot resolved the group to — what the status poll is keyed on. */
    releaseMbid: string;
    /** Whether a plain Retry is worth offering, per lb-bot. False for a format
     *  rejection MP3 would fix: that retry re-runs the same rejected search. */
    retryable?: boolean;
    /** Epoch ms when lb-bot's own automatic retry fires; 0 when none is pending. */
    retryAt?: number;
    rgid: string;
    /** Set once the fill reached a terminal state, so the page can stop polling. */
    settled: boolean;
    /** The peer the user picked, if any, so a retry re-issues the same request. */
    sourceFolder?: string;
    sourcePeer?: string;
    speedBps?: number;
    startedAt: number;
    /** Last state lb-bot reported, kept so a settled row can explain itself. */
    state?: string;
    total?: number;
    /** Since when lb-bot has answered `unknown` for a fill we think is running,
     *  or 0. Bounded patience: see `applyFillStatus`. */
    unknownSince?: number;
    /** `placed` past lb-bot's verify deadline — on disk, not in Navidrome. */
    verifyGaveUp?: boolean;
}

/** A gap fill, keyed by lb-bot review group id. Same reasoning as ActiveFill: a
 *  per-track fill takes minutes, so the watch belongs to the page and to disk,
 *  not to the modal that started it. */
export interface ActiveGap {
    album?: string;
    artist?: string;
    cancellable?: boolean;
    done?: number;
    failedFiles?: number;
    finishedAt?: number;
    groupId: string;
    lastCheckedAt?: number;
    lastError?: string;
    lastErrorTicks?: number;
    lastProgressAt?: number;
    mp3WouldHelp?: boolean;
    outcome?: FillOutcome;
    percent?: number;
    reason?: string;
    settled: boolean;
    /** B-011: tracks already downloaded but never filed — see
     *  `LbBotGap.stalledPlacement`. Routes this row through the ledger's
     *  `needs_match` presentation instead of a generic failure with Retry. */
    stalledPlacement?: boolean;
    startedAt: number;
    state?: string;
    total?: number;
}

/**
 * How a fill ended. `needsPick` is the gap picker holding candidates and waiting on
 * the user, and `gaveUp` is "nothing ever acted on this" — lb-bot never wrote a
 * ledger row, or was restarted and forgot it. Neither is a failure, and neither
 * should be worded as one.
 */
export type FillOutcome = 'cancelled' | 'done' | 'failed' | 'gaveUp' | 'needsPick' | 'running';

/** What settling a row records. Everything is optional because a cancel knows the
 *  outcome and nothing else, while a poll knows the state and the reason too. */
export interface SettleInfo {
    attempts?: number;
    cancellable?: boolean;
    failureKind?: LbBotFailureKind;
    mp3WouldHelp?: boolean;
    outcome: FillOutcome;
    reason?: string;
    retryable?: boolean;
    retryAt?: number;
    state?: string;
    verifyGaveUp?: boolean;
}

interface ActiveFillsState {
    actions: {
        clear: () => void;
        describe: (key: string, info: Partial<ActiveFill & ActiveGap>) => void;
        dismiss: (key: string) => void;
        /** A poll reached (error '') or failed to reach (error set) lb-bot for
         *  this row. Separate from `describe`, which ignores empty strings —
         *  clearing an error IS the news here. */
        noteCheck: (key: string, error: string) => void;
        reopen: (rgid: string, releaseMbid: string) => void;
        setQuality: (quality: string) => void;
        settle: (rgid: string, info?: SettleInfo) => void;
        settleGap: (groupId: string, info?: SettleInfo) => void;
        start: (
            rgid: string,
            releaseMbid: string,
            quality?: string,
            meta?: Partial<ActiveFill>,
        ) => void;
        startGap: (groupId: string, meta?: Partial<ActiveGap>) => void;
    };
    fills: Record<string, ActiveFill>;
    gaps: Record<string, ActiveGap>;
    /** Last quality the user picked, reused as the default for the next download. */
    preferredQuality: string;
}

/**
 * Finished rows are history, kept a week and capped so a heavy week can't grow
 * the store without bound. A RUNNING row is never pruned here: this used to
 * delete unsettled rows older than twenty minutes outright, so a fill still
 * running at a slow peer — or one lb-bot had forgotten — vanished from the
 * downloads view with no outcome and no announcement. Expiry is a *settle*
 * (`gaveUp`), decided by the watcher against the row's last progress, and a
 * settled row is what gets pruned.
 */
const prune = <T extends { finishedAt?: number; settled: boolean; startedAt: number }>(
    entries: Record<string, T>,
): Record<string, T> => {
    const now = Date.now();
    const kept = Object.entries(entries ?? {}).filter(
        ([, entry]) =>
            !entry.settled || now - (entry.finishedAt ?? entry.startedAt) < LEDGER_RETAIN_MS,
    );
    if (kept.length <= LEDGER_MAX) return Object.fromEntries(kept);
    return Object.fromEntries(
        kept
            .sort(
                (a, b) => (b[1].finishedAt ?? b[1].startedAt) - (a[1].finishedAt ?? a[1].startedAt),
            )
            .slice(0, LEDGER_MAX),
    );
};

export const useActiveFillsStore = create<ActiveFillsState>()(
    persist(
        (set) => ({
            actions: {
                clear: () => set({ fills: {}, gaps: {} }),
                /** Fold in whatever the latest poll learned — title, artist, last state.
                 *  Never blanks a field it has no answer for: a poll that returns
                 *  `unknown` still knows less than the tap that started the fill.
                 *
                 *  Returns the state *untouched* when it would change nothing. This is
                 *  load-bearing, not an optimisation: the watchers call this every tick
                 *  from an effect that depends on the very row it writes, so replacing an
                 *  identical row with a fresh object re-runs that effect immediately and
                 *  React stops the app at "Maximum update depth exceeded". A poll that
                 *  learns nothing new must be a no-op all the way down. */
                describe: (key, info) =>
                    set((state) => {
                        const target = state.fills[key] ? 'fills' : state.gaps[key] ? 'gaps' : null;
                        if (!target) return state;
                        // Via `unknown`: neither ActiveFill nor ActiveGap has an index
                        // signature, so TS refuses the direct conversion.
                        const current = state[target][key] as unknown as Record<string, unknown>;
                        const clean = Object.entries(info).filter(
                            ([k, v]) => v !== undefined && v !== '' && v !== current[k],
                        );
                        if (clean.length === 0) return state;
                        return {
                            [target]: {
                                ...state[target],
                                [key]: { ...current, ...Object.fromEntries(clean) },
                            },
                        } as Partial<ActiveFillsState>;
                    }),
                /** Forget one finished row. Only ever offered on a settled fill. */
                dismiss: (key) =>
                    set((state) => {
                        const { [key]: droppedFill, ...fills } = state.fills;
                        const { [key]: droppedGap, ...gaps } = state.gaps;
                        return droppedFill || droppedGap ? { fills, gaps } : state;
                    }),
                noteCheck: (key, error) =>
                    set((state) => {
                        const target = state.fills[key] ? 'fills' : state.gaps[key] ? 'gaps' : null;
                        if (!target) return state;
                        const current = state[target][key] as unknown as ActiveFill & ActiveGap;
                        const ticks = error ? (current.lastErrorTicks ?? 0) + 1 : 0;
                        if (
                            current.lastError === error &&
                            current.lastErrorTicks === ticks &&
                            (error || current.lastCheckedAt)
                        ) {
                            // Nothing new but the clock — see `describe` on why an
                            // identical row must not be replaced.
                            if (
                                !error &&
                                current.lastCheckedAt &&
                                Date.now() - current.lastCheckedAt < 1000
                            ) {
                                return state;
                            }
                        }
                        return {
                            [target]: {
                                ...state[target],
                                [key]: {
                                    ...current,
                                    lastCheckedAt: error ? current.lastCheckedAt : Date.now(),
                                    lastError: error,
                                    lastErrorTicks: ticks,
                                },
                            },
                        } as Partial<ActiveFillsState>;
                    }),
                /** Re-open a settled row for another attempt, keeping its display fields
                 *  so the history stays one line per album rather than one per attempt. */
                reopen: (rgid, releaseMbid) =>
                    set((state) =>
                        state.fills[rgid]
                            ? {
                                  fills: {
                                      ...state.fills,
                                      [rgid]: {
                                          ...state.fills[rgid],
                                          bytesDone: 0,
                                          bytesTotal: 0,
                                          cancellable: true,
                                          done: 0,
                                          failedFiles: 0,
                                          failureKind: undefined,
                                          finishedAt: undefined,
                                          lastError: '',
                                          lastErrorTicks: 0,
                                          lastProgressAt: Date.now(),
                                          outcome: 'running',
                                          percent: 0,
                                          reason: undefined,
                                          releaseMbid: releaseMbid || state.fills[rgid].releaseMbid,
                                          retryAt: 0,
                                          settled: false,
                                          startedAt: Date.now(),
                                          state: undefined,
                                          unknownSince: 0,
                                          verifyGaveUp: false,
                                      },
                                  },
                              }
                            : state,
                    ),
                setQuality: (quality) => set({ preferredQuality: quality }),
                settle: (rgid, info) =>
                    set((state) =>
                        state.fills[rgid] && !state.fills[rgid].settled
                            ? {
                                  fills: {
                                      ...state.fills,
                                      [rgid]: {
                                          ...state.fills[rgid],
                                          ...info,
                                          cancellable: info?.cancellable ?? false,
                                          finishedAt: Date.now(),
                                          lastError: '',
                                          lastErrorTicks: 0,
                                          outcome: info?.outcome ?? 'gaveUp',
                                          retryAt: info?.retryAt ?? 0,
                                          settled: true,
                                      },
                                  },
                              }
                            : state,
                    ),
                settleGap: (groupId, info) =>
                    set((state) =>
                        state.gaps[groupId] && !state.gaps[groupId].settled
                            ? {
                                  gaps: {
                                      ...state.gaps,
                                      [groupId]: {
                                          ...state.gaps[groupId],
                                          ...info,
                                          cancellable: false,
                                          finishedAt: Date.now(),
                                          lastError: '',
                                          lastErrorTicks: 0,
                                          outcome: info?.outcome ?? 'gaveUp',
                                          settled: true,
                                      },
                                  },
                              }
                            : state,
                    ),
                start: (rgid, releaseMbid, quality = '', meta) =>
                    set((state) => ({
                        fills: {
                            ...state.fills,
                            [rgid]: {
                                // Whatever the previous attempt knew survives a retap:
                                // a second tap must not blank the album title the row
                                // is displayed under.
                                ...state.fills[rgid],
                                ...meta,
                                bytesDone: 0,
                                bytesTotal: 0,
                                cancellable: true,
                                done: 0,
                                failedFiles: 0,
                                failureKind: undefined,
                                finishedAt: undefined,
                                lastError: '',
                                lastErrorTicks: 0,
                                lastProgressAt: Date.now(),
                                outcome: 'running',
                                percent: 0,
                                quality,
                                reason: undefined,
                                releaseMbid,
                                retryAt: 0,
                                rgid,
                                settled: false,
                                startedAt: Date.now(),
                                state: undefined,
                                unknownSince: 0,
                                verifyGaveUp: false,
                            },
                        },
                    })),
                startGap: (groupId, meta) =>
                    set((state) => ({
                        gaps: {
                            ...state.gaps,
                            [groupId]: {
                                ...state.gaps[groupId],
                                ...meta,
                                cancellable: false,
                                finishedAt: undefined,
                                groupId,
                                lastError: '',
                                lastErrorTicks: 0,
                                lastProgressAt: Date.now(),
                                outcome: 'running',
                                reason: undefined,
                                settled: false,
                                startedAt: Date.now(),
                                state: undefined,
                            },
                        },
                    })),
            },
            fills: {},
            gaps: {},
            preferredQuality: '',
        }),
        {
            merge: (persisted, current) => {
                const saved = (persisted ?? {}) as Partial<ActiveFillsState>;
                return {
                    ...current,
                    fills: prune(saved.fills ?? {}),
                    gaps: prune(saved.gaps ?? {}),
                    preferredQuality: saved.preferredQuality ?? '',
                };
            },
            // Every field added in v3 and v4 is optional, so older data is readable
            // as-is. Without an explicit migrate zustand discards mismatched state
            // outright, which would silently drop a download in flight across the
            // update.
            migrate: (persisted) => persisted as ActiveFillsState,
            name: 'store_lbbot_fills',
            // Never the action closures. Settled rows now DO persist — they are the
            // history the downloads view lists; `prune` is what bounds them.
            partialize: (state) => ({
                fills: prune(state.fills),
                gaps: prune(state.gaps),
                preferredQuality: state.preferredQuality,
            }),
            version: 4,
        },
    ),
);

export const useActiveFill = (rgid: string): ActiveFill | undefined =>
    useActiveFillsStore((state) => state.fills[rgid]);

export const useActiveGap = (groupId: string): ActiveGap | undefined =>
    useActiveFillsStore((state) => state.gaps[groupId]);

export const useActiveFillsActions = () => useActiveFillsStore((state) => state.actions);

export const usePreferredQuality = (): string =>
    useActiveFillsStore((state) => state.preferredQuality);

/** One row of the downloads view — an album fill and a gap fill flattened into the
 *  same shape, since the view renders them side by side and only the retry differs. */
export interface LedgerRow {
    album: string;
    /** B-084: see `ActiveFill.allFiles`; false for a gap. */
    allFiles: boolean;
    artist: string;
    /** lb-bot's own attempt count, including its automatic retries. 0 when it
     *  predates the field, which is why the view only shows it above 1. */
    attempts: number;
    bytesDone: number;
    bytesTotal: number;
    cancellable: boolean;
    done: number;
    /** Files that failed inside a fill that is otherwise progressing. */
    failed: number;
    /** What kind of failure, from lb-bot rather than inferred from `reason`'s
     *  wording. Empty on a gap fill, which has no equivalent, and on any row
     *  recorded before lb-bot carried the field. */
    failureKind: LbBotFailureKind;
    /** lb-bot's review group, when one is known. A gap IS one, so its key doubles as
     *  it; an album fill only learns it from a status poll, and Allow MP3 has nothing
     *  to act on until then. Empty is a real answer — never substitute the rgid. */
    groupId: string;
    isGap: boolean;
    key: string;
    lastCheckedAt: number;
    lastError: string;
    lastErrorTicks: number;
    /** The peer the current transfer is from, for the sub-line. */
    lastSourcePeer: string;
    /** B-084: files of the folder not asked for; 0 for a gap and for old rows. */
    leftOut: number;
    mp3WouldHelp: boolean;
    /** Peers a "Try another source" would exclude: the one lb-bot queued from and
     *  any ruled out before. Empty when no peer is known yet, or for a gap. */
    otherSourceExcludes: string[];
    outcome: FillOutcome;
    percent: number;
    reason: string;
    /** Whether a plain Retry is worth offering. True for a gap fill and for any
     *  row predating the field — absent means unknown, and hiding the only
     *  action on a guess is worse than offering one that may not help. */
    retryable: boolean;
    retryAt: number;
    rgid: string;
    settled: boolean;
    sortAt: number;
    speedBps: number;
    /** True only for a gap: see `ActiveGap.stalledPlacement`. False (never
     *  absent) for an album fill, which has no equivalent. */
    stalledPlacement: boolean;
    state: string;
    total: number;
    verifyGaveUp: boolean;
}

const toRow = (entry: ActiveFill | ActiveGap, isGap: boolean): LedgerRow => ({
    album: entry.album ?? '',
    allFiles: isGap ? false : ((entry as ActiveFill).allFiles ?? false),
    artist: entry.artist ?? '',
    attempts: isGap ? 0 : ((entry as ActiveFill).attempts ?? 0),
    bytesDone: isGap ? 0 : ((entry as ActiveFill).bytesDone ?? 0),
    bytesTotal: isGap ? 0 : ((entry as ActiveFill).bytesTotal ?? 0),
    // Absent means an older row: fall back to the states the server would say.
    cancellable:
        entry.cancellable ??
        (!entry.settled &&
            (isGap
                ? entry.state === 'downloading'
                : ['', 'downloading', 'queued', 'searching', undefined].includes(entry.state))),
    done: entry.done ?? 0,
    failed: entry.failedFiles ?? 0,
    failureKind: isGap ? '' : ((entry as ActiveFill).failureKind ?? ''),
    groupId: isGap ? (entry as ActiveGap).groupId : ((entry as ActiveFill).groupId ?? ''),
    isGap,
    key: isGap ? (entry as ActiveGap).groupId : (entry as ActiveFill).rgid,
    lastCheckedAt: entry.lastCheckedAt ?? 0,
    lastError: entry.lastError ?? '',
    lastErrorTicks: entry.lastErrorTicks ?? 0,
    lastSourcePeer: isGap ? '' : ((entry as ActiveFill).lastSource ?? ''),
    leftOut: isGap ? 0 : ((entry as ActiveFill).leftOut ?? 0),
    mp3WouldHelp: entry.mp3WouldHelp ?? false,
    otherSourceExcludes: isGap
        ? []
        : [
              ...new Set(
                  [
                      ...((entry as ActiveFill).excludedPeers ?? []),
                      (entry as ActiveFill).lastSource,
                      (entry as ActiveFill).sourcePeer,
                  ].filter((peer): peer is string => !!peer),
              ),
          ],
    outcome: entry.outcome ?? (entry.settled ? 'gaveUp' : 'running'),
    percent: entry.percent ?? 0,
    reason: entry.reason ?? '',
    retryable: isGap ? true : ((entry as ActiveFill).retryable ?? true),
    retryAt: isGap ? 0 : ((entry as ActiveFill).retryAt ?? 0),
    rgid: isGap ? '' : (entry as ActiveFill).rgid,
    settled: entry.settled,
    sortAt: entry.finishedAt ?? entry.startedAt,
    speedBps: isGap ? 0 : ((entry as ActiveFill).speedBps ?? 0),
    stalledPlacement: isGap ? (entry as ActiveGap).stalledPlacement === true : false,
    state: entry.state ?? '',
    total: entry.total ?? 0,
    verifyGaveUp: isGap ? false : ((entry as ActiveFill).verifyGaveUp ?? false),
});

/** One album fill as the ledger's row: what `describeFill` and the request box read (F7). */
export const ledgerRowOf = (fill: ActiveFill): LedgerRow => toRow(fill, false);

/**
 * The whole ledger, in flight first then most recent — which is what someone opening
 * the downloads view came to see. Empty whenever lb-bot is unconfigured, because
 * nothing can then ever have been started; that is also how the view stays hidden.
 */
export const useFillLedger = (): LedgerRow[] => {
    // Two stable selections and a memo, NOT one selector building the array: a
    // selector that returns a fresh array every call re-renders on every store read
    // and trips zustand's infinite-loop guard. `state.fills` is referentially stable
    // between the updates that actually change it.
    const fills = useActiveFillsStore((state) => state.fills);
    const gaps = useActiveFillsStore((state) => state.gaps);
    return useMemo(
        () =>
            [
                ...Object.values(fills).map((fill) => toRow(fill, false)),
                ...Object.values(gaps).map((gap) => toRow(gap, true)),
            ].sort((a, b) => Number(a.settled) - Number(b.settled) || b.sortAt - a.sortAt),
        [fills, gaps],
    );
};
