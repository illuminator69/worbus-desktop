import { Suspense, useMemo, useState } from 'react';

import styles from '../components/listening.module.css';

import { RoleGatedRoute } from '/@/renderer/features/hub/components/role-gated-route';
import {
    isListeningUnavailable,
    LbBotReadError,
    useLbBotAvailable,
    useListeningRecent,
    useListeningStatus,
    useListeningSummary,
    useListeningSupported,
    useListeningUnowned,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useListeningSync } from '/@/renderer/features/lbbot/hooks/use-sync-watch';
import {
    DailyChart,
    Genres,
    Heatmap,
    HoursChart,
    RecentSection,
    StatTiles,
    TopLists,
    UnownedSection,
} from '/@/renderer/features/listening/components/listening-sections';
import {
    DEFAULT_PERIOD,
    DEFAULT_TAB,
    LISTENING_TABS,
    ListeningTab,
    PERIOD_OPTIONS,
    readState,
    showsPeriodPicker,
    statusLines,
    statusView,
} from '/@/renderer/features/listening/listening-logic';
import { ForkListPage } from '/@/renderer/features/shared/components/fork-list-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LbBotListeningPeriod } from '/@/shared/types/lbbot-types';

/**
 * navi-connect: My Listening — aggregates over the user's ListenBrainz history,
 * mirrored by lb-bot. Everything shown is a field of lb-bot's answer.
 *
 * By `status.state`: `off` → an explanation and nothing else; `importing` →
 * "Importing N of M" above whatever the summary already holds; `error` → the
 * stored numbers plus lb-bot's error text; `ready` → the numbers. Offline, the
 * persisted body for the period is shown with a note. A route that is not there
 * (lb-bot older than the hub, 404) shows one quiet sentence, never an error.
 */
const errorOf = (error: Error | null): null | { message: string; status: number } =>
    error
        ? { message: error.message, status: error instanceof LbBotReadError ? error.status : 0 }
        : null;

/** A stored epoch-seconds timestamp as the status line shows it. */
const when = (epochSeconds: null | number): string =>
    epochSeconds ? new Date(epochSeconds * 1000).toLocaleString() : 'never';

/** The one period control: drawn on the tabs whose content it changes (L2). */
const PeriodPicker = ({
    onChange,
    value,
}: {
    onChange: (period: LbBotListeningPeriod) => void;
    value: LbBotListeningPeriod;
}) => (
    <SegmentedControl
        data={PERIOD_OPTIONS}
        onChange={(next) => onChange(next as LbBotListeningPeriod)}
        value={value}
    />
);

const ListeningRoute = () => {
    const [period, setPeriod] = useState<LbBotListeningPeriod>(DEFAULT_PERIOD);
    const [tab, setTab] = useState<ListeningTab>(DEFAULT_TAB);
    const [unownedKind, setUnownedKind] = useState<'album' | 'artist'>('album');

    const available = useLbBotAvailable();
    const supported = useListeningSupported();
    const statusQuery = useListeningStatus();
    const view = statusQuery.data ? statusView(statusQuery.data) : null;
    const off = view?.kind === 'off';
    const older = [statusQuery.error].some(isListeningUnavailable);
    // Nothing to read when the mirror is off, or an answer said this lb-bot is older.
    const readable = !off && !older;
    const summaryQuery = useListeningSummary(period, view?.poll === true, readable);
    // Only the tab that shows a list reads it.
    const unownedQuery = useListeningUnowned(
        period,
        unownedKind,
        readable && tab === 'not-in-library',
    );
    const recentQuery = useListeningRecent(readable && tab === 'history');

    // `keepPreviousData` holds the PREVIOUS period's body while the new one loads:
    // it is not this period's answer, so it is dimmed while fetching and dropped
    // when nothing can fetch (lb-bot unreachable would leave it standing for good).
    const placeholder = summaryQuery.isPlaceholderData;
    const summary = placeholder && !supported ? undefined : summaryQuery.data;
    const recentRows = useMemo(
        () => recentQuery.data?.pages.flatMap((page) => page.rows) ?? [],
        [recentQuery.data],
    );
    const unavailable = [statusQuery.error, summaryQuery.error].some(isListeningUnavailable);
    const loading = supported && !summary && !off && summaryQuery.isPending;
    const listeningSync = useListeningSync();
    // A status that could not be read is no status (a failed re-read leaves the last
    // data in place); the line says what the read is doing instead.
    const status = statusQuery.isError ? null : (statusQuery.data ?? null);
    const statusBlock = status ? statusLines(status, when) : null;
    // Asked for only where lb-bot can do it: the routes exist, this lb-bot is not
    // older, and a ListenBrainz user is configured (`off` has nothing to pull).
    const canSync = supported && !older && !off;
    const summaryTab = tab === 'overview' || tab === 'activity';
    const picker = showsPeriodPicker(tab) && !!summary && !off;

    return (
        <ForkListPage
            actions={
                canSync && (
                    <Button
                        disabled={!available || listeningSync.watching || listeningSync.starting}
                        loading={listeningSync.watching || listeningSync.starting}
                        onClick={() => void listeningSync.sync()}
                        variant="default"
                    >
                        Sync now
                    </Button>
                )
            }
            filters={
                supported &&
                !off &&
                !unavailable && (
                    <Group gap="xs">
                        {LISTENING_TABS.map((item) => (
                            <Button
                                key={item.id}
                                onClick={() => setTab(item.id)}
                                variant={tab === item.id ? 'filled' : 'subtle'}
                            >
                                {item.label}
                            </Button>
                        ))}
                    </Group>
                )
            }
            title="My Listening"
        >
            <Stack gap="xl">
                {/* The status, ONCE (L8): a banner when there is something to say
                (importing, error, off), a plain line only when ready. */}
                {supported && !older && (
                    <Stack gap={2}>
                        {statusBlock?.banner && (
                            <div className={styles.banner}>
                                <Text weight={600}>{statusBlock.banner.headline}</Text>
                                <Text isMuted size="sm">
                                    {statusBlock.banner.detail}
                                </Text>
                            </div>
                        )}
                        {statusBlock?.line && (
                            <Text isMuted size="sm">
                                {statusBlock.line}
                            </Text>
                        )}
                        {statusBlock?.meta && (
                            <Text isMuted size="xs">
                                {statusBlock.meta}
                            </Text>
                        )}
                        {!statusBlock && (
                            <Text isMuted size="sm">
                                {!available
                                    ? 'lb-bot is needed for this and is not reachable.'
                                    : statusQuery.isError
                                      ? 'Could not read the listening status.'
                                      : 'Loading…'}
                            </Text>
                        )}
                        {listeningSync.text && <Text size="sm">{listeningSync.text}</Text>}
                        {listeningSync.error && (
                            <Text
                                c={listeningSync.error.older ? undefined : 'red'}
                                isMuted={listeningSync.error.older}
                                size="sm"
                            >
                                {`Listening: ${listeningSync.error.message}`}
                            </Text>
                        )}
                    </Stack>
                )}

                {unavailable || (!supported && !summary && available) ? (
                    <Text isMuted>This lb-bot or hub does not provide listening history yet.</Text>
                ) : null}

                {!supported && !available && !summary && (
                    <Text isMuted>
                        lb-bot is not reachable, so there is no listening history to read.
                    </Text>
                )}

                {!available && summary && (
                    <Text isMuted size="sm">
                        lb-bot is not reachable. Showing the last numbers it gave.
                    </Text>
                )}

                {summaryTab && loading && <Spinner container />}

                {/* A failure is not "nothing here": no body, not a 404 (that has
                    its own sentence), and the read errored. */}
                {summaryTab &&
                    supported &&
                    !summary &&
                    !unavailable &&
                    !off &&
                    summaryQuery.isError && (
                        <Group gap="sm">
                            <Text isMuted>
                                {summaryQuery.error.message || 'Could not load listening history.'}
                            </Text>
                            {!(
                                summaryQuery.error instanceof LbBotReadError &&
                                summaryQuery.error.status === 400
                            ) && (
                                <Button
                                    onClick={() => void summaryQuery.refetch()}
                                    size="compact-sm"
                                    variant="default"
                                >
                                    Retry
                                </Button>
                            )}
                        </Group>
                    )}

                {tab === 'overview' && picker && (
                    <PeriodPicker onChange={setPeriod} value={period} />
                )}

                {tab === 'overview' && summary && !off && (
                    <div className={styles.stack} style={{ opacity: placeholder ? 0.5 : 1 }}>
                        {summary.totals.plays === 0 && view?.kind !== 'importing' && (
                            <Text isMuted>No listens in this period.</Text>
                        )}
                        <StatTiles summary={summary} />
                        <TopLists period={period} summary={summary} />
                        <Genres summary={summary} />
                    </div>
                )}

                {tab === 'activity' && summary && !off && (
                    <div className={styles.stack} style={{ opacity: placeholder ? 0.5 : 1 }}>
                        <Heatmap summary={summary} />
                        {picker && <PeriodPicker onChange={setPeriod} value={period} />}
                        <DailyChart period={period} summary={summary} />
                        <HoursChart summary={summary} />
                    </div>
                )}

                {tab === 'history' && supported && !off && !unavailable && (
                    <RecentSection
                        hasMore={recentQuery.hasNextPage}
                        loadingMore={recentQuery.isFetchingNextPage}
                        onMore={() => void recentQuery.fetchNextPage()}
                        onRetry={() => void recentQuery.refetch()}
                        read={readState({
                            available,
                            error: errorOf(recentQuery.error),
                            fetching: recentQuery.isFetching,
                            hasData: recentQuery.data !== undefined,
                            rowCount: recentRows.length,
                            supported,
                        })}
                        rows={recentRows}
                    />
                )}

                {tab === 'not-in-library' && supported && !off && !unavailable && (
                    <>
                        <PeriodPicker onChange={setPeriod} value={period} />
                        <UnownedSection
                            kind={unownedKind}
                            onKind={setUnownedKind}
                            onRetry={() => void unownedQuery.refetch()}
                            period={period}
                            read={readState({
                                available,
                                error: errorOf(unownedQuery.error),
                                fetching: unownedQuery.isFetching,
                                hasData: unownedQuery.data !== undefined,
                                rowCount: unownedQuery.data?.rows.length ?? 0,
                                supported,
                            })}
                            rows={unownedQuery.data?.rows}
                        />
                    </>
                )}
            </Stack>
        </ForkListPage>
    );
};

const ListeningRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            {/* Worbus P2 (R28): the primary user's only - never another account's cached plays. */}
            <RoleGatedRoute gate="listening">
                <ListeningRoute />
            </RoleGatedRoute>
        </Suspense>
    </PageErrorBoundary>
);

export default ListeningRouteWithBoundary;
