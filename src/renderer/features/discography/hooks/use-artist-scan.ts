import { useEffect, useRef, useState } from 'react';

import {
    clearScanStarted,
    useStartedScan,
} from '/@/renderer/features/discography/hooks/scan-session';
import {
    justScanned,
    nextScanVisit,
    SCAN_VISIT_START,
    scanCountsText,
    scanLine,
    type ScanPhase,
    scanPhase,
    scanPollMs,
    scanScannable,
    type ScanVisit,
} from '/@/renderer/features/discography/scan-phase';
import { openMbidMatchModal } from '/@/renderer/features/lbbot/components/mbid-match-modal';
import {
    type LbBotDiscographyRead,
    useIndexArtist,
    useIsP1Peer,
    useLbBotAvailable,
    useLbBotScanRead,
    useOverrideControls,
    useScanNeedsMbid,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { isNavidromeArtistId } from '/@/renderer/features/lbbot/utils/artist-override';
import { toast } from '/@/shared/components/toast/toast';

export interface ArtistScan {
    available: boolean;
    busy: boolean;
    /** Worbus P1: "6 of 10 done" and the bar's fill (0..1) while a scan with counts runs; null =
     *  the indeterminate bar. */
    counts: null | { fraction: number; text: string };
    line: string;
    /** Worbus P1: the unresolved block's Match manually (the existing match modal); null where
     *  the hub offers no artist overrides. */
    matchManually: (() => void) | null;
    phase: ScanPhase;
    scannable: boolean;
    start: () => void;
}

/**
 * The artist's discography scan (Task 4): the start and its poll from `useIndexArtist`, lb-bot's scan
 * record from the network read, and the scan this session started; every decision is `scanPhase`.
 */
export const useArtistScan = (args: {
    artistMbid?: null | string;
    artistName: string;
    discography: LbBotDiscographyRead;
    ndId: string;
}): ArtistScan => {
    const { artistMbid, artistName, discography, ndId } = args;
    const available = useLbBotAvailable();
    // `useIndexArtist`'s own `pending` lasts its whole poll; the phase needs only the start request.
    const { error, indexArtist, note } = useIndexArtist(ndId);
    const [starting, setStarting] = useState(false);
    // Two presses in one tick both see `starting` false; the ref makes them one scan.
    const inFlight = useRef(false);
    const started = useStartedScan(ndId);
    // Worbus P1: a P1 peer scans an artist with no MBID by its Navidrome id ("Scan now"), unless
    // its lb-bot turned out to need one. An older peer needs the MBID and the name, as before.
    const p1Peer = useIsP1Peer();
    const needsMbid = useScanNeedsMbid();
    const scannable = scanScannable({
        mbid: artistMbid,
        name: artistName,
        ndId,
        olderLbBot: needsMbid,
        p1Peer,
    });
    const overrides = useOverrideControls() && isNavidromeArtistId(ndId);
    const [now, setNow] = useState(() => Date.now());
    const [polling, setPolling] = useState<null | number>(null);
    // The network read carries lb-bot's scan record and, from a P1 lb-bot, `unresolved` and the
    // counts (the mirror carries neither): read once per page open, and while a scan runs.
    const { data: network, readAtMs } = useLbBotScanRead(ndId, artistMbid, polling);

    const data = discography.data;
    const scan = network?.scan ?? null;
    const phase = scanPhase({
        available,
        indexed: (data?.indexed ?? network?.indexed) === true,
        loading: !data?.indexed && network === undefined && (discography.isLoading || available),
        nowMs: now,
        pending: starting,
        readAtMs,
        releaseCount: data?.indexed ? data.releases.length : 0,
        scan,
        scannable,
        started,
        unresolved: network?.unresolved === true,
    });
    const pollMs = scanPollMs(phase, p1Peer);
    const countsText = scanCountsText(scan);
    const counts =
        countsText && scan?.total
            ? { fraction: Math.min(1, (scan.done ?? 0) / scan.total), text: countsText }
            : null;

    // What this visit has seen of the scans (`nextScanVisit`), for "Updated just now": only after a
    // scan seen running really finished, and only for a P1 peer. Stepped during render (it
    // converges: the same input twice changes nothing); a different artist starts a new visit.
    const scannedAtMs = data?.indexed && data.scannedAt > 0 ? data.scannedAt * 1000 : null;
    const [visit, setVisit] = useState<{ ndId: string; visit: ScanVisit }>(() => ({
        ndId,
        visit: SCAN_VISIT_START,
    }));
    const nextVisit = nextScanVisit(visit.ndId === ndId ? visit.visit : SCAN_VISIT_START, {
        answered: data !== undefined,
        phase,
        scan,
        scannedAtMs,
    });
    if (
        visit.ndId !== ndId ||
        nextVisit.doneBefore !== visit.visit.doneBefore ||
        nextVisit.firstScannedAtMs !== visit.visit.firstScannedAtMs ||
        nextVisit.sawDone !== visit.visit.sawDone ||
        nextVisit.sawRunning !== visit.visit.sawRunning
    ) {
        setVisit({ ndId, visit: nextVisit });
    }

    useEffect(() => {
        setPolling(pollMs);
        if (pollMs === null) return undefined;
        const tick = window.setInterval(() => setNow(Date.now()), pollMs);
        return () => window.clearInterval(tick);
    }, [pollMs]);

    // A scan this session started stops counting once its phase has moved on.
    useEffect(() => {
        if (started && phase !== 'running') clearScanStarted(ndId);
    }, [ndId, phase, started]);

    // A start that failed, or one lb-bot declined, is said once; a scan that failed has its line.
    useEffect(() => {
        if (error && phase !== 'failed') toast.error({ message: error });
    }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (note) toast.info({ message: note });
    }, [note]);

    return {
        available,
        busy: phase === 'running',
        counts,
        line: scanLine(phase, {
            counted: counts !== null,
            error: scan?.error ?? '',
            justScanned: justScanned(nextVisit, { p1Peer, phase, scannedAtMs }),
            nowMs: now,
            scannable,
            scannedAtMs,
            stale: data?.stale ?? false,
        }),
        matchManually: overrides
            ? () =>
                  openMbidMatchModal({
                      currentMbid: artistMbid,
                      indexArtist,
                      name: artistName,
                      ndId,
                      // An artist lb-bot could not resolve carries no MBID tag to compare with.
                      tagMbid: null,
                  })
            : null,
        phase,
        scannable,
        start: () => {
            if (!scannable || phase === 'running' || inFlight.current) return;
            inFlight.current = true;
            setNow(Date.now());
            setStarting(true);
            void indexArtist(artistMbid || undefined, artistName).finally(() => {
                inFlight.current = false;
                setStarting(false);
            });
        },
    };
};
