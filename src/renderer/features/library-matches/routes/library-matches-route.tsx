import { Suspense, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { AlbumMatchRow, ArtistOverrideRow, MergedRow, ToCheckRow } from '../components/match-rows';

import { RoleGatedRoute } from '/@/renderer/features/hub/components/role-gated-route';
import { ToFixSection } from '/@/renderer/features/lbbot/components/to-fix-section';
import {
    useAlbumOverrideControls,
    useLbBotAttention,
    useLbBotAvailable,
    useLbBotDownloadsShown,
    useLbBotOverrideList,
    useMergeControls,
    useOverrideControls,
    useOverridesOlder,
    useOverridesSupported,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useMirrorRefresh } from '/@/renderer/features/lbbot/hooks/use-sync-watch';
import {
    getIndexMirrorSnapshot,
    subscribeIndexMirror,
} from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import { libraryToFixCount } from '/@/renderer/features/lbbot/lb-page-link';
import { sortOverrides } from '/@/renderer/features/lbbot/utils/lbbot-data';
import {
    currentSection,
    hubMatchesLine,
    MatchSection,
    matchSections,
    SectionCounts,
    sectionFromSearch,
} from '/@/renderer/features/lbbot/utils/matches-page';
import { ForkListPage } from '/@/renderer/features/shared/components/fork-list-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

/**
 * navi-connect: Library Matches (I-024) - what lb-bot holds on this app's behalf and
 * the ways to correct it, moved here from the "lb-bot data" settings section.
 *
 * Switchable sections as filter chips with their counts (the Downloads page's pattern):
 * B-406's To fix (lb-bot's imports and downloaded folders to file), artists lb-bot is unsure about, the MusicBrainz artist overrides, the
 * album matches lb-bot rewrote, and merged artist names. Each section shows only
 * what this hub and lb-bot can serve: nothing for a hub that does not advertise the
 * routes, no "To check" for an lb-bot that sends no `toCheck` (older - absent is
 * not the same as empty). With lb-bot unreachable the saved lists still render and
 * every action that needs it is disabled. The index mirror is a quiet line at the
 * foot with its own Refresh.
 */

const LibraryMatchesRoute = () => {
    const { t } = useTranslation();
    const available = useLbBotAvailable();
    // Worbus P2: an admin's page; the route gate (below) keeps a non-admin off it.
    const overridesSupported = useOverridesSupported();
    const controls = useOverrideControls();
    const older = useOverridesOlder();
    const albumControls = useAlbumOverrideControls();
    const mergeControls = useMergeControls();
    const list = useLbBotOverrideList();
    const mirror = useSyncExternalStore(subscribeIndexMirror, getIndexMirrorSnapshot);
    const refresh = useMirrorRefresh();
    // B-406 review L3: the section is in the URL (`?section=albums`), so StillWorking's link lands
    // on the result and a chip's choice is kept per history entry; none is the landing section.
    const [searchParams, setSearchParams] = useSearchParams();
    const chosen = sectionFromSearch(`?${searchParams.toString()}`);
    const setChosen = (id: MatchSection) =>
        setSearchParams({ section: id }, { preventScrollReset: true, replace: true });
    // B-406 (the owner's ruling, 2026-11-13): lb-bot's To fix lives here. No `/lb/attention` answer
    // (an older hub or lb-bot, lb-bot away) offers no chip: absent is not empty.
    const attention = useLbBotAttention().data;
    const downloadsOn = useLbBotDownloadsShown();

    const data = list.data;
    const overrides = data ? sortOverrides(data.byNdId) : [];
    const toCheck = data?.toCheck ?? null;
    const albums = data?.albums ?? null;
    const merges = data?.merges ?? null;
    const usable = overridesSupported && !older;

    // A count is null when that list is not offered here: absent is not empty.
    const counts: SectionCounts = {
        albums: albumControls && albums !== null ? albums.length : null,
        artists: usable && data ? overrides.length : null,
        merges: mergeControls && merges !== null ? merges.length : null,
        toCheck: usable && toCheck !== null ? toCheck.length : null,
        toFix: attention ? libraryToFixCount(attention, downloadsOn) : null,
    };
    const sections = matchSections(counts);
    const section = currentSection(chosen, counts);
    const rowsAvailable = available && controls;

    return (
        <ForkListPage
            count={sections.find((item) => item.id === section)?.count}
            filters={
                sections.length > 0 && (
                    <Group gap="xs">
                        {sections.map((item) => (
                            <Button
                                key={item.id}
                                onClick={() => setChosen(item.id)}
                                variant={section === item.id ? 'filled' : 'subtle'}
                            >
                                {`${item.label} (${item.count})`}
                            </Button>
                        ))}
                    </Group>
                )
            }
            title={t('naviConnect.libraryMatches.title')}
        >
            <Text isMuted size="sm">
                {t('naviConnect.libraryMatches.intro')}
            </Text>
            {!available && (
                <Text isMuted size="sm">
                    lb-bot is not reachable. What is listed below was saved by this app; changes
                    need lb-bot.
                </Text>
            )}
            {hubMatchesLine(overridesSupported, counts.toFix !== null) && (
                <Text isMuted>{hubMatchesLine(overridesSupported, counts.toFix !== null)}</Text>
            )}
            {overridesSupported && older && (
                <Text isMuted>This lb-bot is older and cannot store overrides yet.</Text>
            )}
            {usable && !data && (
                <>
                    {list.isError ? (
                        <Text isMuted>
                            {!available
                                ? 'lb-bot is needed for this and is not reachable.'
                                : 'Could not load the matches.'}
                        </Text>
                    ) : (
                        <Spinner container />
                    )}
                </>
            )}

            {section === 'to-fix' && <ToFixSection />}

            {section === 'to-check' && toCheck && (
                <Stack gap="sm">
                    <Text isMuted size="xs">
                        Artists with no MusicBrainz tag in Navidrome where lb-bot either guessed an
                        artist that matches none of your albums, or found none. Worth a look, not
                        necessarily wrong.
                    </Text>
                    {toCheck.length === 0 && <Text isMuted>Nothing to check.</Text>}
                    {toCheck.map((row) => (
                        <ToCheckRow available={rowsAvailable} key={row.ndArtistId} row={row} />
                    ))}
                </Stack>
            )}

            {section === 'artists' && (
                <Stack gap="sm">
                    {overrides.length === 0 && (
                        <Text isMuted>
                            None set. Choose a MusicBrainz artist from an artist page when the tag
                            is missing or wrong.
                        </Text>
                    )}
                    {overrides.map((row) => (
                        <ArtistOverrideRow
                            available={rowsAvailable}
                            key={row.ndArtistId}
                            row={row}
                        />
                    ))}
                </Stack>
            )}

            {section === 'albums' && albums && (
                <Stack gap="sm">
                    {albums.length === 0 && (
                        <Text isMuted>
                            None. Use “Fix album match…” on an album to choose its MusicBrainz
                            release.
                        </Text>
                    )}
                    {albums.map((row) => (
                        <AlbumMatchRow available={available} key={row.id} row={row} />
                    ))}
                </Stack>
            )}

            {section === 'merged' && merges && (
                <Stack gap="sm">
                    {merges.length === 0 && <Text isMuted>None that can still be undone.</Text>}
                    {merges.map((row) => (
                        <MergedRow available={available} key={row.id} row={row} />
                    ))}
                </Stack>
            )}

            {/* Local data, always there once a hub is configured. Refresh is the
            mirror half of the old "Sync now" and reports only what the mirror did. */}
            <Stack gap="xs" pt="lg">
                <Group gap="sm">
                    <Text isMuted size="xs">
                        {mirror.loaded
                            ? `Index mirror: ${mirror.artistCount} artists · cursor ${mirror.meta.cursor} · epoch ${mirror.meta.epoch || 'none yet'}`
                            : 'Index mirror: reading the saved mirror…'}
                    </Text>
                    <Button
                        disabled={!available || refresh.watching}
                        loading={refresh.watching}
                        onClick={refresh.refresh}
                        size="compact-sm"
                        variant="subtle"
                    >
                        Refresh
                    </Button>
                </Group>
                {refresh.text && (
                    <Text isMuted size="xs">
                        {refresh.text}
                    </Text>
                )}
            </Stack>
        </ForkListPage>
    );
};

const LibraryMatchesRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            {/* Worbus P2 (walk B7): absent for a non-admin, as its sidebar entry is. */}
            <RoleGatedRoute gate="libraryMatches">
                <LibraryMatchesRoute />
            </RoleGatedRoute>
        </Suspense>
    </PageErrorBoundary>
);

export default LibraryMatchesRouteWithBoundary;
