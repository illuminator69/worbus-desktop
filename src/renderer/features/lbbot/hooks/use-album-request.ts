import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
    refusalSaysListIsStale,
    shownSelection,
    sourceKey,
} from '/@/renderer/features/lbbot/components/source-cards-model';
import {
    startAlbumDownload,
    useLbBotAlbumReleases,
    useLbBotAlbumSources,
    useLbBotDownloadsShown,
    useLbBotFillStatus,
    useLbBotTracklist,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { albumSearchPress } from '/@/renderer/features/lbbot/search-again';
import {
    useActiveFill,
    useActiveFillsActions,
    usePreferredQuality,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import { allFilesConfirmation } from '/@/renderer/features/lbbot/utils/album-download';
import { toast } from '/@/shared/components/toast/toast';
import { LbBotGapSource, LbBotResolvedEdition } from '/@/shared/types/lbbot-types';

/**
 * A source search asked for on an album page, by release-group: the edition it was asked for and
 * when. Module level, so leaving the page during the 30 to 90 second wait and coming back finds the
 * same search (react-query keeps its answer five minutes) instead of starting a second one.
 */
type SearchSession = {
    edition: LbBotResolvedEdition | undefined;
    label: string;
    startedAt: number;
};
const sessions = new Map<string, SearchSession>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const FIVE_MINUTES = 5 * 60 * 1000;

export type SourcesState = 'empty' | 'failed' | 'idle' | 'ready' | 'waiting';

/**
 * Everything the not-owned album page does about getting the album (F7 Task 6): the edition picker,
 * the tracklist that follows it, the ranked sources (only on the press: it is a live Soulseek
 * search), the pick and the download. The logic of the old two-step dialog, with no JSX.
 */
export const useAlbumRequest = ({
    artist,
    rgid,
    title,
}: {
    artist: string;
    rgid: string;
    title: string;
}) => {
    const queryClient = useQueryClient();
    const releasesQuery = useLbBotAlbumReleases(rgid || null);
    // The first variant's first edition, as `defaultEdition` in use-lbbot.ts does, so a one-tap
    // acquire that fell through to this page finds its source search already cached.
    const [variantIndex, setVariantIndexState] = useState(0);
    const [editionIndex, setEditionIndex] = useState(0);
    const variants = releasesQuery.data?.variants ?? [];
    const variant = variants[variantIndex];
    const editions = variant?.editions ?? [];
    const edition = editions[editionIndex] ?? editions[0];
    const releaseMbid = edition?.releaseMbid || variant?.releaseMbid || null;
    const tracklistQuery = useLbBotTracklist(releaseMbid);
    const setVariantIndex = useCallback((index: number) => {
        setVariantIndexState(index);
        setEditionIndex(0);
    }, []);

    // What is known about the chosen pressing, handed to lb-bot so it does not re-resolve the group
    // (its resolver picks "official, earliest" and caches a MusicBrainz failure for five minutes).
    const resolvedEdition: LbBotResolvedEdition | undefined = useMemo(
        () =>
            releaseMbid
                ? {
                      artist: releasesQuery.data?.artist || artist,
                      releaseMbid,
                      title: variant?.title || title,
                      totalTracks: tracklistQuery.data?.tracks.length || variant?.trackCount || 0,
                  }
                : undefined,
        [artist, releaseMbid, releasesQuery.data?.artist, title, tracklistQuery.data, variant],
    );
    const editionLabel = [variant?.title, variant?.disambiguation, edition?.label]
        .filter(Boolean)
        .join(' · ');

    // The search: asked for once, by the press, for the edition shown then.
    const session = useSyncExternalStore(subscribe, () => sessions.get(rgid) ?? null);
    // A refused Download, shown under that card's button (R12, B-238) instead of a toast.
    const [refusal, setRefusal] = useState<null | {
        message: string;
        sourceKey: string;
        stale: boolean;
    }>(null);
    // A session lives as long as its answer can be cached (five minutes): after that, reopening the
    // page must not start a live search nobody asked for.
    useEffect(() => {
        if (!session) return undefined;
        const left = session.startedAt + FIVE_MINUTES - Date.now();
        const expire = () => {
            if (sessions.get(rgid) === session) {
                sessions.delete(rgid);
                emit();
            }
        };
        if (left <= 0) {
            expire();
            return undefined;
        }
        const timer = window.setTimeout(expire, left);
        return () => window.clearTimeout(timer);
    }, [rgid, session]);
    // Worbus P1: with downloading off no search runs, even for a session started while it was on
    // (the page shows the off line instead of the box).
    const downloadsShown = useLbBotDownloadsShown();
    const sources = useLbBotAlbumSources(
        rgid || null,
        !!session && downloadsShown,
        session?.edition,
        {
            staleTime: FIVE_MINUTES,
        },
    );
    const sourcesState: SourcesState = !session
        ? 'idle'
        : sources.isLoading
          ? 'waiting'
          : sources.error
            ? 'failed'
            : sources.sources === null
              ? 'waiting'
              : sources.sources.length === 0
                ? 'empty'
                : 'ready';
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (sourcesState !== 'waiting') return undefined;
        const tick = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(tick);
    }, [sourcesState]);
    const startSearch = useCallback(() => {
        const current = sessions.get(rgid);
        if (current && current.edition?.releaseMbid === resolvedEdition?.releaseMbid) {
            // The same edition again: only a failed or empty answer is asked again, on a fresh clock.
            const press = albumSearchPress(sourcesState);
            if (press === 'refresh') {
                sessions.set(rgid, { ...current, startedAt: Date.now() });
                setNow(Date.now());
                emit();
                // `refresh=1`: past lb-bot's kept list and the hub's one-minute cache (B-256).
                void sources.again();
            } else if (press === 'reshow') {
                // R11: the cards already found, brought back over a finished request's card
                // (`albumBoxView` shows the sources asked for after the fill ended). No new search.
                sessions.set(rgid, { ...current, startedAt: Date.now() });
                emit();
            }
            return;
        }
        sessions.set(rgid, {
            edition: resolvedEdition,
            label: editionLabel,
            startedAt: Date.now(),
        });
        setNow(Date.now());
        emit();
    }, [editionLabel, resolvedEdition, rgid, sources, sourcesState]);
    // After a refusal that says the cards are stale (B-238): ask lb-bot again even over cards
    // already shown, which `startSearch` deliberately does not.
    const searchAgain = useCallback(() => {
        setRefusal(null);
        const current = sessions.get(rgid);
        if (!current) {
            startSearch();
            return;
        }
        sessions.set(rgid, { ...current, startedAt: Date.now() });
        setNow(Date.now());
        emit();
        // `refresh=1`: lb-bot searches afresh, past what it kept and the hub's one-minute cache.
        void sources.again();
    }, [rgid, sources, startSearch]);
    // "Stop waiting": this page stops waiting for the answer; lb-bot's search is not cancellable from
    // here, and its answer stays in the hub's cache for a minute after it ends.
    const stopSearch = useCallback(() => {
        void queryClient.cancelQueries({ queryKey: sources.queryKey });
        sessions.delete(rgid);
        emit();
    }, [queryClient, rgid, sources.queryKey]);
    const searchedOther =
        !!session && session.edition?.releaseMbid !== resolvedEdition?.releaseMbid;

    // The pick (R11): only a source lb-bot marks safe is chosen for the user; otherwise nothing is,
    // and there is no Download until a card is tapped (a tap is consent, a default is not).
    const [chosen, setChosen] = useState<LbBotGapSource | null>(null);
    const select = useCallback((source: LbBotGapSource | null) => {
        setChosen(source);
        setRefusal(null);
    }, []);
    const rows = useMemo(() => sources.sources ?? [], [sources.sources]);
    const selectedId = shownSelection(rows, chosen?.id ?? null);
    const selected = rows.find((row) => row.id === selectedId) ?? null;
    // The album's listing rides along with its sources; a card shows it once chosen.
    const filesFor = useCallback(
        (source: LbBotGapSource) =>
            source.files.length > 0
                ? {
                      error: '',
                      loading: false,
                      value: {
                          coverage: source.coverage,
                          coverageDetail: source.coverageDetail,
                          expanded: true,
                          fileCount: source.fileCount,
                          files: source.files,
                          filesTruncated: source.filesTruncated,
                      },
                  }
                : null,
        [],
    );

    // The fill: the ledger's row (the app-root watcher keeps it live), polled every 5 s here too.
    const activeFill = useActiveFill(rgid);
    useLbBotFillStatus(activeFill?.releaseMbid ?? null, !!activeFill && !activeFill.settled, rgid);
    const preferredQuality = usePreferredQuality();
    const { setQuality } = useActiveFillsActions();
    const [starting, setStarting] = useState(false);
    // Two presses in one tick both see `starting` false: the ref is what makes them one request.
    const inFlight = useRef(false);
    const busy = starting || (!!activeFill && !activeFill.settled);

    const download = useCallback(
        async (
            options: {
                allFiles?: boolean;
                allowMp3?: boolean;
                source?: LbBotGapSource;
            } = {},
        ) => {
            // Always a card on the screen, never lb-bot's own pick from a fresh search: the client
            // sends the chosen peer (CLAUDE.md section 5; review I1).
            const source = options.source ?? selected;
            if (busy || inFlight.current || !source || !rgid) return;
            inFlight.current = true;
            setStarting(true);
            setRefusal(null);
            try {
                const result = await startAlbumDownload(
                    rgid,
                    preferredQuality,
                    { folder: source.folder, peer: source.peer },
                    session?.edition ?? resolvedEdition,
                    undefined,
                    { album: title, artist },
                    options.allowMp3 === true,
                    options.allFiles === true,
                );
                if (!result.ok) {
                    // lb-bot's own sentence, verbatim, under the button that was pressed.
                    setRefusal({
                        message: result.error || 'lb-bot could not start the download',
                        sourceKey: sourceKey(source),
                        stale: refusalSaysListIsStale(result),
                    });
                    return;
                }
                const confirmation = allFilesConfirmation({
                    asked: options.allFiles === true,
                    echo: result.allFiles,
                    existing: result.existing,
                    fileCount: source.fileCount,
                    peer: source.peer,
                });
                if (confirmation.kind === 'existing') {
                    toast.show({ message: 'Already downloading this album' });
                } else if (confirmation.text) {
                    toast.show({ message: confirmation.text });
                }
            } finally {
                inFlight.current = false;
                setStarting(false);
            }
        },
        [artist, busy, preferredQuality, resolvedEdition, rgid, selected, session, title],
    );

    return {
        activeFill,
        busy,
        download,
        edition,
        editionIndex,
        editionLabel,
        editions,
        preferredQuality,
        refusal,
        releasesQuery,
        resolvedEdition,
        select,
        selected,
        setEditionIndex,
        setQuality,
        setVariantIndex,
        sources: {
            again: searchAgain,
            elapsedMs: session ? Math.max(0, now - session.startedAt) : 0,
            error: sources.error,
            filesFor,
            rows,
            searchedLabel: session?.label ?? '',
            searchedOther,
            start: startSearch,
            startedAt: session?.startedAt ?? 0,
            state: sourcesState,
            stop: stopSearch,
        },
        starting,
        tracklistQuery,
        variant,
        variantIndex,
        variants,
    };
};

export type AlbumRequest = ReturnType<typeof useAlbumRequest>;
