import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link, Navigate, useParams, useSearchParams } from 'react-router';

import { albumPageOffer, albumPageState } from '/@/renderer/features/discography/album-page-state';
import { AlbumRequestBox } from '/@/renderer/features/lbbot/components/album-request-box';
import { NotOwnedAlbum } from '/@/renderer/features/lbbot/components/not-owned-album';
import ghostStyles from '/@/renderer/features/lbbot/components/not-owned-album.module.css';
import { WishlistButton } from '/@/renderer/features/lbbot/components/wishlist-button';
import { useAlbumRequest } from '/@/renderer/features/lbbot/hooks/use-album-request';
import {
    caaCoverUrl,
    useArtistTarget,
    useHubSupports,
    useIndexRelease,
    useLbBotAlbumMeta,
    useLbBotAlbumReleases,
    useLbBotAvailable,
    useLbBotDiscography,
    useLbBotDownloadsShown,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Fold } from '/@/renderer/features/motion/fold';
import { ForkDetailPage } from '/@/renderer/features/shared/components/fork-detail-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * navi-connect: an album page for a release the library does not have.
 *
 * Keyed on the MusicBrainz release-group id, because that is the only handle a
 * release nobody owns has. The body is the *same* two-step component the artist
 * page's modal mounts — editions, canonical tracklist, ranked sources, download —
 * rather than a second picker with its own set of the traps that one already pays
 * for.
 *
 * `album/tracklist` answers `presenceKnown: false` with no Navidrome album ids,
 * which is the normal case here. Every track is missing; the panel renders the
 * tracklist plainly and deliberately does not draw a "0/12".
 *
 * When the library turns out to hold the release-group after all, this redirects
 * to the real album page. Only lb-bot's index knows which Navidrome album that is
 * — the fresh feed's `releaseOwned` is a boolean and carries no id — so the
 * redirect needs the artist's discography, and is simply skipped without one.
 */
