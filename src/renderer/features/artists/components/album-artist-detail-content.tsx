import { useQuery, UseSuspenseQueryResult } from '@tanstack/react-query';
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link, useParams } from 'react-router';

import styles from './album-artist-detail-content.module.css';

import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { HeldRows, nextHeldRows } from '/@/renderer/features/artists/artist-track-list-model';
import { AlbumArtistGridCarousel } from '/@/renderer/features/artists/components/album-artist-grid-carousel';
import { ArtistShelves } from '/@/renderer/features/artists/components/artist-shelves';
import {
    ArtistTrackList,
    ArtistTrackListSkeleton,
} from '/@/renderer/features/artists/components/artist-track-list';
import { MetaAbout } from '/@/renderer/features/lbbot/components/meta-about';
import {
    useEffectiveArtistMbid,
    useLbBotArtistMeta,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ClampFold } from '/@/renderer/features/motion/clamp-fold';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useGenreRoute } from '/@/renderer/hooks/use-genre-route';
import { AppRoute } from '/@/renderer/router/routes';
import { ArtistItem, useCurrentServer, useCurrentServerId } from '/@/renderer/store';
import { useArtistItems, useExternalLinks } from '/@/renderer/store/settings.store';
import { sanitize } from '/@/renderer/utils/sanitize';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';
import {
    Album,
    AlbumArtist,
    AlbumArtistDetailResponse,
    AlbumListResponse,
    LibraryItem,
    RelatedArtist,
    ServerType,
    Song,
} from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

const NO_ALBUMS: Album[] = [];
const NO_SONGS: Song[] = [];

// The artist page binds Enter to "play the selection" app-wide; a switch keeps its own keys.
const keepKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};

/** Two small chips beside a section's title (Popular's Everyone / Yours), the pressed one filled. */
const SectionSwitch = <T extends string>({
    label,
    onChange,
    options,
    value,
}: {
    label: string;
    onChange: (value: T) => void;
    options: { label: string; value: T }[];
    value: T;
}) => (
    <div aria-label={label} className={styles.switch} role="group">
        {options.map((option) => (
            <button
                aria-pressed={option.value === value}
                className={styles.switchChip}
                key={option.value}
                onClick={() => onChange(option.value)}
                onKeyDown={keepKeys}
                type="button"
            >
                {option.label}
            </button>
        ))}
    </div>
);

/**
 * A song list section (Popular): the title, its switch, then the compact list
 * (R10, B-218). Nothing is read from the Songs library's table settings: no columns, no filters, no
 * search, so the library's choices never reach the artist page.
 */
const SongSection = ({
    artistId,
    children,
    empty,
    isLoading,
    name,
    showAllTo,
    songs,
    title,
}: {
    artistId: string;
    children?: React.ReactNode;
    /** The muted line an empty list shows under its switch, so the section does not read as broken. */
    empty: string;
    isLoading: boolean;
    name: string;
    /** The full list's page (the top-songs route), its only way in. */
    showAllTo: string;
    songs: Song[];
    title: string;
}) => {
    const player = usePlayer();
    // Double-click or the number's play button: play from that row with the whole list as the queue,
    // as the table's double-click did (playSongFromItemListControl).
    const onPlay = useCallback(
        (song: Song) => player.addToQueueByData(songs, Play.NOW, song.id),
        [player, songs],
    );

    return (
        <section className={styles.section} data-section={name}>
            <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>{title}</h2>
                {children}
            </div>
            {isLoading ? (
                <ArtistTrackListSkeleton />
            ) : songs.length === 0 ? (
                <p className={styles.empty}>{empty}</p>
            ) : (
                <ArtistTrackList
                    artistId={artistId}
                    onPlay={onPlay}
                    showAllTo={showAllTo}
                    songs={songs}
                />
            )}
        </section>
    );
};

/** The full Popular page, under the route the artist page itself is on (artist or album artist). */
const topSongsPath = ({
    albumArtistId,
    artistId,
}: {
    albumArtistId?: string;
    artistId?: string;
}): string =>
    artistId
        ? generatePath(AppRoute.LIBRARY_ARTISTS_DETAIL_TOP_SONGS, { artistId })
        : generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL_TOP_SONGS, {
              albumArtistId: albumArtistId ?? '',
          });

const songId = (song: Song) => song.id;

/**
 * B-266: Popular's rows for one visit and one Everyone / Yours choice (`key`): a refetch (a counted
 * play, a rating, a favourite) updates each row in place and never reorders the list under the
 * user. A new visit (the page mounts again, Back included) or a new `key` shows the new order.
 */
const useHeldRows = (fresh: Song[], fetching: boolean, key: string): Song[] => {
    const [held, setHeld] = useState<HeldRows<Song> | null>(null);
    const next = nextHeldRows(held, { fetching, fresh, key }, songId);
    if (!sameHeldRows(held, next)) setHeld(next);
    return next.rows;
};

const sameHeldRows = (a: HeldRows<Song> | null, b: HeldRows<Song>): boolean =>
    !!a &&
    a.key === b.key &&
    a.settled === b.settled &&
    a.rows.length === b.rows.length &&
    a.rows.every((row, i) => row === b.rows[i]);

const ArtistPopular = ({
    detailQuery,
    routeId,
    showAllTo,
}: {
    detailQuery: UseSuspenseQueryResult<AlbumArtistDetailResponse, Error>;
    routeId: string;
    showAllTo: string;
}) => {
    const { t } = useTranslation();
    const [type, setType] = useLocalStorage<'community' | 'personal'>({
        defaultValue: 'community',
        key: 'album-artist-top-songs-query-type',
    });
    const serverId = useCurrentServerId();
    const server = useCurrentServer();
    const canStartQuery = server?.type === ServerType.JELLYFIN || !!detailQuery.data?.name;

    const topSongsQuery = useQuery({
        ...artistsQueries.topSongs({
            query: { artist: detailQuery.data?.name || '', artistId: routeId, type },
            serverId,
        }),
        enabled: canStartQuery,
    });
    const songs = useHeldRows(
        topSongsQuery.data?.items ?? NO_SONGS,
        topSongsQuery.isFetching,
        `${serverId}:${routeId}:${type}`,
    );
    const isLoading = topSongsQuery.isLoading;

    if (!canStartQuery) return null;
    // An artist with no top songs shows no section; "Yours" empty keeps the switch, to switch back.
    if (!isLoading && songs.length === 0 && type === 'community') return null;

    return (
        <SongSection
            artistId={routeId}
            empty={t('page.albumArtistDetail.noPlaysYet')}
            isLoading={isLoading}
            name="popular"
            showAllTo={showAllTo}
            songs={songs}
            title={t('page.albumArtistDetail.popular')}
        >
            <SectionSwitch
                label={t('page.albumArtistDetail.popular')}
                onChange={setType}
                options={[
                    { label: t('page.albumArtistDetail.topSongsCommunity'), value: 'community' },
                    { label: t('page.albumArtistDetail.topSongsPersonal'), value: 'personal' },
                ]}
                value={type}
            />
        </SongSection>
    );
};

/**
 * Last.fm ends every summary with its own "Read more on Last.fm" anchor, and the
 * sanitizer deliberately allows `<a href>`, so it survives into the page.
 *
 * This runs UNCONDITIONALLY. It used to be gated on lb-bot having answered,
 * the reasoning being that until then the anchor was the only route to the rest
 * of the text - but the cost of that was a bio which rendered with a link and
 * then silently lost it a second later, which is the exact defect this whole
 * pass exists to remove. Text on screen does not change under the reader.
 *
 * It also matters much less than it did: with the Apple Music agent ahead of
 * `lastfm` in Navidrome's chain the biography is usually not Last.fm's at all,
 * and carries no anchor to strip.
 */
const stripLastFmReadMore = (html: string): string =>
    html.replace(/<a\b[^>]*last\.fm[^>]*>.*?<\/a>/gis, '').replace(/(\s|<br\s*\/?>)+$/i, '');

const getListenBrainzUrl = (mbzId: null | string, artistName?: string) => {
    if (mbzId) {
        return `https://listenbrainz.org/artist/${mbzId}`;
    }

    if (artistName) {
        return `https://listenbrainz.org/search/?search_term=${encodeURIComponent(artistName)}`;
    }

    return null;
};

const getQobuzUrl = (artistName?: string) => {
    if (artistName) {
        return `https://www.qobuz.com/us-en/search/artists/${encodeURIComponent(artistName)}`;
    }

    return null;
};

/** The external-link icons (Settings' choices), in About's links row. */
const ExternalLinkIcons = ({
    artistName,
    mbzId,
}: {
    artistName?: string;
    mbzId?: null | string;
}) => {
    const { t } = useTranslation();
    const { externalLinks, lastFM, listenBrainz, musicBrainz, nativeSpotify, qobuz, spotify } =
        useExternalLinks();
    const listenBrainzUrl = getListenBrainzUrl(mbzId || null, artistName);
    const qobuzUrl = getQobuzUrl(artistName);

    if (!externalLinks) return null;

    return (
        <>
            {lastFM && (
                <ActionIcon
                    component="a"
                    href={`https://www.last.fm/music/${encodeURIComponent(artistName || '')}`}
                    icon="brandLastfm"
                    iconProps={{ size: 'xl' }}
                    rel="noopener noreferrer"
                    target="_blank"
                    tooltip={{ label: t('action.openIn.lastfm') }}
                    variant="subtle"
                />
            )}
            {mbzId && musicBrainz ? (
                <ActionIcon
                    component="a"
                    href={`https://musicbrainz.org/artist/${mbzId}`}
                    icon="brandMusicBrainz"
                    iconProps={{ size: 'xl' }}
                    rel="noopener noreferrer"
                    target="_blank"
                    tooltip={{ label: t('action.openIn.musicbrainz') }}
                    variant="subtle"
                />
            ) : null}
            {listenBrainz && listenBrainzUrl && (
                <ActionIcon
                    component="a"
                    href={listenBrainzUrl}
                    icon="brandListenBrainz"
                    iconProps={{ size: 'xl' }}
                    rel="noopener noreferrer"
                    target="_blank"
                    tooltip={{ label: t('action.openIn.listenbrainz') }}
                    variant="subtle"
                />
            )}
            {qobuz && qobuzUrl && (
                <ActionIcon
                    component="a"
                    href={qobuzUrl}
                    icon="brandQobuz"
                    iconProps={{ size: 'xl' }}
                    rel="noopener noreferrer"
                    target="_blank"
                    tooltip={{ label: t('action.openIn.qobuz') }}
                    variant="subtle"
                />
            )}
            {spotify && (
                <ActionIcon
                    component="a"
                    href={
                        nativeSpotify
                            ? `spotify:search:${encodeURIComponent(artistName || '')}`
                            : `https://open.spotify.com/search/${encodeURIComponent(artistName || '')}`
                    }
                    icon="brandSpotify"
                    iconProps={{ size: 'xl' }}
                    rel="noopener noreferrer"
                    target={nativeSpotify ? undefined : '_blank'}
                    tooltip={{ label: t('action.openIn.spotify') }}
                    variant="subtle"
                />
            )}
        </>
    );
};

/**
 * About (R10): the biography, then the genres as chips, then the external links, full width.
 *
 * The description rule (navi-connect CLAUDE.md section 5, "Editorial metadata"): the text is
 * Navidrome's, and nothing arriving late replaces text on screen. The slot's source is
 * `getArtistInfo2.biography`, which the page does not block on, so the slot holds a skeleton until
 * that request settles and only then shows its biography, else `getArtist`'s (already in hand); the
 * shorter `getArtist` text is never painted first and swapped. lb-bot fills the slot only when
 * Navidrome has neither. lb-bot's links (when it has any) join the links row below the text, where
 * a late arrival moves nothing the reader is on.
 * lb-bot's Members and Related rows are gone (B-217). With lb-bot absent, About is Navidrome's alone.
 */
const ArtistAbout = ({
    artistMbid,
    artistName,
    genres,
    routeId,
    showBiography,
}: {
    artistMbid?: null | string;
    artistName?: string;
    genres?: { id: string; name: string }[];
    routeId: string;
    showBiography: boolean;
}) => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const genrePath = useGenreRoute();
    const { externalLinks, lastFM, listenBrainz, musicBrainz, qobuz, spotify } = useExternalLinks();

    const artistInfoQuery = useQuery({
        ...artistsQueries.albumArtistInfo({
            query: { id: routeId, limit: 10 },
            serverId: server?.id,
        }),
        enabled: Boolean(server?.id && routeId && showBiography),
    });
    const detailQuery = useQuery({
        ...artistsQueries.albumArtistDetail({
            query: { id: routeId },
            serverId: server?.id,
        }),
        enabled: Boolean(server?.id && routeId && showBiography),
    });
    // Same key as anywhere else on the page, so react-query asks lb-bot once.
    const meta = useLbBotArtistMeta(artistMbid, artistName).data;

    // Until getArtistInfo2 settles nothing is shown, so its answer never replaces getArtist's text.
    // The skeleton belongs to Navidrome's requests, never to lb-bot.
    const infoPending = showBiography && artistInfoQuery.isLoading;
    const biography =
        showBiography && !infoPending
            ? artistInfoQuery.data?.biography || detailQuery.data?.biography
            : undefined;
    const bioLoading = infoPending || (showBiography && !biography && detailQuery.isLoading);
    const metaShown =
        showBiography &&
        !biography &&
        Boolean(meta?.summary || meta?.paragraphs.length || meta?.wikidataDescription);
    const lbLinks = meta?.links ?? [];
    const hasIcons =
        externalLinks &&
        (lastFM || listenBrainz || (musicBrainz && Boolean(artistMbid)) || qobuz || spotify);
    const hasGenres = Boolean(genres && genres.length > 0);

    if (!bioLoading && !biography && !metaShown && !hasGenres && !hasIcons && !lbLinks.length) {
        return null;
    }

    return (
        <section className={styles.section} data-section="about">
            <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>{t('page.albumArtistDetail.aboutHeading')}</h2>
            </div>
            <Stack className={styles.about} gap="md">
                {bioLoading ? (
                    <Stack gap="xs">
                        <Skeleton enableAnimation height="1rem" width="100%" />
                        <Skeleton enableAnimation height="1rem" width="98%" />
                        <Skeleton enableAnimation height="1rem" width="60%" />
                    </Stack>
                ) : biography ? (
                    <ClampFold name="about">
                        <Text
                            dangerouslySetInnerHTML={{
                                __html: sanitize(stripLastFmReadMore(biography)),
                            }}
                        />
                    </ClampFold>
                ) : (
                    metaShown && meta && <MetaAbout meta={meta} showLinks={false} />
                )}
                {hasGenres && (
                    <div
                        aria-label={t('entity.genre', { count: 2 })}
                        className={styles.genres}
                        role="group"
                    >
                        {genres!.map((genre) => (
                            <Link
                                className={styles.genre}
                                key={`genre-${genre.id}`}
                                to={generatePath(genrePath, {
                                    albumArtistId: null,
                                    albumId: null,
                                    artistId: null,
                                    // navi-connect: the virtual artist/album routes' params.
                                    // generatePath types this against the union of every
                                    // AppRoute's params, so each one has to appear here.
                                    artistMbid: null,
                                    genreId: genre.id,
                                    itemType: null,
                                    playlistId: null,
                                    rgid: null,
                                })}
                            >
                                {genre.name}
                            </Link>
                        ))}
                    </div>
                )}
                {(hasIcons || lbLinks.length > 0) && (
                    <div className={styles.links}>
                        <ExternalLinkIcons artistName={artistName} mbzId={artistMbid} />
                        {lbLinks.map((link) => (
                            <a
                                className={styles.textLink}
                                href={link.url}
                                key={link.url}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {link.label}
                            </a>
                        ))}
                    </div>
                )}
            </Stack>
        </section>
    );
};

const AlbumArtistMetadataSimilarArtists = ({ routeId }: { routeId: string }) => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const serverId = useCurrentServerId();

    const artistInfoQuery = useQuery({
        ...artistsQueries.albumArtistInfo({
            query: { id: routeId, limit: 10 },
            serverId: server?.id,
        }),
        enabled: Boolean(server?.id && routeId),
    });

    const relatedArtists = artistInfoQuery.data?.similarArtists ?? null;

    const similarArtists = useMemo(() => {
        if (!relatedArtists || relatedArtists.length === 0) {
            return [];
        }

        return relatedArtists.map(
            (relatedArtist: RelatedArtist): AlbumArtist => ({
                _itemType: LibraryItem.ALBUM_ARTIST,
                _serverId: serverId || '',
                _serverType: (server?.type as ServerType) || ServerType.JELLYFIN,
                albumCount: null,
                biography: null,
                blurHash: null,
                dominantColor: null,
                duration: null,
                genres: [],
                id: relatedArtist.id,
                imageId: relatedArtist.imageId,
                imageUrl: relatedArtist.imageUrl,
                lastPlayedAt: null,
                mbz: null,
                missing: null,
                name: relatedArtist.name,
                playCount: null,
                ratedAt: null,
                similarArtists: null,
                songCount: null,
                starredAt: null,
                thumbHash: null,
                userFavorite: relatedArtist.userFavorite,
                userRating: relatedArtist.userRating,
            }),
        );
    }, [relatedArtists, server?.type, serverId]);

    const carouselTitle = useMemo(
        () => <h2 className={styles.sectionTitle}>{t('page.albumArtistDetail.relatedArtists')}</h2>,
        [t],
    );

    if (!artistInfoQuery.isLoading && similarArtists.length === 0) {
        return null;
    }

    return (
        <section className={styles.section} data-section="related-artists">
            <AlbumArtistGridCarousel
                data={similarArtists}
                excludeIds={[routeId]}
                isLoading={artistInfoQuery.isLoading}
                rowCount={1}
                title={carouselTitle}
            />
        </section>
    );
};

interface AlbumArtistDetailContentProps {
    albumsQuery: UseSuspenseQueryResult<AlbumListResponse, Error>;
    detailQuery: UseSuspenseQueryResult<AlbumArtistDetailResponse, Error>;
}

/**
 * The owned artist page's body (R10, B-217..B-219), one column in Spotify's order: Popular,
 * Discography (chips and one row) with Appears on, About, Related artists last. R13 (B-246): no
 * favourite songs section; Popular shows each song's rating and heart instead.
 * The owner's per-section switches (`artistItems`) still hide a section; their order no longer
 * reorders, the page has one order.
 */
export const AlbumArtistDetailContent = ({
    albumsQuery,
    detailQuery,
}: AlbumArtistDetailContentProps) => {
    const artistItems = useArtistItems();
    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };
    const routeId = (artistId || albumArtistId) as string;
    const params = { albumArtistId, artistId };

    const enabled = useMemo(() => {
        const map: { [key in ArtistItem]?: boolean } = {};
        for (const item of artistItems) map[item.id] = !item.disabled;
        return map;
    }, [artistItems]);

    // I-019: Navidrome's tag, unless the user chose a MusicBrainz artist for this
    // one. EVERYTHING below that feeds lb-bot or a MusicBrainz / ListenBrainz
    // link takes `mbzId`; only the override picker (on the discography page) needs the tag too.
    const mbzId = useEffectiveArtistMbid(routeId, detailQuery.data?.mbz);
    const artistName = detailQuery.data?.name;

    return (
        <div className={styles.contentContainer}>
            <div className={styles.detailContainer}>
                {enabled.topSongs && (
                    <ArtistPopular
                        detailQuery={detailQuery}
                        routeId={routeId}
                        showAllTo={topSongsPath(params)}
                    />
                )}
                {/* "Recent albums" in the owner's list is the releases' switch. */}
                {enabled.recentAlbums !== false && (
                    <ArtistShelves
                        artistMbid={mbzId}
                        artistName={artistName || ''}
                        ndId={routeId}
                        owned={albumsQuery.data?.items ?? NO_ALBUMS}
                    />
                )}
                <ArtistAbout
                    artistMbid={mbzId}
                    artistName={artistName}
                    genres={detailQuery.data?.genres}
                    routeId={routeId}
                    showBiography={Boolean(enabled.biography)}
                />
                {enabled.similarArtists && <AlbumArtistMetadataSimilarArtists routeId={routeId} />}
            </div>
        </div>
    );
};
