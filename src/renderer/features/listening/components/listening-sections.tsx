import { MouseEvent, ReactNode } from 'react';
import { generatePath, Link, useNavigate } from 'react-router';

import styles from './listening.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { DiscoverRow } from '/@/renderer/features/discover/components/discover-row';
import { DiscoverTile } from '/@/renderer/features/discover/components/discover-tile';
import { MissingAlbumTile } from '/@/renderer/features/lbbot/components/missing-album-tile';
import { caaCoverUrl, useOpenLbBotArtist } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useActiveFill } from '/@/renderer/features/lbbot/stores/active-fills.store';
import {
    artistLinkPath,
    externalAlbumPathFor,
} from '/@/renderer/features/lbbot/utils/external-paths';
import { useHistoryContextMenu } from '/@/renderer/features/listening/hooks/use-history-menu';
import {
    albumCardView,
    AlbumTarget,
    albumTarget,
    artistCardView,
    artistTarget,
    dailyForPeriod,
    dailyNote,
    formatListeningTime,
    genresNote,
    heatmapCaption,
    heatmapGrid,
    hoursBars,
    listeningTimeNote,
    periodPhrase,
    playsLabel,
    ReadState,
    recentRowView,
    trackCardView,
    unownedAlbumRelease,
} from '/@/renderer/features/listening/listening-logic';
import { useLibraryContextMenu } from '/@/renderer/features/shared/hooks/use-library-context-menu';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';
import {
    LbBotListeningPeriod,
    LbBotListeningSummary,
    LbBotRecentRow,
    LbBotUnownedRow,
} from '/@/shared/types/lbbot-types';

/**
 * The sections of the My Listening screen. Each renders only fields of lb-bot's
 * response; rows link OUT (the library page when owned, plain text for an owned
 * row lb-bot has no id for yet, the virtual page when not owned). The one acquire
 * control is the shared missing-album tile's own, on unowned albums, behind its
 * reviewed flow. The two lists read separately say what was read: "reading" only
 * in flight, "empty" only from a 200, a failure with lb-bot's own text.
 */

const albumPath = (
    target: AlbumTarget,
    hints: { artist?: string; artistMbid?: string; title?: string },
): string | undefined =>
    target?.kind === 'library'
        ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: target.id })
        : target?.kind === 'external'
          ? externalAlbumPathFor({ ...hints, rgid: target.rgid })
          : undefined;

const MaybeLink = ({
    children,
    onClick,
    to,
}: {
    children: ReactNode;
    onClick?: (event: MouseEvent) => void;
    to?: string;
}) =>
    to ? (
        <Text className={styles.clip} component={Link} isLink onClick={onClick} size="sm" to={to}>
            {children}
        </Text>
    ) : (
        <Text className={styles.clip} size="sm">
            {children}
        </Text>
    );

const Section = ({
    children,
    note,
    title,
}: {
    children: ReactNode;
    note?: string;
    title: string;
}) => (
    <Stack gap="sm">
        {/* The ranking rows' heading (DiscoverRow's): a title over its reason line. */}
        <Stack gap={0}>
            <TextTitle fw={700} isNoSelect order={3}>
                {title}
            </TextTitle>
            {note && (
                <Text isMuted size="sm">
                    {note}
                </Text>
            )}
        </Stack>
        {children}
    </Stack>
);

const Tile = ({ label, note, value }: { label: string; note?: string; value: string }) => (
    <div className={styles.tile}>
        <Text isMuted size="xs">
            {label}
        </Text>
        <Text size="xl" weight={700}>
            {value}
        </Text>
        {note && (
            <Text isMuted size="xs">
                {note}
            </Text>
        )}
    </div>
);

export const StatTiles = ({ summary }: { summary: LbBotListeningSummary }) => {
    const { streak, totals } = summary;
    return (
        <div className={styles.tiles}>
            <Tile label="Plays" value={totals.plays.toLocaleString()} />
            <Tile
                label="Listening time"
                note={listeningTimeNote(totals)}
                value={formatListeningTime(totals.seconds)}
            />
            <Tile label="Artists" value={totals.artists.toLocaleString()} />
            <Tile label="Albums" value={totals.albums.toLocaleString()} />
            <Tile label="Current streak" value={`${streak.current} d`} />
            <Tile label="Longest streak" value={`${streak.longest} d`} />
        </div>
    );
};