const LbBotExternalAlbumRoute = () => {
    const { t } = useTranslation();
    const { rgid } = useParams() as { rgid: string };
    const [search] = useSearchParams();

    const artist = search.get('artist') ?? '';
    const artistMbid = search.get('artistMbid') ?? '';

    // Editions of this release-group. Read here as well as inside the panel —
    // react-query dedupes on the key, so this costs no extra round trip — because
    // it is the one place this page can learn its artist's MBID when it was
    // opened from a Deezer row, which carries none.
    const releases = useLbBotAlbumReleases(rgid).data;

    // Where the artist credit goes. `artistId` is present when the row we came
    // from knew the library has them; otherwise the hook checks the library by
    // name and falls back to an MBID — the page's own, else the lead credit
    // `/lb/album/releases` answers. Without that last fallback a page reached
    // from a Deezer tile rendered the artist as dead text and there was no route
    // to their page or to the discography scan behind it.
    const artistTo = useArtistTarget({
        artistId: search.get('artistId') ?? '',
        artistMbid: artistMbid || releases?.artistMbid || '',
        name: artist || releases?.artist || '',
    });

    // Purely to answer "does the library already have this?" — from the local
    // index mirror when lb-bot has indexed the artist, which makes the redirect
    // to an owned album happen on the first render instead of after a round
    // trip; otherwise an instant SQLite read on lb-bot's side. Skipped entirely
    // without an artist MBID.
    // The hint, else the artist `/lb/album/releases` names: a link with no hints (a paste, Downloads'
    // Open album) must still find an album the library owns.
    const knownMbid = artistMbid || releases?.artistMbid || '';
    const discography = useLbBotDiscography(knownMbid ? `mb:${knownMbid}` : '', knownMbid);
    const indexedRow = useMemo(
        () => (discography.data?.releases ?? []).find((row) => row.rgid === rgid),
        [discography.data, rgid],
    );
    const ownedAlbumId = indexedRow?.navidromeAlbumIds[0];

    // The index has never heard of this release-group — the normal case for
    // anything reached from Fresh, since a stored discography is served even when
    // stale. Add the single row rather than offering a rescan of the whole
    // artist, which is a MusicBrainz request per second per release-group.
    //
    // Without it the redirect above can never fire either: only lb-bot's index
    // knows which Navidrome album a release-group resolves to, so an album the
    // library actually holds keeps rendering as a download until the next scan.
    const indexRelease = useIndexRelease(knownMbid ? `mb:${knownMbid}` : '', knownMbid);
    // Only while lb-bot is up. The discography can come from the local mirror
    // with lb-bot down, and `useIndexRelease` fires once per rgid, failures
    // included — so a call made then was never made again on this page. Gated,
    // it waits, and runs when lb-bot comes back.
    const available = useLbBotAvailable();
    useEffect(() => {
        if (!available || !discography.data?.indexed || indexedRow) return;
        // The link that got here carries the release's own metadata, which is
        // lb-bot's escape hatch when MusicBrainz is inside its five-minute
        // failure cooldown for this release-group.
        void indexRelease(rgid, {
            artist,
            external: true,
            name: artist,
            title: search.get('title') ?? '',
            type: search.get('type') ?? '',
            year: search.get('year') ?? '',
        });
    }, [available, discography.data, indexedRow, indexRelease, rgid, artist, search]);

    const title = search.get('title') || releases?.title || '';
    const artistName = artist || releases?.artist || '';
    const year = search.get('year') ?? '';
    const request = useAlbumRequest({ artist: artistName, rgid, title });
    const releasesRead = request.releasesQuery.data
        ? 'data'
        : request.releasesQuery.isFetching || request.releasesQuery.isPending
          ? available
              ? 'pending'
              : 'null'
          : 'null';
    const routeOlder = !useHubSupports('GET /lb/album/releases');
    const state = albumPageState({
        available,
        hasRgid: !!rgid,
        ownedAlbumId: ownedAlbumId ?? null,
        releasesRead,
        routeOlder,
    });
    // Worbus P1: with downloading off the page offers the wishlist and one plain line, never Find
    // sources, the request box or its quality picker (and so never a slskd search).
    const offer = albumPageOffer(state, useLbBotDownloadsShown());
    // The request box mounts the first time this album's page offers sources and then stays, so
    // downloading turning off mid-search folds it closed instead of dropping it (About and the
    // tracklist ease up rather than jump). A page opened while off never mounts it: no read runs
    // behind a box nobody sees (the sources search is off while off anyway, `useAlbumRequest`).
    const [boxFor, setBoxFor] = useState<null | string>(null);
    if (offer === 'sources' && rgid && boxFor !== rgid) setBoxFor(rgid);
    const boxMounted = !!rgid && boxFor === rgid;

    // `release_mbid` is not sent: it only saves lb-bot resolving the canonical release.
    // Find it shows here (and only here), so a persisted About without its links is asked again.
    const meta = useLbBotAlbumMeta(rgid, undefined, { findIt: true }).data;

    if (state === 'redirect' && ownedAlbumId) {
        return (
            <Navigate
                replace
                to={generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: ownedAlbumId })}
            />
        );
    }

    const trackCount = request.variant?.trackCount || 0;
    const credit = [
        artistName ? (
            artistTo ? (
                <Text component={Link} isLink key="artist" to={artistTo}>
                    {artistName}
                </Text>
            ) : (
                <Text key="artist">{artistName}</Text>
            )
        ) : null,
        year || request.variant?.year ? (
            <Text key="year">{year || request.variant?.year}</Text>
        ) : null,
        trackCount ? (
            <Text key="tracks">{t('naviConnect.albumPage.tracks', { count: trackCount })}</Text>
        ) : null,
        releases ? <Text key="source">{t('naviConnect.albumPage.fromMusicBrainz')}</Text> : null,
    ].filter(Boolean);
    const searching = request.sources.state === 'waiting';

    return (
        <ForkDetailPage
            headerChildren={
                <Stack gap="sm">
                    <Group gap="xs">
                        {credit.map((part, index) => (
                            <Fragment key={index}>
                                {index > 0 && <Text isMuted>·</Text>}
                                {part}
                            </Fragment>
                        ))}
                    </Group>
                    {offer !== 'none' && rgid && (
                        // One tree in both modes, so the wishlist button keeps its place in the
                        // flow and its state when the mode flips; the off line folds in under
                        // the buttons, moving nothing above it.
                        <div>
                            <Group gap="sm">
                                {offer === 'sources' && (
                                    <Button
                                        data-find-sources=""
                                        disabled={searching || request.busy}
                                        leftSection={<Icon icon="search" />}
                                        onClick={
                                            searching || request.busy
                                                ? undefined
                                                : request.sources.start
                                        }
                                        variant="filled"
                                    >
                                        {searching
                                            ? t('naviConnect.albumPage.searchingButton')
                                            : t('naviConnect.albumPage.findSources')}
                                    </Button>
                                )}
                                <WishlistButton artist={artistName} rgid={rgid} title={title} />
                            </Group>
                            <Fold name="downloads-off" open={offer === 'wishlistOnly'}>
                                <Text
                                    className={ghostStyles.offLine}
                                    data-downloads-off=""
                                    isMuted
                                    size="sm"
                                >
                                    {t('naviConnect.albumPage.downloadsOff')}
                                </Text>
                            </Fold>
                        </div>
                    )}
                </Stack>
            }
            imageUrl={rgid ? caaCoverUrl(rgid) : null}
            itemType={LibraryItem.ALBUM}
            kicker={t('naviConnect.albumPage.kicker')}
            route={AppRoute.LIBRARY_ALBUMS}
            title={title || 'Album'}
        >
            {!rgid && <Text isMuted>{t('naviConnect.albumPage.noRgid')}</Text>}
            {state === 'unconfigured' && (
                <Text isMuted>{t('naviConnect.albumPage.unconfigured')}</Text>
            )}
            {state === 'older' && <Text isMuted>{t('naviConnect.albumPage.older')}</Text>}
            {state === 'loading' && <AlbumPageGhost />}
            {state === 'ready' && rgid && (
                <NotOwnedAlbum
                    artist={artistName}
                    meta={meta}
                    request={request}
                    requestBox={
                        boxMounted && (
                            <Fold name="request-offer" open={offer === 'sources'} tall>
                                <AlbumRequestBox
                                    artist={artistName}
                                    coverUrl={caaCoverUrl(rgid)}
                                    ownedAlbumId={ownedAlbumId ?? null}
                                    request={request}
                                    rgid={rgid}
                                    title={title}
                                />
                            </Fold>
                        )
                    }
                    rgid={rgid}
                />
            )}
        </ForkDetailPage>
    );
};

/** The columns' shapes while the editions are read (the hero is already real). */
const AlbumPageGhost = () => (
    <div aria-busy="true" className={ghostStyles.columns} data-album-ghost="">
        <div>
            <div className={ghostStyles.ghost} style={{ width: '40%' }} />
            <div className={ghostStyles.ghost} />
            <div className={ghostStyles.ghost} />
            <div className={ghostStyles.ghost} style={{ width: '70%' }} />
        </div>
        <div>
            {Array.from({ length: 8 }, (_, index) => (
                <div className={ghostStyles.ghost} key={index} />
            ))}
        </div>
    </div>
);

const LbBotExternalAlbumRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotExternalAlbumRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotExternalAlbumRouteWithBoundary;
