import { useState } from 'react';
import { generatePath } from 'react-router';

import { JobFailures, StillWorking } from '/@/renderer/features/lbbot/components/job-failures';
import {
    startArtistMerge,
    undoArtistMerge,
    useLbBotAvailable,
    useLbBotSiblings,
    useMergeControls,
    useMergeJobPoll,
    useMergePreview,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { canTryAgain, jobProgress } from '/@/renderer/features/lbbot/utils/album-override';
import {
    decideMergeLeave,
    defaultKeep,
    describeMergeFailure,
    MERGE_SPEC,
    mergeableOthers,
    mergeBlockView,
    mergeOutcomeSentence,
    planMerge,
    previewSentence,
    siblingGroupFor,
    UNDO_SPEC,
} from '/@/renderer/features/lbbot/utils/artist-merge';
import { currentRoutePath, leaveTo } from '/@/renderer/features/lbbot/utils/leave-page';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Progress } from '/@/shared/components/progress/progress';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LbBotMergeRow } from '/@/shared/types/lbbot-types';

/**
 * "Merge into one name" (I-023), inside the artist match dialog: shown when lb-bot
 * lists this artist in a group of library artists with the same MusicBrainz id
 * (`siblings`) and the hub advertises the merge route. Pick the other spelling
 * (when there are several), which name to keep (default: the one with the most
 * albums), read lb-bot's "N files in M albums", apply, follow, done. Undo is in the
 * Library Matches page. Every sentence is a field of an answer.
 */

export const ArtistMergeBlock = ({ ndId }: { ndId: string }) => {
    const available = useLbBotAvailable();
    const controls = useMergeControls();
    const group = siblingGroupFor(useLbBotSiblings(), ndId);
    const poll = useMergeJobPoll();

    // X5: collaboration credits are not spellings - never offered, never merged.
    const others = mergeableOthers(group, ndId);
    const [otherPick, setOtherPick] = useState('');
    const [keepPick, setKeepPick] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [started, setStarted] = useState(false);

    const self = group?.artists.find((a) => a.ndArtistId === ndId);
    const otherId = others.some((a) => a.ndArtistId === otherPick)
        ? otherPick
        : (others[0]?.ndArtistId ?? '');
    const other = others.find((a) => a.ndArtistId === otherId);
    const pair = [self, other].filter((a): a is NonNullable<typeof a> => !!a);
    const keepId = pair.some((a) => a.ndArtistId === keepPick) ? keepPick : defaultKeep(pair);
    const plan = planMerge(ndId, otherId, keepId);

    const preview = useMergePreview(plan, !!plan && !started);
    const previewFailure =
        preview.data && !preview.data.ok ? describeMergeFailure(preview.data) : null;
    const counts = preview.data?.ok ? preview.data.data : null;

    const view = mergeBlockView({
        controls,
        hasOthers: !!group && others.length > 0,
        poll: poll.state
            ? { kind: poll.state.spec === UNDO_SPEC ? 'undo' : 'merge', row: poll.state.row }
            : null,
    });
    if (view.kind === 'hidden') return null;

    const phase = poll.state?.phase ?? null;
    const row: LbBotMergeRow | null = poll.state?.row ?? null;
    const isUndo = poll.state?.spec === UNDO_SPEC;
    const progress = jobProgress(isUndo ? 'undo' : 'merge', row);

    const merge = async () => {
        if (!plan) return;
        setBusy(true);
        setError('');
        const result = await startArtistMerge(plan);
        setBusy(false);
        if (!result.ok || !result.data) {
            setError(describeMergeFailure(result).message);
            return;
        }
        setStarted(true);
        const into = plan.ndId;
        const from = plan.fromNdId;
        // The rewritten spelling's id is dead once the merge lands; if that is the
        // page being shown, move to the kept artist when the poll ends (dialog open or not).
        poll.start(result.data.id, MERGE_SPEC, {
            onEnd: (ended) => {
                if (ended.phase !== 'settled') return;
                const decision = decideMergeLeave({
                    fromNdId: from,
                    intoNdId: into,
                    pathname: currentRoutePath(),
                });
                if (decision.kind === 'artist') {
                    leaveTo(
                        generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, {
                            albumArtistId: decision.id,
                        }),
                    );
                }
            },
            seedState: result.data.state,
        });
    };

    const undo = async () => {
        if (!row) return;
        setBusy(true);
        setError('');
        const result = await undoArtistMerge(row.id);
        setBusy(false);
        if (!result.ok || !result.data) {
            setError(describeMergeFailure(result).message);
            return;
        }
        poll.start(result.data.id, UNDO_SPEC, { seedState: result.data.state });
    };

    return (
        <Stack gap="xs" py="sm">
            <Text fw={600} size="sm">
                Merge into one name
            </Text>
            {view.kind === 'form' && (
                <>
                    <Text isMuted size="sm">
                        Your library lists this artist under more than one spelling, all with the
                        same MusicBrainz id.
                    </Text>
                    {others.length > 1 && (
                        <Group gap="xs">
                            {others.map((a) => (
                                <Button
                                    key={a.ndArtistId}
                                    onClick={() => setOtherPick(a.ndArtistId)}
                                    size="compact-sm"
                                    variant={a.ndArtistId === otherId ? 'filled' : 'default'}
                                >
                                    {a.name}
                                </Button>
                            ))}
                        </Group>
                    )}
                    <Text size="sm">Keep this name:</Text>
                    <Group gap="xs">
                        {pair.map((a) => (
                            <Button
                                key={a.ndArtistId}
                                onClick={() => setKeepPick(a.ndArtistId)}
                                size="compact-sm"
                                variant={a.ndArtistId === keepId ? 'filled' : 'default'}
                            >
                                {`${a.name} (${a.albums} ${a.albums === 1 ? 'album' : 'albums'})`}
                            </Button>
                        ))}
                    </Group>
                    {preview.isFetching && (
                        <Text isMuted size="sm">
                            Counting what would change…
                        </Text>
                    )}
                    {counts && (
                        <Text size="sm">
                            {`lb-bot would retag ${previewSentence(counts.files, counts.albums)} to “${counts.into.name}”.`}
                        </Text>
                    )}
                    {previewFailure && previewFailure.kind !== 'older' && (
                        <Group gap="sm">
                            <Text c="red" size="sm">
                                {previewFailure.message}
                            </Text>
                            {canTryAgain(previewFailure) && (
                                <Button
                                    onClick={() => void preview.refetch()}
                                    size="compact-sm"
                                    variant="default"
                                >
                                    Try again
                                </Button>
                            )}
                        </Group>
                    )}
                    {error && (
                        <Text c="red" size="sm">
                            {error}
                        </Text>
                    )}
                    <Group justify="end">
                        <Button
                            disabled={busy || !available || !plan || !counts}
                            loading={busy}
                            onClick={() => void merge()}
                            variant="filled"
                        >
                            Merge
                        </Button>
                    </Group>
                </>
            )}
            {view.kind === 'job' && poll.state && (
                <Stack gap="xs">
                    {view.from && view.into && (
                        <Text isMuted size="sm">
                            {poll.state.spec === UNDO_SPEC
                                ? `${view.into} → ${view.from}`
                                : `${view.from} → ${view.into}`}
                        </Text>
                    )}
                    {phase === 'polling' && (
                        <>
                            <Text size="sm">{progress.text}</Text>
                            {progress.bar && <Progress value={progress.percent} />}
                        </>
                    )}
                    {(phase === 'settled' || phase === 'failed') && (
                        <Text c={phase === 'failed' ? 'red' : undefined} size="sm">
                            {mergeOutcomeSentence(isUndo ? 'undo' : 'merge', row)}
                        </Text>
                    )}
                    {phase === 'gone' && (
                        <Text c="red" size="sm">
                            lb-bot no longer has this merge.
                        </Text>
                    )}
                    {phase === 'timeout' && <StillWorking section="merged" />}
                    {/* Whenever the row failed or carries any problem, merge and undo alike. */}
                    {row && <JobFailures failures={row.failures} />}
                    {phase === 'failed' && !isUndo && (
                        <Text isMuted size="xs">
                            Undo puts back the names that were written.
                        </Text>
                    )}
                    {row && ((phase === 'settled' && !isUndo) || phase === 'failed') && (
                        <Group gap="sm">
                            <Button
                                disabled={busy}
                                onClick={() => void undo()}
                                size="compact-sm"
                                variant="default"
                            >
                                Undo
                            </Button>
                        </Group>
                    )}
                    {error && (
                        <Text c="red" size="sm">
                            {error}
                        </Text>
                    )}
                </Stack>
            )}
        </Stack>
    );
};