/**
 * The year-ish at a glance: lb-bot's `heatmap` is always the last 112 days ending
 * today, whatever period is picked, so it does not follow the picker and says so.
 * The cells after today in the last week are faint placeholders, not gaps: they
 * keep every row running to the same end.
 */
export const Heatmap = ({ summary }: { summary: LbBotListeningSummary }) => {
    const { columns } = heatmapGrid(summary.heatmap);
    if (columns.length === 0) return null;
    return (
        <Section note={heatmapCaption(summary.heatmap)} title="Activity">
            <div className={styles.heatmap}>
                {columns.flatMap((week, w) =>
                    week.map((cell, d) =>
                        cell ? (
                            <div
                                className={styles.cell}
                                data-level={cell.level}
                                key={cell.date}
                                title={`${cell.date}: ${playsLabel(cell.count)}`}
                            />
                        ) : (
                            <div
                                className={`${styles.cell} ${styles.future}`}
                                key={`pad-${w}-${d}`}
                            />
                        ),
                    ),
                )}
            </div>
        </Section>
    );
};

/** Plays per day over the picked period: the tail of lb-bot's daily series. */
export const DailyChart = ({
    period,
    summary,
}: {
    period: LbBotListeningPeriod;
    summary: LbBotListeningSummary;
}) => {
    const days = dailyForPeriod(summary.daily, period);
    if (days.length === 0) return null;
    const max = days.reduce((m, d) => Math.max(m, d.count), 0);
    return (
        <Section note={dailyNote(period, summary.daily.length)} title="Plays over time">
            <div className={styles.daily}>
                {days.map((day) => (
                    <div
                        className={styles.bar}
                        key={day.date}
                        style={{ height: `${max > 0 ? Math.round((day.count / max) * 100) : 0}%` }}
                        title={`${day.date}: ${playsLabel(day.count)}`}
                    />
                ))}
            </div>
        </Section>
    );
};

export const HoursChart = ({ summary }: { summary: LbBotListeningSummary }) => {
    const bars = hoursBars(summary.hours);
    return (
        <Section note="Plays by hour of the day, in your time zone." title="When you listen">
            <div className={styles.hours}>
                {bars.map((bar) => (
                    <div
                        className={styles.bar}
                        key={bar.hour}
                        style={{ height: `${Math.round(bar.ratio * 100)}%` }}
                        title={`${String(bar.hour).padStart(2, '0')}:00 — ${playsLabel(bar.count)}`}
                    />
                ))}
            </div>
            <div className={styles.hourLabels}>
                {bars.map((bar) => (
                    <Text isMuted key={bar.hour} size="xs">
                        {bar.hour % 6 === 0 ? bar.hour : ''}
                    </Text>
                ))}
            </div>
        </Section>
    );
};

/** One ranking as a horizontal carousel of cards, the Discover rows' own shell
 *  (`DiscoverRow` over the Home page's `GridCarousel`): arrows, paging, card sizing. */
const RankingRow = ({
    cards,
    period,
    subject,
    title,
}: {
    cards: { content: ReactNode; id: string }[];
    period: LbBotListeningPeriod;
    subject: string;
    title: string;
}) => (
    <DiscoverRow
        because={`Your most played ${subject} ${periodPhrase(period)}.`}
        cards={cards}
        isEmpty={cards.length === 0}
        title={title}
    />
);

/** The Cover Art Archive front cover the app already builds for a release group
 *  (`caaCoverUrl`, as Fresh and the missing-album tile do): a URL, no request to learn it. */
const coverFor = (rgid: null | string): null | string => (rgid ? caaCoverUrl(rgid) : null);

const useGo = () => {
    const navigate = useNavigate();
    return (path: string | undefined) => () => {
        if (path) navigate(path);
    };
};

export const TopLists = ({
    period,
    summary,
}: {
    period: LbBotListeningPeriod;
    summary: LbBotListeningSummary;
}) => {
    const go = useGo();
    // B-407: an artist lb-bot did not match is looked up in the library by name (B-313's rule).
    const { open: openArtist } = useOpenLbBotArtist();
    const openMenu = useLibraryContextMenu();
    const openSongMenu = useHistoryContextMenu();
    return (
        <Stack gap="xl">
            <RankingRow
                cards={summary.topAlbums.map((album, i) => {
                    const view = albumCardView(album, i + 1);
                    return {
                        content: (
                            <DiscoverTile
                                imageId={view.imageId}
                                imageUrl={coverFor(view.imageRgid)}
                                itemType={LibraryItem.ALBUM}
                                onClick={
                                    view.linked
                                        ? go(
                                              albumPath(
                                                  albumTarget(
                                                      album.ndAlbumId,
                                                      album.rgid,
                                                      album.owned,
                                                  ),
                                                  {
                                                      artist: album.artist,
                                                      artistMbid: album.artistMbid,
                                                      title: album.title,
                                                  },
                                              ),
                                          )
                                        : undefined
                                }
                                onContextMenu={(event) =>
                                    void openMenu(
                                        event,
                                        album.owned && album.ndAlbumId
                                            ? { id: album.ndAlbumId, kind: 'album' }
                                            : null,
                                    )
                                }
                                subtitle={view.subtitle}
                                title={view.title}
                            />
                        ),
                        id: `album-${album.rgid}-${album.title}-${i}`,
                    };
                })}
                period={period}
                subject="albums"
                title="Top albums"
            />
            <RankingRow
                cards={summary.topArtists.map((artist, i) => {
                    const view = artistCardView(artist, i + 1);
                    return {
                        content: (
                            <DiscoverTile
                                imageId={view.imageId}
                                isRound
                                itemType={LibraryItem.ALBUM_ARTIST}
                                onClick={
                                    view.linked
                                        ? () =>
                                              openArtist({
                                                  artistId: artist.ndArtistId,
                                                  mbid: artist.mbid,
                                                  name: artist.name,
                                              })
                                        : undefined
                                }
                                onContextMenu={(event) =>
                                    void openMenu(
                                        event,
                                        artist.ndArtistId
                                            ? { id: artist.ndArtistId, kind: 'artist' }
                                            : null,
                                    )
                                }
                                subtitle={view.subtitle}
                                title={view.title}
                            />
                        ),
                        id: `artist-${artist.mbid}-${artist.name}-${i}`,
                    };
                })}
                period={period}
                subject="artists"
                title="Top artists"
            />
            <RankingRow
                cards={summary.topTracks.map((track, i) => {
                    const view = trackCardView(track, i + 1);
                    return {
                        content: (
                            <DiscoverTile
                                imageId={view.imageId}
                                imageUrl={coverFor(view.imageRgid)}
                                itemType={LibraryItem.ALBUM}
                                onClick={
                                    view.linked
                                        ? go(
                                              albumPath(albumTarget(track.ndAlbumId, track.rgid), {
                                                  artist: track.artist,
                                              }),
                                          )
                                        : undefined
                                }
                                // The song's own menu, resolved in its album as a History
                                // row's is (recording id, else one exact title).
                                onContextMenu={(event) =>
                                    void openSongMenu(event, {
                                        artist: track.artist,
                                        artistMbid: '',
                                        client: '',
                                        listenedAt: 0,
                                        ndAlbumId: track.ndAlbumId,
                                        ndArtistId: '',
                                        recordingMbid: track.recordingMbid,
                                        release: '',
                                        rgid: track.rgid,
                                        track: track.title,
                                    })
                                }
                                subtitle={view.subtitle}
                                title={view.title}
                            />
                        ),
                        id: `track-${track.recordingMbid}-${track.title}-${i}`,
                    };
                })}
                period={period}
                subject="tracks"
                title="Top tracks"
            />
        </Stack>
    );
};

/** Genres: a vertical ranking (rank, name over its bar, plays), never a sideways row. */
export const Genres = ({ summary }: { summary: LbBotListeningSummary }) => {
    if (summary.genres.length === 0) return null;
    const max = summary.genres.reduce((m, g) => Math.max(m, g.plays), 0);
    return (
        <Section note={genresNote(summary.genrePlays, summary.totals.plays)} title="Genres">
            <div className={styles.genres}>
                {summary.genres.map((genre, index) => (
                    <div className={styles.genre} key={genre.genre}>
                        <Text isMuted size="sm">
                            {index + 1}
                        </Text>
                        <Stack gap={2}>
                            <Text className={styles.clip} size="sm">
                                {genre.genre}
                            </Text>
                            <div
                                className={styles.bar}
                                style={{
                                    height: 4,
                                    width: `${max ? (genre.plays / max) * 100 : 0}%`,
                                }}
                            />
                        </Stack>
                        <Text isMuted size="sm">
                            {genre.plays.toLocaleString()}
                        </Text>
                    </div>
                ))}
            </div>
        </Section>
    );
};

