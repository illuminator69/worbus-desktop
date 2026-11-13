import { Suspense, useMemo } from 'react';
import { generatePath, useNavigate } from 'react-router';

import styles from './lbbot-fresh-route.module.css';

import { DiscoverTile } from '/@/renderer/features/discover/components/discover-tile';
import {
    useLbBotAvailable,
    useLbBotFreshReleases,
    useOpenLbBotArtist,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    FreshScope,
    FreshSort,
    FreshType,
    useFreshDays,
    useFreshFiltersActions,
    useFreshScope,
    useFreshSort,
    useFreshType,
} from '/@/renderer/features/lbbot/stores/fresh-filters.store';
import { artistLinkPath, externalAlbumPath } from '/@/renderer/features/lbbot/utils/external-paths';
import {
    FRESH_SCOPE_WORDS,
    FRESH_TYPE_WORDS,
    freshBuckets,
    freshScopeInEffect,
    freshTileTarget,
} from '/@/renderer/features/lbbot/utils/fresh-order';
import { hasArtistPlays } from '/@/renderer/features/lbbot/utils/fresh-scope';
import { ForkCardGrid } from '/@/renderer/features/shared/components/fork-card-grid';
import { ForkListPage } from '/@/renderer/features/shared/components/fork-list-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useLibraryContextMenu } from '/@/renderer/features/shared/hooks/use-library-context-menu';
import { AppRoute } from '/@/renderer/router/routes';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';
import { LbBotFreshRelease } from '/@/shared/types/lbbot-types';

/**
 * navi-connect: new and upcoming releases, site-wide.
 *
 * Nothing to do with the home page's carousels, which query the user's own library
 * — this is ListenBrainz's fresh-releases feed, which is mostly music the library
 * does *not* have. That is the point: it is the front door to lb-bot's acquisition
 * side, and every artist and album on it is explorable whether or not the library
 * owns them.
 *
 * Shaped like lb-bot's own Fresh panel so the two read alike.
 */

const SCOPE_DATA: { label: string; value: FreshScope }[] = [
    { label: FRESH_SCOPE_WORDS.mine.label, value: 'mine' },
    { label: FRESH_SCOPE_WORDS.all.label, value: 'all' },
];

const DAYS_DATA = [
    { label: '7 days', value: '7' },
    { label: '30 days', value: '30' },
    { label: '90 days', value: '90' },
];

const TYPE_DATA: { label: string; value: FreshType }[] = (
    ['all', 'album', 'ep', 'single', 'other'] as const
).map((value) => ({ label: FRESH_TYPE_WORDS[value], value }));

const SORT_DATA: { label: string; value: FreshSort }[] = [
    { label: 'Newest', value: 'newest' },
    { label: 'Artist A–Z', value: 'artist' },
];

const FreshTile = ({ release }: { release: LbBotFreshRelease }) => {
    const navigate = useNavigate();
    const openMenu = useLibraryContextMenu();

    // Owned artist → the real artist page. Unowned but MusicBrainz-identified →
    // the virtual one, which renders their discography from lb-bot. Neither →
    // plain text, never a link to nowhere.
    const artistTo = artistLinkPath(
        release.artistOwned ? release.artistId : '',
        release.artistMbids[0] ?? '',
        release.artist,
    );
    // B-407: lb-bot's own match missed: the library is searched by name (B-313's rule) on tap.
    const artistLink = useOpenLbBotArtist();
    const artistRow = {
        artistId: release.artistOwned ? release.artistId : '',
        mbid: release.artistMbids[0] ?? '',
        name: release.artist,
        owned: release.artistOwned,
    };

    // An album the library holds opens the library album, full stop. This used
    // to send *every* row to the virtual page and rely on its redirect — which
    // needs a Navidrome album id from lb-bot's index, and an album lb-bot filled
    // itself has none (placement cannot write them). So a tile badged "In
    // library" opened a download page. The virtual page stays the fallback it
    // was designed to be.
    // `freshTileTarget` is this rule, shared with the Fresh shelf.
    const target = freshTileTarget(release);
    const albumTo =
        target?.kind === 'library'
            ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: target.albumId })
            : target
              ? externalAlbumPath(release)
              : undefined;

    // The app's card, as on Discover's Fresh row: "In library" and the date travel on it,
    // the artist line links to the artist, an absent release is dashed and faded.
    return (
        <DiscoverTile
            badge={
                release.releaseOwned ? (
                    <Badge className={styles.badge} size="xs">
                        In library
                    </Badge>
                ) : undefined
            }
            caption={[release.releaseDate, release.secondaryType || release.type]
                .filter(Boolean)
                .join(' · ')}
            // Straight from the Cover Art Archive, never through anything that would
            // attach this user's Navidrome or reverse-proxy headers to a third-party
            // request. ItemImage shows the album placeholder where there is none.
            imageUrl={release.coverUrl || null}
            isBusy={artistLink.isPending(artistRow)}
            isUnowned={!release.releaseOwned}
            itemType={LibraryItem.ALBUM}
            onClick={albumTo ? () => navigate(albumTo) : undefined}
            onContextMenu={(event) =>
                void openMenu(
                    event,
                    release.releaseAlbumId ? { id: release.releaseAlbumId, kind: 'album' } : null,
                )
            }
            onSubtitleClick={
                artistLink.looksUp(artistRow)
                    ? (event) => {
                          event.preventDefault();
                          artistLink.open(artistRow);
                      }
                    : undefined
            }
            subtitle={release.artist}
            subtitleTo={artistTo}
            title={release.releaseName}
        />
    );
};

