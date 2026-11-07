import type {
    LbBotAlbumOverrideRow,
    LbBotPreview,
    LbBotPreviewSlot,
    LbBotVariant,
} from '/@/shared/types/lbbot-types';

/**
 * I-022 "Fix album match": the logic that has no React in it.
 *
 * Pure, so `album-override.harness.ts` can run it. Worbus for Android mirrors this by hand
 * (`navi-connect/CLAUDE.md`, PROTOCOL §15.5):
 * the sentences and the poll's rules below are the shared behaviour.
 */

// ---------------------------------------------------------------------------
// A pasted release id
// ---------------------------------------------------------------------------

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BARE_UUID = new RegExp(`^${UUID}$`, 'i');
const RELEASE_URL = new RegExp(
    `^(?:https?://)?(?:[a-z0-9-]+\\.)?musicbrainz\\.org/release/(${UUID})(?:[/?#].*)?$`,
    'i',
);

/**
 * A pasted bare MBID or `musicbrainz.org/release/<uuid>` URL -> the lowercase
 * uuid, else null. Only the *release* path on musicbrainz.org (or one of its
 * subdomains): a release-group, artist or label uuid is not a release, and a
 * look-alike host is not MusicBrainz. (`artist-override.ts` has the artist twin.)
 */
export const extractReleaseMbid = (input: string): null | string => {
    const text = (input || '').trim();
    if (BARE_UUID.test(text)) return text.toLowerCase();
    const match = RELEASE_URL.exec(text);
    return match ? match[1].toLowerCase() : null;
};

// ---------------------------------------------------------------------------
// The preview, summarised
// ---------------------------------------------------------------------------

export interface PreviewSummary {
    /** Files an apply would rewrite: they have a slot and are not already right. */
    changing: number;
    /** Files with a slot. */
    matched: number;
    /** Slots of the release that no file fills. */
    missing: number;
    /** Files with no slot: an apply leaves them untouched. */
    noSlot: number;
    total: number;
    /** Files with a slot that already carry exactly its numbers, title and release. */
    unchanged: number;
}