const UnownedAlbumTile = ({ row }: { row: LbBotUnownedRow }) => {
    // A fill the ledger finished is no longer "missing": the tile must not go
    // back to offering the download that just succeeded.
    const fill = useActiveFill(row.rgid);
    const fillDone = !!fill && fill.settled && fill.outcome === 'done';
    const release = unownedAlbumRelease(row, fillDone);
    return (
        <div>
            <MissingAlbumTile
                albumId={release.navidromeAlbumIds[0] ?? null}
                artistName={row.artist}
                ndArtistId={row.artistId}
                ownership={
                    release.navidromeAlbumIds.length > 0
                        ? 'owned'
                        : release.status === 'missing'
                          ? 'missing'
                          : 'syncing'
                }
                rgid={release.rgid}
                title={release.title}
                year={Number.parseInt(release.year, 10) || null}
            />
            <Text isMuted size="xs">
                {`${row.artist} · ${playsLabel(row.plays)}`}
            </Text>
        </div>
    );
};

/** What a list says in place of rows, from {@link ReadState}. */
const ReadLine = ({
    emptyText,
    onRetry,
    read,
    unreachableText,
}: {
    emptyText: string;
    onRetry: () => void;
    read: ReadState;
    unreachableText: string;
}) => {
    switch (read.kind) {
        case 'empty':
            return (
                <Text isMuted size="sm">
                    {emptyText}
                </Text>
            );
        case 'failed':
            return (
                <Group gap="sm">
                    <Text c="red" size="sm">
                        {read.text}
                    </Text>
                    {!read.permanent && (
                        <Button onClick={onRetry} size="compact-sm" variant="default">
                            Retry
                        </Button>
                    )}
                </Group>
            );
        case 'older':
            return (
                <Text isMuted size="sm">
                    This lb-bot does not provide this yet.
                </Text>
            );
        case 'reading':
            return (
                <Text isMuted size="sm">
                    Loading…
                </Text>
            );
        case 'unreachable':
            return (
                <Text isMuted size="sm">
                    {unreachableText}
                </Text>
            );
        default:
            return null;
    }
};

/**
 * Most played and not in the library, as cover cards in one carousel. lb-bot lists
 * albums and artists here - not single songs - and the row says so. Albums keep the
 * shared missing-album tile (the cover the app uses for an album it does not hold,
 * with its reviewed acquire flow); artists are round cards that open their page.
 */
export const UnownedSection = ({
    kind,
    onKind,
    onRetry,
    period,
    read,
    rows,
}: {
    kind: 'album' | 'artist';
    onKind: (kind: 'album' | 'artist') => void;
    onRetry: () => void;
    period: LbBotListeningPeriod;
    read: ReadState;
    rows: LbBotUnownedRow[] | undefined;
}) => {
    // B-407: an artist lb-bot did not match is looked up in the library by name (B-313's rule).
    const { open: openArtist } = useOpenLbBotArtist();
    const openMenu = useLibraryContextMenu();
    const shown = read.kind === 'rows' ? (rows ?? []) : [];
    const cards =
        kind === 'album'
            ? shown
                  .filter((row) => row.rgid)
                  .map((row) => ({
                      content: <UnownedAlbumTile row={row} />,
                      id: row.rgid,
                  }))
            : shown.map((row, i) => ({
                  content: (
                      <DiscoverTile
                          imageId={row.artistOwned ? row.artistId : null}
                          isRound
                          isUnowned={!row.artistOwned}
                          itemType={LibraryItem.ALBUM_ARTIST}
                          onClick={
                              artistTarget(row.artistOwned ? row.artistId : '', row.artistMbid)
                                  ? () =>
                                        openArtist({
                                            artistId: row.artistOwned ? row.artistId : '',
                                            mbid: row.artistMbid,
                                            name: row.artist,
                                            owned: row.artistOwned,
                                        })
                                  : undefined
                          }
                          onContextMenu={(event) =>
                              void openMenu(
                                  event,
                                  row.artistOwned && row.artistId
                                      ? { id: row.artistId, kind: 'artist' }
                                      : null,
                              )
                          }
                          subtitle={playsLabel(row.plays)}
                          title={`${i + 1}. ${row.artist}`}
                      />
                  ),
                  id: `${row.artistMbid}-${row.artist}`,
              }));
    return (
        <Stack gap="md">
            <Group gap="xs">
                <Button
                    onClick={() => onKind('album')}
                    size="compact-sm"
                    variant={kind === 'album' ? 'filled' : 'default'}
                >
                    Albums
                </Button>
                <Button
                    onClick={() => onKind('artist')}
                    size="compact-sm"
                    variant={kind === 'artist' ? 'filled' : 'default'}
                >
                    Artists
                </Button>
            </Group>
            <ReadLine
                emptyText="Nothing here for this period."
                onRetry={onRetry}
                read={read}
                unreachableText="lb-bot is not reachable, so this list cannot be read."
            />
            <DiscoverRow
                because={`The ${kind === 'album' ? 'albums' : 'artists'} you played most ${periodPhrase(period)} that your library does not hold. lb-bot lists albums and artists here, not single songs.`}
                cards={cards}
                isEmpty={cards.length === 0}
                title={
                    kind === 'album' ? 'Albums not in your library' : 'Artists not in your library'
                }
            />
        </Stack>
    );
};