const LbBotFreshRoute = () => {
    const days = useFreshDays();
    const storedScope = useFreshScope();
    const sort = useFreshSort();
    const type = useFreshType();
    const { set } = useFreshFiltersActions();

    const available = useLbBotAvailable();
    const query = useLbBotFreshReleases(days);
    // `keepPreviousData` holds the previous window's answer while the new one
    // loads. It is not this window's answer, so nothing below may describe it as
    // one (an empty window, a truncation count) — and with lb-bot unavailable the
    // new window will never load, so it is dropped rather than dimmed forever.
    const switching = query.isPlaceholderData;
    const data = switching && !available ? undefined : query.data;
    // A disabled react-query is `pending` forever, so `isLoading` alone would spin
    // indefinitely on a page reached by URL with lb-bot switched off. Placeholder
    // data leaves `isLoading` false, which is why switching counts separately.
    const loading = available && (query.isLoading || switching);

    // I-006: "Artists you play" exists only while some row carries `artistPlays`
    // (an older lb-bot sends none); a stored `plays` then reads as `mine`.
    const playsAvailable = hasArtistPlays(data?.releases);
    const scope = freshScopeInEffect(data?.releases, storedScope);
    const scopeData = playsAvailable
        ? [...SCOPE_DATA, { label: FRESH_SCOPE_WORDS.plays.label, value: 'plays' as FreshScope }]
        : SCOPE_DATA;

    // The order lives in `fresh-order.ts`, which the Fresh shelf (Home, Discover) reads too, so
    // the shelf is always this page's first rows (B-286).
    const buckets = useMemo(
        () =>
            freshBuckets(
                data?.releases,
                { scope, sort, type },
                // "This week" is relative to the wall clock and to nothing else. The memo re-runs
                // only when the rows or the filters change, so this reads the clock about as often
                // as the page changes, and a bucket boundary crossed while the page sits open is
                // worth exactly nothing to re-render for.
                // eslint-disable-next-line react-hooks/purity
                Date.now(),
            ),
        [data, scope, sort, type],
    );

    const total = buckets.reduce((sum, bucket) => sum + bucket.releases.length, 0);

    // Scope and type are which releases: chips, as on the app's other pages. The window is a
    // period: the segmented control. The order is a sort: a Select on the right.
    const filters = (
        <Group justify="space-between">
            <Group gap="lg">
                <Group gap="xs">
                    {scopeData.map((item) => (
                        <Button
                            key={item.value}
                            onClick={() => set({ scope: item.value })}
                            variant={scope === item.value ? 'filled' : 'subtle'}
                        >
                            {item.label}
                        </Button>
                    ))}
                </Group>
                <Group gap="xs">
                    {TYPE_DATA.map((item) => (
                        <Button
                            key={item.value}
                            onClick={() => set({ type: item.value })}
                            variant={type === item.value ? 'filled' : 'subtle'}
                        >
                            {item.label}
                        </Button>
                    ))}
                </Group>
            </Group>
            <Group gap="sm">
                <SegmentedControl
                    data={DAYS_DATA}
                    onChange={(value) => set({ days: Number(value) })}
                    value={String(days)}
                />
                {/* "Artists you play" orders the rows itself (most played
                    first); a sort control there would do nothing. */}
                {scope !== 'plays' && (
                    <Select
                        aria-label="Sort"
                        data={SORT_DATA}
                        onChange={(value) => value && set({ sort: value as FreshSort })}
                        value={sort}
                        width={150}
                    />
                )}
            </Group>
        </Group>
    );

    return (
        <ForkListPage
            count={loading && total === 0 ? null : total}
            countLoading={loading && total === 0}
            filters={filters}
            title="Fresh releases"
        >
            {/* The previous window's rows, dimmed, already say "loading"
                - unless there are none. */}
            {loading && total === 0 && <Spinner container />}

            {/* Fail-soft, like every other lb-bot read: an absent lb-bot and
                an unhappy ListenBrainz are both a sentence, not an error
                page - and they are different sentences. */}
            {/* Not over a feed on screen: a persisted or cached answer is
                shown while lb-bot is unreachable, and this sentence is the
                one thing it would contradict. */}
            {!available && !data && (
                <Text isMuted>
                    lb-bot is not configured on your hub, so there is no fresh-releases feed to
                    read.
                </Text>
            )}

            {available && !loading && !data && (
                <Text isMuted>
                    lb-bot could not reach the fresh-releases feed. It caches the feed for an hour,
                    so try again shortly.
                </Text>
            )}

            {!loading && data && total === 0 && (
                <Text isMuted>
                    {scope === 'mine'
                        ? 'Nothing new from artists in your library in this window. Try All, or a longer window.'
                        : scope === 'plays'
                          ? 'No release in this window matches that type from artists you play.'
                          : 'Nothing in this window.'}
                </Text>
            )}

            {/* The feed is capped before it crosses the hub, which
                cannot carry the whole site-wide window. Every artist
                in your library survives that cut whatever its size,
                so this only ever means "there are more releases by
                artists you don't have". */}
            {!loading && data?.truncated && total > 0 && (
                <Text isMuted size="sm">
                    {`Showing the ${data.releases.length} most-listened of ${data.total} releases, plus everything by artists in your library.`}
                </Text>
            )}

            {buckets.map((bucket) => (
                <Stack
                    gap="md"
                    key={bucket.label || 'all'}
                    // The previous window's rows, held on screen by
                    // `keepPreviousData` while the new window loads:
                    // dimmed, so they do not read as its answer.
                    style={switching ? { opacity: 0.5 } : undefined}
                >
                    {bucket.label && (
                        // The artist page's section heading: a title, its count, a rule.
                        <div className={styles.bucket}>
                            <Group>
                                <TextTitle fw={700} order={3}>
                                    {bucket.label}
                                </TextTitle>
                                <Badge>{bucket.releases.length}</Badge>
                            </Group>
                            <div className={styles.bucketRule} />
                        </div>
                    )}
                    <ForkCardGrid>
                        {bucket.releases.map((release) => (
                            <FreshTile
                                key={`${release.releaseMbid || release.releaseGroupMbid}-${release.artist}`}
                                release={release}
                            />
                        ))}
                    </ForkCardGrid>
                </Stack>
            ))}
        </ForkListPage>
    );
};

const LbBotFreshRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotFreshRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotFreshRouteWithBoundary;
