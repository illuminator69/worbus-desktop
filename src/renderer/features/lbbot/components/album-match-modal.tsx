import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import styles from './album-match-modal.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { JobFailures, StillWorking } from '/@/renderer/features/lbbot/components/job-failures';
import {
    LbModalLayout,
    lbModalSettings,
} from '/@/renderer/features/lbbot/components/lb-modal-layout';
import {
    applyAlbumOverride,
    removeAlbumOverride,
    setAlbumCover,
    useAlbumCovers,
    useAlbumJobPoll,
    useAlbumOverrideControls,
    useAlbumOverrideState,
    useAlbumPreview,
    useAlbumRgidLookup,
    useLbBotAlbumReleases,
    useLbBotAvailable,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    albumCommit,
    AlbumFailure,
    APPLY_SPEC,
    canTryAgain,
    commitSentence,
    coverQuery,
    describeAlbumFailure,
    editionRows,
    extractReleaseMbid,
    forceAllowed,
    isRunning,
    jobProgress,
    landingNote,
    nextAfterOverride,
    outcomeSentence,
    PendingConfirm,
    PollPhase,
    PollSpec,
    PollState,
    previewCounts,
    releaseUnchanged,
    releaseUrl,
    REMOVE_SPEC,
    rowStatusWords,
    slotLabel,
    summarizePreview,
    tagLineFor,
    wasFinished,
} from '/@/renderer/features/lbbot/utils/album-override';
import { leaveAfterAlbumJob } from '/@/renderer/features/lbbot/utils/leave-album';
import { AppRoute } from '/@/renderer/router/routes';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeModal, openModal } from '/@/shared/components/modal/modal';
import { Progress } from '/@/shared/components/progress/progress';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';
import { LbBotAlbumOverrideRow, LbBotPreview } from '/@/shared/types/lbbot-types';

/**
 * "Fix album match" (I-022): tell lb-bot which MusicBrainz release an owned album
 * is, see how it would renumber and retitle the files, optionally pick a cover,
 * apply, and undo. The album counterpart of the artist "Fix MusicBrainz match".
 *
 * Every sentence states only what lb-bot answered. In particular nothing here says
 * whether a favourite, rating or play count survives - that is not measured. The
 * one fixed sentence before apply is {@link commitSentence}. Worbus for Android mirrors the
 * steps and states by hand (PROTOCOL §15.5).
 */

interface AlbumMatchModalProps {
    albumId: string;
    /** The artist page to land on when the album's new id is not known yet. */
    artistId?: string;
}

const releaseLine = (release: LbBotPreview['release']): string =>
    [
        release.title,
        release.disambiguation ? `(${release.disambiguation})` : '',
        [
            release.year,
            release.country,
            release.format,
            release.trackCount > 0 ? `${release.trackCount} tracks` : '',
            release.discCount > 1 ? `${release.discCount} discs` : '',
        ]
            .filter(Boolean)
            .join(' · '),
    ]
        .filter(Boolean)
        .join(' — ');

const Failure = ({
    failure,
    onRetry,
}: {
    failure: AlbumFailure | { message: string };
    onRetry?: () => void;
}) => (
    <Group gap="sm">
        <Text c="red" size="sm">
            {failure.message}
        </Text>
        {onRetry && (
            <Button onClick={onRetry} size="compact-sm" variant="default">
                Try again
            </Button>
        )}
    </Group>
);

const PreviewTable = ({ preview }: { preview: LbBotPreview }) => {
    const [showAll, setShowAll] = useState(false);
    const summary = summarizePreview(preview);
    // The disc only when there is more than one: "1-02" on a single-disc album is noise.
    const multiDisc =
        preview.release.discCount > 1 ||
        preview.files.some((file) => file.from.disc > 1 || (file.to?.disc ?? 0) > 1);
    const rows = showAll
        ? preview.files
        : preview.files.filter((file) => file.to === null || file.changed);
    return (
        <Stack gap="xs">
            <Text size="sm">{releaseLine(preview.release)}</Text>
            <Text isMuted size="sm">
                {previewCounts(summary).join(' · ')}
            </Text>
            {summary.noSlot > 0 && (
                <Text isMuted size="xs">
                    Files with no place on this release are left untouched. Navidrome will then list
                    them as an album of their own.
                </Text>
            )}
            <div className={styles.table}>
                {rows.map((file, index) => {
                    // A file that is already right is dimmed; a change or a file with
                    // no place stays at full strength.
                    const dim = file.to !== null && !file.changed ? styles.dim : undefined;
                    return (
                        <div
                            key={`${file.from.disc}-${file.from.track}-${file.from.title}-${index}`}
                            style={{ display: 'contents' }}
                        >
                            <span className={dim}>{slotLabel(file.from, multiDisc)}</span>
                            <span className={dim}>→</span>
                            <span className={dim}>
                                {file.to
                                    ? slotLabel(file.to, multiDisc)
                                    : 'no place on this release — left as is'}
                            </span>
                            <span className={styles.dim}>{file.basis}</span>
                        </div>
                    );
                })}
            </div>
            {summary.unchanged > 0 && (
                <Group gap="xs">
                    <Text isMuted size="xs">
                        {showAll
                            ? `Showing all ${summary.total} files.`
                            : `${summary.unchanged} files already match and are not shown.`}
                    </Text>
                    <Button
                        onClick={() => setShowAll((value) => !value)}
                        size="compact-xs"
                        variant="subtle"
                    >
                        {showAll ? 'Hide unchanged' : 'Show all'}
                    </Button>
                </Group>
            )}
            {preview.missing.length > 0 && (
                <Text isMuted size="xs">
                    No file for:{' '}
                    {preview.missing.map((slot) => slotLabel(slot, multiDisc)).join('; ')}
                </Text>
            )}
        </Stack>
    );
};