const timeOf = (epochSeconds: number): string =>
    new Date(epochSeconds * 1000).toLocaleString(undefined, {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
    });

/**
 * Recent plays as song rows in the look of the play queue: cover, title, artist and
 * album, when it was played. The cover is the album's, from the Navidrome id the row
 * carries (the placeholder when there is none); nothing is requested per row.
 */
export const RecentSection = ({
    hasMore,
    loadingMore,
    onMore,
    onRetry,
    read,
    rows,
}: {
    hasMore: boolean;
    loadingMore: boolean;
    onMore: () => void;
    onRetry: () => void;
    read: ReadState;
    rows: LbBotRecentRow[];
}) => {
    const openMenu = useHistoryContextMenu();
    // B-407: an artist lb-bot did not match is looked up in the library by name (B-313's rule).
    const artistLink = useOpenLbBotArtist();
    return (
        <Stack gap="sm">
            <ReadLine
                emptyText="No plays yet."
                onRetry={onRetry}
                read={read}
                unreachableText="lb-bot is not reachable, so recent plays cannot be read."
            />
            <div className={styles.history}>
                {rows.map((row, index) => {
                    const view = recentRowView(row);
                    return (
                        // The index too: two plays in the same second with no recording MBID
                        // share every other part of the key. Pages only append, so it is stable.
                        <div
                            className={styles.entry}
                            key={`${row.listenedAt}-${row.recordingMbid}-${row.track}-${index}`}
                            onContextMenu={(event) => void openMenu(event, row)}
                        >
                            <ItemImage
                                className={styles.photo}
                                containerClassName={styles.thumb}
                                id={view.imageId}
                                itemType={LibraryItem.ALBUM}
                                type="table"
                            />
                            <Stack gap={0} style={{ minWidth: 0 }}>
                                <MaybeLink
                                    to={albumPath(albumTarget(row.ndAlbumId, row.rgid), {
                                        artist: row.artist,
                                        artistMbid: row.artistMbid,
                                        title: row.release,
                                    })}
                                >
                                    {view.title}
                                </MaybeLink>
                                <Group gap={4} wrap="nowrap">
                                    <MaybeLink
                                        onClick={(event) => {
                                            const artist = {
                                                artistId: row.ndArtistId,
                                                mbid: row.artistMbid,
                                                name: row.artist,
                                            };
                                            if (!artistLink.looksUp(artist)) return;
                                            event.preventDefault();
                                            artistLink.open(artist);
                                        }}
                                        to={artistLinkPath(
                                            row.ndArtistId,
                                            row.artistMbid,
                                            row.artist,
                                        )}
                                    >
                                        {row.artist}
                                    </MaybeLink>
                                    {row.release && (
                                        <Text className={styles.clip} isMuted size="sm">
                                            {`· ${row.release}`}
                                        </Text>
                                    )}
                                </Group>
                            </Stack>
                            <Text isMuted size="xs">
                                {timeOf(row.listenedAt)}
                            </Text>
                        </div>
                    );
                })}
            </div>
            {hasMore && (
                <Button loading={loadingMore} onClick={onMore} size="compact-md" variant="default">
                    Show more
                </Button>
            )}
        </Stack>
    );
};