export const summarizePreview = (preview: LbBotPreview): PreviewSummary => {
    const changing = preview.files.filter((file) => file.to !== null && file.changed).length;
    return {
        changing,
        matched: preview.matched,
        missing: preview.missing.length,
        noSlot: preview.unmatched,
        total: preview.files.length,
        unchanged: Math.max(preview.matched - changing, 0),
    };
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The one fixed sentence before apply (contract, "Client behaviour" 6). */
export const commitSentence = (changing: number): string =>
    `lb-bot rewrites the tags of ${plural(changing, 'file', 'files')} and keeps the previous ones, so this can be undone.`;

/** The confirmation behind a 409 `poor_match`: both numbers, then the choice. */
export const poorMatchSentence = (matched: number, total: number): string =>
    `Only ${matched} of the ${total} files have a place on this release. Apply anyway?`;

// ---------------------------------------------------------------------------
// The apply / remove poll, as one state machine
// ---------------------------------------------------------------------------

export const POLL_INTERVAL_MS = 2000;
export const GIVE_UP_MS = 180_000;
/** X3: a job that stopped advancing for three minutes is not failed - lb-bot may
 *  still be working - and the result is where the Library Matches page lists it. */
export const STILL_WORKING =
    'lb-bot is still working. The result will show on the Library Matches page.';

/** The page's name inside {@link STILL_WORKING}, where a surface makes it a link. */
export const MATCHES_PAGE_NAME = 'Library Matches';

/**
 * What a poll of `GET /lb/album/override?id=` (or, in F2, `GET /lb/artist/merge?id=`)
 * ends on. States are lb-bot's own strings; one not listed here keeps the poll going.
 */
export interface PollSpec {
    /** The row is still being worked on. */
    active: readonly string[];
    /** States that end the job unsuccessfully. */
    failed: readonly string[];
    /** A `failed` state only counts once `active` has been seen: a remove can be
     *  polled before lb-bot has flipped the row, and `applied` then is the old state. */
    failedNeedsActive: boolean;
    /** The lb-bot `code` of the 404 that says the row is gone. */
    goneCode: string;
    /** `true`: the coded 404 is the success (a remove deletes its row). `false`: the
     *  row vanishing from under an apply is its own, unexpected, ending. */
    goneIsDone: boolean;
    /** States that end the job successfully. */
    settled: readonly string[];
}

export const APPLY_SPEC: PollSpec = {
    active: ['applying'],
    failed: ['failed'],
    failedNeedsActive: false,
    goneCode: 'no_override',
    goneIsDone: false,
    settled: ['applied'],
};

export const REMOVE_SPEC: PollSpec = {
    active: ['removing'],
    failed: ['applied', 'failed'],
    failedNeedsActive: true,
    goneCode: 'no_override',
    goneIsDone: true,
    settled: [],
};

export type PollAnswer<TRow extends PollRow = LbBotAlbumOverrideRow> =
    | { code: string; ok: false; status: number }
    | { ok: true; row: TRow };

/** `settled`: it finished well. `gone`: the row vanished and that is not the plan.
 *  `failed`: lb-bot says it failed. `timeout`: three minutes passed. */
export type PollPhase = 'failed' | 'gone' | 'polling' | 'settled' | 'timeout';

/** A job row as the poll reads it. Both override rows and merge rows fit. */
export interface PollRow {
    done: number;
    failures: unknown[];
    id: string;
    setAt: number;
    state: string;
    total: number;
}

export interface PollState<TRow extends PollRow = LbBotAlbumOverrideRow> {
    phase: PollPhase;
    /** The silence clock (X2): when the row last moved (`state` or `done`), else when the job began. */
    quietSince: number;
    /** The last row lb-bot answered, kept across failed polls so progress does not blink. */
    row: null | TRow;
    /** The active state has been seen - from the POST's own answer, a resumed row, or a poll. */
    sawActive: boolean;
    spec: PollSpec;
}

/**
 * `seedState` is the state lb-bot already put on the row when the job began: the
 * `state` of the POST's own 200 (lb-bot flips a remove/undo to `removing` /
 * `undoing` before it answers, and can reach `failed` before the first tick), or
 * the row's state when a running job is picked up (X1).
 */
export const pollStart = <TRow extends PollRow = LbBotAlbumOverrideRow>(
    spec: PollSpec,
    now: number,
    seedState?: string,
): PollState<TRow> => ({
    phase: 'polling',
    quietSince: now,
    row: null,
    // A POST that itself answers `failed` has already been through the active state.
    // Only that literal: the spec's other "failed" states (a remove's old `applied`)
    // are exactly the stale answers the guard exists for.
    sawActive:
        !!seedState &&
        (spec.active.includes(seedState) ||
            (seedState === 'failed' && spec.failed.includes(seedState))),
    spec,
});

/**
 * One tick. An answer is judged before the clock, so a reply that lands at the
 * deadline still counts. A failed poll (no hub, a 5xx, a timeout, a code-less
 * 404) is NOT an answer and changes nothing but the clock. The clock measures
 * silence (X2): it restarts whenever the row's `state` or `done` differs from the
 * previous answer, so a job that advances never times out and one that stops
 * gives up three minutes after it stopped. Timed out is final (X3): lb-bot may
 * still finish, and the data panel is where that shows.
 */
export const pollStep = <TRow extends PollRow>(
    prev: PollState<TRow>,
    answer: PollAnswer<TRow>,
    now: number,
): PollState<TRow> => {
    if (prev.phase !== 'polling') return prev;
    const { spec } = prev;
    if (answer.ok) {
        const state = answer.row.state;
        const sawActive = prev.sawActive || spec.active.includes(state);
        const next = { ...prev, row: answer.row, sawActive };
        if (spec.settled.includes(state)) return { ...next, phase: 'settled' };
        if (spec.failed.includes(state) && (sawActive || !spec.failedNeedsActive)) {
            return { ...next, phase: 'failed' };
        }
    } else if (answer.status === 404 && answer.code === spec.goneCode) {
        return { ...prev, phase: spec.goneIsDone ? 'settled' : 'gone' };
    }
    const row = answer.ok ? answer.row : prev.row;
    const sawActive = answer.ok
        ? prev.sawActive || spec.active.includes(answer.row.state)
        : prev.sawActive;
    const moved =
        answer.ok &&
        prev.row !== null &&
        (answer.row.state !== prev.row.state || answer.row.done !== prev.row.done);
    const quietSince = moved ? now : prev.quietSince;
    if (now - quietSince >= GIVE_UP_MS) {
        return { ...prev, phase: 'timeout', quietSince, row, sawActive };
    }
    return { ...prev, quietSince, row, sawActive };
};

// ---------------------------------------------------------------------------
// Failures and outcomes, in words
// ---------------------------------------------------------------------------

export interface AlbumFailure {
    code: string;
    /** `older`: hide the control. `poor_match`: ask, then resend with `force`.
     *  `retry`: nothing was written, trying again may work. `answer`: lb-bot's own text. */
    kind: 'answer' | 'older' | 'poor_match' | 'retry';
    matched?: number;
    message: string;
    status: number;
    total?: number;
}

/**
 * A code-less 404 (the hub or a GET-only lb-bot has no such route) and a 405 (an
 * lb-bot older than the hub) both mean "older". A 404 that carries a `code` is
 * lb-bot's own answer. Everything else relays lb-bot's `error`, which it writes
 * for people (`busy`, `in_progress`, `unknown_album`, `unknown_release`, 400s).
 */
export const describeAlbumFailure = (result: {
    code?: string;
    error?: string;
    matched?: number;
    retryable?: boolean;
    status: number;
    total?: number;
}): AlbumFailure => {
    const base = { code: result.code ?? '', status: result.status };
    const text = (result.error ?? '').trim();
    if (result.status === 405 || (result.status === 404 && !result.code)) {
        return {
            ...base,
            kind: 'older',
            message: 'This lb-bot is older and cannot fix album matches yet.',
        };
    }
    if (
        result.status === 409 &&
        result.code === 'poor_match' &&
        typeof result.matched === 'number' &&
        typeof result.total === 'number'
    ) {
        return {
            ...base,
            kind: 'poor_match',
            matched: result.matched,
            message: poorMatchSentence(result.matched, result.total),
            total: result.total,
        };
    }
    if (
        result.status === 0 ||
        result.status === 502 ||
        result.status === 503 ||
        result.status === 504
    ) {
        return {
            ...base,
            kind: 'retry',
            message: text || 'lb-bot did not answer. Nothing was written.',
        };
    }
    return { ...base, kind: 'answer', message: text || 'lb-bot did not accept that.' };
};

/** X6: every refusal offers Try again except "this lb-bot is older" - a refusal like
 *  `files_unreachable` tells the user to change something "then try again". */
export const canTryAgain = (failure: { kind: string }): boolean => failure.kind !== 'older';

/** X9: the heading above a list of `failures`. A cover that could not be saved is
 *  a problem, not "a file that could not be written", so problems are counted as such. */
export const problemsHeading = (n: number): string => plural(n, 'problem', 'problems');

/** What a finished job says it did, from the row alone. Problems are listed apart
 *  under {@link problemsHeading}; this counts only what was written. */
export const outcomeSentence = (
    kind: 'apply' | 'remove',
    row: null | Pick<LbBotAlbumOverrideRow, 'done' | 'failures' | 'state' | 'total'>,
): string => {
    if (kind === 'remove') {
        return row && (row.state === 'failed' || row.state === 'applied')
            ? 'lb-bot could not put all the previous tags back.'
            : 'lb-bot put the previous tags back.';
    }
    if (!row) return 'lb-bot wrote the tags.';
    if (row.state === 'failed') {
        return `lb-bot did not finish writing the tags (${row.done} of ${plural(row.total, 'file', 'files')} written).`;
    }
    return `lb-bot wrote the tags of ${plural(row.done, 'file', 'files')}.`;
};

// ---------------------------------------------------------------------------
// The wait for Navidrome, and how a running row reads (X4)
// ---------------------------------------------------------------------------

/** The states in which lb-bot is still working on a row, of any kind. */
const RUNNING_STATES: readonly string[] = ['applying', 'removing', 'merging', 'undoing'];

export const isRunning = (state: string): boolean => RUNNING_STATES.includes(state);

/**
 * The writes are over but lb-bot still holds the row active until Navidrome has
 * scanned (up to a minute). `done` counts successes only, so "done >= total" is the
 * wrong test (one failed file keeps it below forever): the writes are over when
 * successes plus failures reach the total, and the state is still an active one.
 */
export const awaitingIndex = (
    row: null | Pick<PollRow, 'done' | 'failures' | 'state' | 'total'>,
): boolean =>
    !!row && row.total > 0 && row.done + row.failures.length >= row.total && isRunning(row.state);

export type JobKind = 'apply' | 'merge' | 'remove' | 'undo';

const WAIT_PREFIX: Record<JobKind, string> = {
    apply: 'The tags are written.',
    merge: 'The files are retagged.',
    remove: 'The previous tags are back in the files.',
    undo: 'The previous names are back in the files.',
};

export const waitSentence = (kind: JobKind): string =>
    `${WAIT_PREFIX[kind]} lb-bot is waiting for Navidrome to index them, which can take up to a minute.`;

const RUNNING_SENTENCE: Record<JobKind, string> = {
    apply: 'lb-bot is writing the tags…',
    merge: 'lb-bot is retagging the files…',
    remove: 'lb-bot is putting the previous tags back…',
    undo: 'lb-bot is putting the previous names back…',
};

/** What a running job shows: the wait sentence with no bar, or progress with one. */
export const jobProgress = (
    kind: JobKind,
    row: null | Pick<PollRow, 'done' | 'failures' | 'state' | 'total'>,
): { bar: boolean; percent: number; text: string } => {
    if (awaitingIndex(row)) return { bar: false, percent: 0, text: waitSentence(kind) };
    if (row && row.total > 0) {
        return {
            bar: true,
            percent: Math.round((row.done / row.total) * 100),
            text: `${RUNNING_SENTENCE[kind]} ${row.done}/${row.total} files`,
        };
    }
    return { bar: false, percent: 0, text: RUNNING_SENTENCE[kind] };
};

/** A panel row's state in words ('' when it is simply done). Never a raw state token. */
export const rowStatusWords = (
    kind: 'album' | 'merge',
    row: Pick<PollRow, 'done' | 'failures' | 'state' | 'total'>,
): string => {
    const counts = `${row.done} of ${plural(row.total, 'file', 'files')}`;
    switch (row.state) {
        case 'applied':
        case 'merged':
            return '';
        case 'applying':
        case 'merging':
        case 'removing':
        case 'undoing': {
            if (awaitingIndex(row)) return 'waiting for Navidrome to index';
            if (row.state === 'applying') return `writing tags (${counts})`;
            if (row.state === 'merging') return `retagging (${counts})`;
            return `putting the previous ${kind === 'merge' ? 'names' : 'tags'} back (${counts})`;
        }
        case 'failed':
            return 'did not finish';
        default:
            return 'in a state this app does not know';
    }
};

/** An override whose release never changed was a cover change. Blank is unknown (X7). */
export const releaseUnchanged = (row: { prevReleaseMbid: string; releaseMbid: string }): boolean =>
    !!row.releaseMbid && row.releaseMbid === row.prevReleaseMbid;

export const releaseUrl = (releaseMbid: string): string =>
    `https://musicbrainz.org/release/${releaseMbid}`;

export type TagLine =
    | { files: number; kind: 'edition'; text: string }
    | { files: number; kind: 'id'; releaseMbid: string }
    | { files: number; kind: 'untagged' }
    | { kind: 'none' };

/**
 * The "tagged now" line. None once a job has run (it would still name the old
 * edition). The listed edition when the tagged release is among them; else the
 * id itself (lb-bot's list keeps one release per format, so this is the common case).
 */
export const tagLineFor = (input: {
    files: number;
    job: boolean;
    listed: null | {
        country: string;
        format: string;
        title: string;
        trackCount: number;
        year: string;
    };
    releaseMbid: string;
}): TagLine => {
    if (input.job) return { kind: 'none' };
    if (!input.releaseMbid) return { files: input.files, kind: 'untagged' };
    if (input.listed) {
        const l = input.listed;
        return {
            files: input.files,
            kind: 'edition',
            text: [
                l.title,
                l.year,
                l.country,
                l.format,
                l.trackCount > 0 ? `${l.trackCount} tracks` : '',
            ]
                .filter(Boolean)
                .join(' · '),
        };
    }
    return { files: input.files, kind: 'id', releaseMbid: input.releaseMbid };
};

/** Why "Open" lands on the artist page: the retagged album has no id to open yet. */
export const landingNote = (kind: 'apply' | 'remove', albumId: string): null | string =>
    kind === 'apply' && !albumId
        ? 'Navidrome has not indexed the retagged album yet, so this opens the artist page instead.'
        : null;

// ---------------------------------------------------------------------------
// What the commit button does, and which covers to ask for
// ---------------------------------------------------------------------------

export type AlbumCommit = 'apply' | 'cover-only' | 'nothing';

/**
 * Mirrors Worbus for Android's `albumCommit`: the album's own release with nothing to change and
 * a cover chosen is a cover-only save (`POST /lb/album/cover`), so it stays
 * reachable after an edition was previewed. One divergence, kept on purpose: a
 * DIFFERENT release with zero changes is `nothing` here (Worbus for Android asks lb-bot).
 * `changing` is null until the preview is in.
 */
export const albumCommit = (input: {
    changing: null | number;
    coverChosen: boolean;
    current: string;
    picked: null | string;
}): AlbumCommit => {
    if (!input.picked) return input.coverChosen ? 'cover-only' : 'nothing';
    if (input.changing === null) return 'nothing';
    if (input.changing > 0) return 'apply';
    return input.picked === input.current && input.coverChosen ? 'cover-only' : 'nothing';
};

/**
 * The cover lookup's parameters (X8). A release that is not one of the listed
 * editions (a pasted id) belongs to a group this client does not know: ask by
 * `release_mbid` alone and lb-bot derives its own group. Sending the album's old
 * `rgid` would list the wrong group's covers as "Release group".
 */
export const coverQuery = (input: {
    current: string;
    listed: ReadonlySet<string>;
    picked: null | string;
    rgid: string;
}): { releaseMbid: string; rgid: string } => {
    if (!input.picked) return { releaseMbid: input.current, rgid: input.rgid };
    return {
        releaseMbid: input.picked,
        rgid: input.listed.has(input.picked) ? input.rgid : '',
    };
};

// ---------------------------------------------------------------------------
// The preview, in words
// ---------------------------------------------------------------------------

/** "02  Title"; the disc only on a multi-disc album; no number for a track without one. */
export const slotLabel = (slot: LbBotPreviewSlot, multiDisc: boolean): string => {
    if (slot.track <= 0) return slot.title;
    const disc = multiDisc && slot.disc > 0 ? `${slot.disc}-` : '';
    return `${disc}${String(slot.track).padStart(2, '0')}  ${slot.title}`;
};

export const previewCounts = (summary: PreviewSummary): [string, string, string] => [
    `${plural(summary.changing, 'file', 'files')} ${summary.changing === 1 ? 'changes' : 'change'}`,
    `${plural(summary.noSlot, 'file', 'files')} ${summary.noSlot === 1 ? 'has' : 'have'} no place on this release`,
    `${plural(summary.missing, 'track', 'tracks')} of the release ${summary.missing === 1 ? 'has' : 'have'} no file`,
];

export type AfterOverride = { id: string; kind: 'album' | 'artist' } | { kind: 'none' };

/**
 * Where to go once an apply or remove has finished. The album id the modal was
 * opened with is dead (a retag changes it); the row's current `albumId` is the
 * album again, "" while Navidrome has not indexed it - then the artist page.
 */
export const nextAfterOverride = (albumId: string, artistId: string): AfterOverride => {
    if (albumId) return { id: albumId, kind: 'album' };
    if (artistId) return { id: artistId, kind: 'artist' };
    return { kind: 'none' };
};

/**
 * {@link decideLeave} for a job that has ended. Whether the release changed comes
 * from the row the CALLER held before starting the job (`startRow`): an undo that
 * ends before the first poll read has `ended.row === null`, and deciding from the
 * last polled row alone would send the user off a live page (X7). The last polled
 * row is only the fallback. Only a settled end moves anyone.
 */
export const decideLeaveAfterJob = (input: {
    artistId: string;
    deadAlbumId: string;
    ended: {
        phase: string;
        row: null | { albumId: string; prevReleaseMbid: string; releaseMbid: string };
    };
    kind: 'apply' | 'remove';
    pathname: string;
    startRow: null | { prevReleaseMbid: string; releaseMbid: string };
}): LeaveDecision => {
    if (input.ended.phase !== 'settled') return { kind: 'stay' };
    const basis = input.startRow ?? input.ended.row;
    return decideLeave({
        artistId: input.artistId,
        deadAlbumId: input.deadAlbumId,
        kind: input.kind,
        newAlbumId: input.ended.row?.albumId ?? '',
        pathname: input.pathname,
        releaseUnchanged: !!basis && releaseUnchanged(basis),
    });
};

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------

export interface EditionRow {
    country: string;
    coverUrl: string;
    current: boolean;
    disambiguation: string;
    format: string;
    label: string;
    releaseMbid: string;
    title: string;
    trackCount: number;
    year: string;
}

/**
 * The picker's rows: every edition of every variant, once, in lb-bot's order. A
 * variant with no `editions` is itself a release and becomes one row. `current`
 * marks the release the album is tagged as now.
 */
export const editionRows = (
    variants: readonly LbBotVariant[],
    currentReleaseMbid: string,
): EditionRow[] => {
    const seen = new Set<string>();
    const rows: EditionRow[] = [];
    const add = (row: Omit<EditionRow, 'current'>) => {
        if (!row.releaseMbid || seen.has(row.releaseMbid)) return;
        seen.add(row.releaseMbid);
        rows.push({
            ...row,
            current: !!currentReleaseMbid && row.releaseMbid === currentReleaseMbid,
        });
    };
    for (const variant of variants) {
        if (variant.editions.length === 0) {
            add({
                country: '',
                coverUrl: variant.coverUrl,
                disambiguation: variant.disambiguation,
                format: '',
                label: '',
                releaseMbid: variant.releaseMbid,
                title: variant.title,
                trackCount: variant.trackCount,
                year: variant.year,
            });
            continue;
        }
        for (const edition of variant.editions) {
            add({
                country: edition.country,
                coverUrl: edition.coverUrl || variant.coverUrl,
                disambiguation: variant.disambiguation,
                format: edition.format,
                label: edition.label,
                releaseMbid: edition.releaseMbid,
                title: variant.title,
                trackCount: variant.trackCount,
                year: edition.year || variant.year,
            });
        }
    }
    return rows;
};

// ---------------------------------------------------------------------------
// Fix round 1: forced applies and leaving the dead page
// ---------------------------------------------------------------------------

/** A 409 `poor_match` the user is being asked about - tied to ITS release. */
export interface PendingConfirm {
    matched: number;
    releaseMbid: string;
    total: number;
}

/**
 * Whether `force: true` may go out for `releaseMbid`. Only for the release whose
 * `poor_match` answer was confirmed: lb-bot's counts for release A say nothing
 * about release B, whose own guard must answer for itself.
 */
export const forceAllowed = (pending: null | PendingConfirm, releaseMbid: string): boolean =>
    !!pending && !!releaseMbid && pending.releaseMbid === releaseMbid;

export type LeaveDecision =
    | { id: string; kind: 'album' | 'artist' }
    | { kind: 'albums' }
    | { kind: 'stay' };

/**
 * After an apply or remove ends: where does the app go? Only off the dead album's
 * own route (a retag changes the Navidrome id, so that page is gone); anywhere
 * else the user stays. Then the new album when lb-bot gave its id (an apply only),
 * else the artist, else the album list - a route that is always valid.
 */
export const decideLeave = (input: {
    artistId: string;
    deadAlbumId: string;
    kind: 'apply' | 'remove';
    newAlbumId: string;
    pathname: string;
    /** The last row kept its release (a cover-only change): undoing it does not move the id (X7). */
    releaseUnchanged?: boolean;
}): LeaveDecision => {
    if (!input.deadAlbumId || !input.pathname.split('/').includes(input.deadAlbumId)) {
        return { kind: 'stay' };
    }
    if (input.kind === 'remove' && input.releaseUnchanged) return { kind: 'stay' };
    if (input.kind === 'apply' && input.newAlbumId) {
        return input.newAlbumId === input.deadAlbumId
            ? { kind: 'stay' }
            : { id: input.newAlbumId, kind: 'album' };
    }
    if (input.artistId) return { id: input.artistId, kind: 'artist' };
    return { kind: 'albums' };
};

// ---------------------------------------------------------------------------
// The poll as a plain async loop
// ---------------------------------------------------------------------------
//
// So the seed (X1), the silence clock (X2) and what is remembered afterwards (X3)
// are testable with a fake clock and a scripted server (`job-runner.harness.ts`);
// the React hook only supplies the real clock and the real read. Lives here, not in
// its own module, because the harness runs under Node's type stripping, where a
// relative import between two of these modules cannot carry the `.ts` suffix tsc
// refuses.

const finished = new Set<string>();

// The job kind joins the key: an undo keeps its row's id and setAt, so `id@setAt`
// alone would let an apply that ended hide a running remove of the same row.
const jobKey = (row: { id: string; setAt: number }, spec: PollSpec): string =>
    `${row.id}@${row.setAt}@${spec.active.join('|')}`;

/** A job that ended at rest (settled or failed) is not followed again in this process. */
export const wasFinished = (row: { id: string; setAt: number }, spec: PollSpec): boolean =>
    finished.has(jobKey(row, spec));

export const forgetFinishedJobs = (): void => finished.clear();

export const runJob = async <TRow extends PollRow>(input: {
    id: string;
    /** False once a newer job superseded this one or it was reset: stop without reporting. */
    isCurrent: () => boolean;
    now: () => number;
    onEnd?: (ended: PollState<TRow>) => void;
    onState: (state: PollState<TRow>) => void;
    read: (id: string) => Promise<PollAnswer<TRow>>;
    /** The state lb-bot already gave the row: the POST's own, or a resumed row's. */
    seedState?: string;
    spec: PollSpec;
    wait: (ms: number) => Promise<void>;
}): Promise<PollState<TRow>> => {
    let state = pollStart<TRow>(input.spec, input.now(), input.seedState);
    input.onState(state);
    while (state.phase === 'polling') {
        await input.wait(POLL_INTERVAL_MS);
        if (!input.isCurrent()) return state;
        const answer = await input.read(input.id);
        if (!input.isCurrent()) return state;
        state = pollStep(state, answer, input.now());
        input.onState(state);
    }
    // A timeout is not at rest: lb-bot may still be working, and a dismissed one may be picked up again.
    if ((state.phase === 'settled' || state.phase === 'failed') && state.row) {
        finished.add(jobKey(state.row, input.spec));
    }
    input.onEnd?.(state);
    return state;
};