const AlbumMatchModal = ({
    albumId,
    artistId,
    modalId,
}: AlbumMatchModalProps & { modalId: string }) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const available = useLbBotAvailable();
    const controls = useAlbumOverrideControls();
    const poll = useAlbumJobPoll();

    const [job, setJob] = useState<null | { kind: 'apply' | 'remove'; spec: PollSpec }>(null);
    const stateQuery = useAlbumOverrideState(albumId, !job);
    const answer = stateQuery.data;
    const state = answer?.ok ? answer.data : null;
    const stateFailure = answer && !answer.ok ? describeAlbumFailure(answer) : null;

    // The release group: lb-bot's own, else one validated lookup (never the first hit).
    const needsLookup = !!state && !state.rgid;
    const lookup = useAlbumRgidLookup(state?.artist ?? '', state?.album ?? '', needsLookup);
    const rgid = state?.rgid || lookup.data?.rgid || '';
    const lookupDeclined =
        needsLookup && !lookup.isFetching && !lookup.isError && lookup.data === null;

    const editions = useLbBotAlbumReleases(rgid || null);
    const rows = useMemo(
        () => editionRows(editions.data?.variants ?? [], state?.releaseMbid ?? ''),
        [editions.data, state?.releaseMbid],
    );

    const [picked, setPicked] = useState<null | string>(null);
    const [pasted, setPasted] = useState('');
    const [coverUrl, setCoverUrl] = useState('');
    const [coverSaved, setCoverSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<AlbumFailure | null>(null);
    const [confirm, setConfirm] = useState<null | PendingConfirm>(null);

    const parsed = extractReleaseMbid(pasted);
    const preview = useAlbumPreview(albumId, job ? null : picked);
    const previewData = preview.data?.ok ? preview.data.data : null;
    const previewFailure =
        preview.data && !preview.data.ok ? describeAlbumFailure(preview.data) : null;
    const summary = previewData ? summarizePreview(previewData) : null;

    // X8: a release that is not one of the listed editions (a pasted id) is asked
    // for by its own id alone; the album's old release group is not its group.
    const coverAsk = coverQuery({
        current: state?.releaseMbid ?? '',
        listed: new Set(rows.map((edition) => edition.releaseMbid)),
        picked,
        rgid,
    });
    const covers = useAlbumCovers(
        coverAsk.rgid,
        coverAsk.releaseMbid,
        !!state && !job && (!!picked || !!rgid),
    );
    const coverList = covers.data?.ok ? (covers.data.data ?? []) : null;
    const coverFailure = covers.data && !covers.data.ok ? describeAlbumFailure(covers.data) : null;
    // Changing the release invalidates a cover chosen for the previous one.
    useEffect(() => {
        setCoverUrl('');
        // An old error or poor_match question belongs to the previous release.
        setFailure(null);
        setConfirm(null);
    }, [picked]);

    // Leaving the dead page happens where the poll ends (it outlives this dialog),
    // not in an effect here. The route is read at that moment, not at render.
    const leave = (
        ended: PollState,
        kind: 'apply' | 'remove',
        startRow: LbBotAlbumOverrideRow | null,
    ) =>
        leaveAfterAlbumJob({
            artistId: artistId ?? '',
            deadAlbumId: albumId,
            ended,
            kind,
            startRow,
        });

    // An override that is still being worked on when the dialog opens is followed,
    // not offered a second apply - unless it already ended at rest and was dismissed
    // (X3). Seeded from the row's state so a job already failed ends at the first tick.
    const resumed = useRef(false);
    useEffect(() => {
        const row = state?.override;
        if (!row || resumed.current || job) return;
        const spec = REMOVE_SPEC.active.includes(row.state)
            ? REMOVE_SPEC
            : APPLY_SPEC.active.includes(row.state)
              ? APPLY_SPEC
              : null;
        if (!spec || wasFinished(row, spec)) return;
        resumed.current = true;
        const kind = spec === REMOVE_SPEC ? 'remove' : 'apply';
        setJob({ kind, spec });
        poll.start(row.id, spec, {
            onEnd: (ended) => leave(ended, kind, row),
            seedState: row.state,
        });
        // `leave` only closes over props that do not change while the dialog is open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job, poll, state?.override]);

    const row: LbBotAlbumOverrideRow | null = poll.state?.row ?? state?.override ?? null;
    const phase: null | PollPhase = poll.state?.phase ?? null;

    // The album the user was on is dead after a retag: follow it to its new id, or
    // to the artist, but only when that page is the one they are looking at.
    const where = nextAfterOverride(
        job?.kind === 'remove' ? '' : (poll.state?.row?.albumId ?? ''),
        artistId ?? '',
    );
    const open = () => {
        closeModal(modalId);
        if (where.kind === 'album')
            navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: where.id }));
        if (where.kind === 'artist') {
            navigate(
                generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: where.id }),
            );
        }
    };
    // `seedState` is the state of the POST's own 200 (X1).
    const begin = (
        kind: 'apply' | 'remove',
        id: string,
        seedState: string,
        startRow: LbBotAlbumOverrideRow | null,
    ) => {
        const spec = kind === 'apply' ? APPLY_SPEC : REMOVE_SPEC;
        setJob({ kind, spec });
        poll.start(id, spec, { onEnd: (ended) => leave(ended, kind, startRow), seedState });
    };

    // A confirmation only counts for the release it was asked about.
    const pending = forceAllowed(confirm, picked ?? '') ? confirm : null;

    const commit = albumCommit({
        changing: summary ? summary.changing : null,
        coverChosen: !!coverUrl,
        current: state?.releaseMbid ?? '',
        picked,
    });

    const apply = async (wantForce: boolean) => {
        if (!picked) return;
        const force = wantForce && forceAllowed(confirm, picked);
        setBusy(true);
        setFailure(null);
        const result = await applyAlbumOverride({
            albumId,
            coverUrl: coverUrl || undefined,
            force,
            releaseMbid: picked,
        });
        setBusy(false);
        if (!result.ok || !result.data) {
            const found = describeAlbumFailure(result);
            if (
                found.kind === 'poor_match' &&
                found.matched !== undefined &&
                found.total !== undefined
            ) {
                setConfirm({ matched: found.matched, releaseMbid: picked, total: found.total });
            } else {
                setConfirm(null);
                setFailure(found);
            }
            return;
        }
        setConfirm(null);
        begin('apply', result.data.id, result.data.state, null);
    };

    // The cover alone: the release stays and no tag is rewritten. The POST is
    // synchronous, so its own 200 is the answer - the row is not followed (it would
    // read as an apply of 0 files, or show an older row's counts).
    const saveCoverOnly = async () => {
        if (!coverUrl) return;
        setBusy(true);
        setFailure(null);
        setCoverSaved(false);
        const result = await setAlbumCover(albumId, coverUrl);
        setBusy(false);
        if (!result.ok || !result.data) {
            setFailure(describeAlbumFailure(result));
            return;
        }
        setCoverSaved(true);
        setCoverUrl('');
        // The row it created (or updated) is what Undo needs; the lists follow.
        void queryClient.invalidateQueries({
            queryKey: ['lbbot', 'overrides'],
            refetchType: 'all',
        });
        void stateQuery.refetch();
    };

    const undo = async (target: LbBotAlbumOverrideRow) => {
        setBusy(true);
        setFailure(null);
        setCoverSaved(false);
        const result = await removeAlbumOverride(target.id);
        setBusy(false);
        if (!result.ok || !result.data) {
            setFailure(describeAlbumFailure(result));
            return;
        }
        // The row held NOW decides whether the undo moves the album's id (X7).
        begin('remove', result.data.id, result.data.state, target);
    };

    const when = (epochSeconds: number): string =>
        epochSeconds > 0 ? new Date(epochSeconds * 1000).toLocaleString() : '';

    // ---- rendering --------------------------------------------------------
    if (!controls) {
        return (
            <LbModalLayout>
                <Text isMuted size="sm">
                    {available
                        ? 'This lb-bot is older and cannot fix album matches yet.'
                        : 'lb-bot is not reachable, so nothing can be changed right now.'}
                </Text>
            </LbModalLayout>
        );
    }

    const inFlight = job && phase === 'polling';
    const progress = jobProgress(job?.kind ?? 'apply', row);
    const landing =
        job?.kind === 'apply' && phase === 'settled' && where.kind === 'artist'
            ? landingNote('apply', poll.state?.row?.albumId ?? '')
            : null;
    const showPicker = !job && !!state;
    const currentRow = rows.find((edition) => edition.current);
    const tagLine = tagLineFor({
        files: state?.tracks.length ?? 0,
        job: !!job,
        listed: currentRow ?? null,
        releaseMbid: state?.releaseMbid ?? '',
    });

    const footer = showPicker ? (
        <Stack gap="xs">
            {coverSaved && (
                <Text size="sm">
                    The cover was saved. You can undo it at the top of this dialog.
                </Text>
            )}
            {summary && picked && !pending && commit === 'apply' && (
                <Text size="sm">{commitSentence(summary.changing)}</Text>
            )}
            {summary && picked && summary.changing === 0 && commit === 'nothing' && (
                <Text isMuted size="sm">
                    No file would change.
                </Text>
            )}
            {commit === 'cover-only' && (
                <Text isMuted size="sm">
                    No file would change. Only the cover is saved; the release stays.
                </Text>
            )}
            {pending && (
                <Text size="sm">
                    Only {pending.matched} of the {pending.total} files have a place on this
                    release. Apply anyway?
                </Text>
            )}
            {failure && (
                <Failure
                    failure={failure}
                    onRetry={failure.kind === 'retry' ? () => void apply(!!pending) : undefined}
                />
            )}
            <Group gap="sm" justify="end">
                {picked && pending && (
                    <Button
                        disabled={busy}
                        loading={busy}
                        onClick={() => void apply(true)}
                        variant="filled"
                    >
                        Apply anyway
                    </Button>
                )}
                {picked && !pending && commit !== 'cover-only' && (
                    <Button
                        disabled={busy || commit !== 'apply'}
                        loading={busy}
                        onClick={() => void apply(false)}
                        variant="filled"
                    >
                        Apply
                    </Button>
                )}
                {commit === 'cover-only' && (
                    <Button
                        disabled={busy}
                        loading={busy}
                        onClick={() => void saveCoverOnly()}
                        variant="filled"
                    >
                        Save this cover
                    </Button>
                )}
                <Button onClick={() => closeModal(modalId)} variant="subtle">
                    Close
                </Button>
            </Group>
        </Stack>
    ) : undefined;

    return (
        <LbModalLayout footer={footer}>
            <div>
                {!state && !stateFailure && (
                    <Stack gap="xs" py="sm">
                        <Skeleton height={16} width="60%" />
                        <Skeleton height={16} width="40%" />
                    </Stack>
                )}
                {stateFailure && stateFailure.kind !== 'older' && (
                    <Failure
                        failure={stateFailure}
                        onRetry={
                            stateFailure.kind === 'retry'
                                ? () => void stateQuery.refetch()
                                : undefined
                        }
                    />
                )}
                {stateFailure?.kind === 'older' && (
                    <Text isMuted size="sm">
                        {stateFailure.message}
                    </Text>
                )}

                {state && (
                    <div className={styles.section}>
                        <Stack gap={2}>
                            <Text fw={600} size="sm">
                                {state.artist} — {state.album}
                            </Text>
                            {tagLine.kind !== 'none' && (
                                <Text isMuted size="sm">
                                    {tagLine.kind === 'untagged' &&
                                        'Not tagged with a MusicBrainz release.'}
                                    {tagLine.kind === 'edition' && `Tagged as ${tagLine.text}.`}
                                    {tagLine.kind === 'id' && (
                                        <>
                                            {'Tagged with MusicBrainz release '}
                                            <a
                                                href={releaseUrl(tagLine.releaseMbid)}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                {tagLine.releaseMbid}
                                            </a>
                                            {'.'}
                                        </>
                                    )}
                                    {tagLine.files > 0 ? ` ${tagLine.files} files.` : ''}
                                </Text>
                            )}
                            {state.override && !job && (
                                <Stack gap="xs">
                                    <Group gap="sm">
                                        <Text isMuted size="sm">
                                            {state.override.state === 'failed'
                                                ? `A change lb-bot made on ${when(state.override.setAt)} did not finish (${state.override.done} of ${state.override.total} files written).`
                                                : releaseUnchanged(state.override)
                                                  ? `Cover changed by lb-bot on ${when(state.override.setAt)}.`
                                                  : `Changed by lb-bot on ${when(state.override.setAt)}.`}
                                            {rowStatusWords('album', state.override) &&
                                            state.override.state !== 'failed'
                                                ? ` (${rowStatusWords('album', state.override)})`
                                                : ''}
                                        </Text>
                                        <Button
                                            disabled={busy || isRunning(state.override.state)}
                                            onClick={() => void undo(state.override!)}
                                            size="compact-sm"
                                            variant="default"
                                        >
                                            Undo
                                        </Button>
                                    </Group>
                                    <JobFailures failures={state.override.failures} />
                                </Stack>
                            )}
                        </Stack>
                    </div>
                )}

                {job && (
                    <div className={styles.section}>
                        <Stack gap="xs">
                            {inFlight && (
                                <>
                                    <Text size="sm">{progress.text}</Text>
                                    {progress.bar && <Progress value={progress.percent} />}
                                </>
                            )}
                            {phase === 'settled' && (
                                <Text size="sm">{outcomeSentence(job.kind, row)}</Text>
                            )}
                            {phase === 'failed' && (
                                <Text c="red" size="sm">
                                    {outcomeSentence(job.kind, row)}
                                </Text>
                            )}
                            {phase === 'gone' && (
                                <Text c="red" size="sm">
                                    lb-bot no longer has this change.
                                </Text>
                            )}
                            {phase === 'timeout' && <StillWorking section="albums" />}
                            {/* Whenever the row failed or carries any problem, for both
                            kinds: lb-bot's reasons say what a second Undo will do. */}
                            {row && <JobFailures failures={row.failures} />}
                            {phase === 'failed' && job.kind === 'apply' && (
                                <Text isMuted size="xs">
                                    Undo restores the tags that were written.
                                </Text>
                            )}
                            {landing && (
                                <Text isMuted size="xs">
                                    {landing}
                                </Text>
                            )}
                            {phase !== null && phase !== 'polling' && (
                                <Group gap="sm">
                                    {where.kind !== 'none' &&
                                        phase === 'settled' &&
                                        job.kind === 'apply' && (
                                            <Button
                                                onClick={open}
                                                size="compact-sm"
                                                variant="filled"
                                            >
                                                {where.kind === 'album'
                                                    ? 'Open the album'
                                                    : 'Open the artist'}
                                            </Button>
                                        )}
                                    {row &&
                                        ((phase === 'settled' && job.kind === 'apply') ||
                                            phase === 'failed') && (
                                            <Button
                                                disabled={busy}
                                                onClick={() => {
                                                    void undo(row);
                                                }}
                                                size="compact-sm"
                                                variant="default"
                                            >
                                                Undo
                                            </Button>
                                        )}
                                    <Button
                                        onClick={() => closeModal(modalId)}
                                        size="compact-sm"
                                        variant="subtle"
                                    >
                                        Close
                                    </Button>
                                </Group>
                            )}
                            {failure && <Failure failure={failure} />}
                        </Stack>
                    </div>
                )}

                {showPicker && (
                    <div className={styles.section}>
                        <Stack gap="xs">
                            <Text fw={600} size="sm">
                                Which release is this album?
                            </Text>
                            {needsLookup && lookup.isFetching && (
                                <Text isMuted size="sm">
                                    Looking up this album on MusicBrainz…
                                </Text>
                            )}
                            {needsLookup && lookup.isError && (
                                <Failure
                                    failure={{
                                        message:
                                            'The release-group lookup failed, so the editions could not be listed.',
                                    }}
                                    onRetry={() => void lookup.refetch()}
                                />
                            )}
                            {lookupDeclined && (
                                <Text isMuted size="sm">
                                    lb-bot does not know this album’s release group, so it cannot
                                    list its editions. Paste a MusicBrainz release id or a
                                    musicbrainz.org/release/… address below instead.
                                </Text>
                            )}
                            {rgid && editions.isFetching && !editions.data && (
                                <Text isMuted size="sm">
                                    Reading editions from MusicBrainz…
                                </Text>
                            )}
                            {rgid && !editions.isFetching && editions.data === null && (
                                <Failure
                                    failure={{
                                        message:
                                            'lb-bot could not read this album’s editions from MusicBrainz.',
                                    }}
                                    onRetry={() => void editions.refetch()}
                                />
                            )}
                            {rgid && editions.data && rows.length === 0 && (
                                <Text isMuted size="sm">
                                    MusicBrainz lists no editions for this album.
                                </Text>
                            )}
                            {rows.map((edition) => (
                                <div
                                    className={clsx(styles.edition, {
                                        [styles.selected]: picked === edition.releaseMbid,
                                    })}
                                    key={edition.releaseMbid}
                                >
                                    <Stack gap={0}>
                                        <Group gap="xs" wrap="nowrap">
                                            <Text className={styles.name} fw={600} size="sm">
                                                {edition.title}
                                                {edition.disambiguation
                                                    ? ` (${edition.disambiguation})`
                                                    : ''}
                                            </Text>
                                            {edition.current && (
                                                <Badge size="xs" variant="filled">
                                                    Tagged now
                                                </Badge>
                                            )}
                                        </Group>
                                        <Text isMuted size="xs">
                                            {[
                                                edition.label,
                                                edition.year,
                                                edition.country,
                                                edition.format,
                                                edition.trackCount > 0
                                                    ? `${edition.trackCount} tracks`
                                                    : '',
                                            ]
                                                .filter(Boolean)
                                                .join(' · ') || 'No further detail'}
                                        </Text>
                                    </Stack>
                                    <Button
                                        disabled={busy}
                                        onClick={() => setPicked(edition.releaseMbid)}
                                        size="compact-sm"
                                        variant={
                                            picked === edition.releaseMbid ? 'filled' : 'default'
                                        }
                                    >
                                        {picked === edition.releaseMbid ? 'Chosen' : 'Preview'}
                                    </Button>
                                </div>
                            ))}
                            <Group align="flex-end" gap="xs" wrap="nowrap">
                                <TextInput
                                    error={
                                        pasted.trim() && !parsed
                                            ? 'Not a MusicBrainz release id or address'
                                            : null
                                    }
                                    label="Or paste a release MBID or musicbrainz.org/release/… address"
                                    onChange={(event) => setPasted(event.currentTarget.value)}
                                    style={{ flex: 1 }}
                                    value={pasted}
                                />
                                <Button
                                    disabled={busy || !parsed}
                                    onClick={() => parsed && setPicked(parsed)}
                                    variant="default"
                                >
                                    Preview this id
                                </Button>
                            </Group>
                        </Stack>
                    </div>
                )}

                {showPicker && picked && (
                    <div className={styles.section}>
                        {preview.isFetching && (
                            <Text isMuted size="sm">
                                Comparing the files with this release…
                            </Text>
                        )}
                        {!preview.isFetching &&
                            previewFailure &&
                            previewFailure.kind !== 'older' && (
                                <Failure
                                    failure={previewFailure}
                                    onRetry={
                                        canTryAgain(previewFailure)
                                            ? () => void preview.refetch()
                                            : undefined
                                    }
                                />
                            )}
                        {!preview.isFetching && previewData && (
                            <PreviewTable preview={previewData} />
                        )}
                    </div>
                )}

                {showPicker && (picked ? !!previewData : !!rgid) && (
                    <div className={styles.section}>
                        <Stack gap="xs">
                            <Text fw={600} size="sm">
                                Cover
                            </Text>
                            {covers.isFetching && !covers.data && (
                                <Text isMuted size="sm">
                                    Looking for covers on the Cover Art Archive…
                                </Text>
                            )}
                            {coverFailure && (
                                <Failure
                                    failure={coverFailure}
                                    onRetry={
                                        coverFailure.kind === 'retry'
                                            ? () => void covers.refetch()
                                            : undefined
                                    }
                                />
                            )}
                            {coverList && coverList.length === 0 && (
                                <Text isMuted size="sm">
                                    The Cover Art Archive has no covers for this release. The
                                    current cover stays.
                                </Text>
                            )}
                            {coverList && coverList.length > 0 && (
                                <div className={styles.covers}>
                                    <button
                                        aria-pressed={coverUrl === ''}
                                        className={clsx(styles.cover, styles.keep, {
                                            [styles.chosen]: coverUrl === '',
                                        })}
                                        onClick={() => setCoverUrl('')}
                                        type="button"
                                    >
                                        Keep the current cover
                                    </button>
                                    {coverList.map((cover) => (
                                        <button
                                            aria-pressed={coverUrl === cover.full}
                                            className={clsx(styles.cover, {
                                                [styles.chosen]: coverUrl === cover.full,
                                            })}
                                            key={cover.full}
                                            onClick={() => setCoverUrl(cover.full)}
                                            type="button"
                                        >
                                            {/* The app's image: a cover the Archive lists but
                                                cannot serve shows the album placeholder, not a
                                                broken-image icon. */}
                                            <ItemImage
                                                className={styles.coverImage}
                                                containerClassName={styles.coverThumb}
                                                itemType={LibraryItem.ALBUM}
                                                src={cover.thumb}
                                                type="table"
                                            />
                                            {cover.source === 'release'
                                                ? 'This release'
                                                : 'Release group'}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </Stack>
                    </div>
                )}
            </div>
        </LbModalLayout>
    );
};

export const openAlbumMatchModal = (props: AlbumMatchModalProps & { title?: string }) => {
    const modalId = `album-match-${props.albumId}`;
    openModal({
        ...lbModalSettings(
            props.title ? `Fix album match: ${props.title}` : 'Fix album match',
            <AlbumMatchModal albumId={props.albumId} artistId={props.artistId} modalId={modalId} />,
        ),
        modalId,
    });
};
