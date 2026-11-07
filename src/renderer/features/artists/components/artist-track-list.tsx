import formatDuration from 'format-duration';
import {
    type CSSProperties,
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import styles from './artist-track-list.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import equalizer from '/@/renderer/components/item-list/item-table-list/columns/row-index-column.module.css';
import {
    JOINED_ARTISTS_MUTED_PROPS,
    JoinedArtists,
} from '/@/renderer/features/albums/components/joined-artists';
import {
    blurKeepsRowFocus,
    hasOtherArtists,
    nextStarsDrawn,
    NO_ROW_FOCUS,
    type RowFocus,
    rowFocusOf,
    staticStarsMask,
    TRACK_LIST_NARROW_PX,
    trackColumns,
    trackColumnTemplate,
    visibleTracks,
} from '/@/renderer/features/artists/artist-track-list-model';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { useRemoteAwareStatus } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { useSetFavorite } from '/@/renderer/features/shared/hooks/use-set-favorite';
import { useSetRating } from '/@/renderer/features/shared/hooks/use-set-rating';
import { useIsMutatingCreateFavorite } from '/@/renderer/features/shared/mutations/create-favorite-mutation';
import { useIsMutatingDeleteFavorite } from '/@/renderer/features/shared/mutations/delete-favorite-mutation';
import { useIsMutatingRating } from '/@/renderer/features/shared/mutations/set-rating-mutation';
import { useDragDrop } from '/@/renderer/hooks/use-drag-drop';
import {
    useCurrentServer,
    useHubIsRemoteActive,
    useHubRemoteNowPlaying,
    usePlayerSong,
    useShowFavorites,
    useShowRatings,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { ExplicitIndicator } from '/@/shared/components/explicit-indicator/explicit-indicator';
import { Icon } from '/@/shared/components/icon/icon';
import { Rating } from '/@/shared/components/rating/rating';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { LibraryItem, ServerType, Song } from '/@/shared/types/domain-types';
import { DragOperation, DragTarget } from '/@/shared/types/drag-and-drop';
import { PlayerStatus } from '/@/shared/types/types';

// The artist page binds Enter to "play the selection" app-wide, and the hotkey hook prevents the
// default of every Enter it sees, so a focused button or link would never activate. The list keeps
// its keys: the toggle here, and every control inside a row through the row's own handler.
const keepKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};

/**
 * The playing song's id, the remote session's while another device plays (as the player bar shows
 * it). Only the id: `useRemoteAwarePlayerSong` would also resolve the remote song's detail.
 */
const usePlayingId = (): string | undefined => {
    const isRemote = useHubIsRemoteActive();
    const local = usePlayerSong();
    const remote = useHubRemoteNowPlaying();
    return isRemote && remote ? remote.id : local?.id;
};

interface ArtistTrackListProps {
    /** The page's artist: a row shows its artists on a second line only when someone else is credited. */
    artistId?: string;
    initial?: number;
    max?: number;
    /** Plays from that row; the caller decides the queue (the whole list, as the table did). */
    onPlay: (song: Song) => void;
    /** The full list's own page, offered as "Show all" once the list is unfolded. */
    showAllTo?: string;
    songs: Song[];
}

/**
 * The artist page's compact track list (R10, B-218), Spotify's Popular: number (an equaliser on the
 * playing row, a play button on hover), a 40 px cover, the title with the other artists under it, the
 * star rating and the favourite heart (R13, B-245: the album table's controls, editable, in the play
 * count's place; unset ones show on hover), the duration and the row menu. Its own columns
 * (`trackColumns`): nothing here reads the Songs library's table settings, so the library's columns
 * and filters never reach it. Folded to `initial` rows, "See more" shows up to `max`, and then
 * "Show all" opens the full list's page.
 */
export const ArtistTrackList = ({
    artistId,
    initial = 5,
    max = 10,
    onPlay,
    showAllTo,
    songs,
}: ArtistTrackListProps) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const playingId = usePlayingId();
    const status = useRemoteAwareStatus();
    const { rows, toggle } = visibleTracks({ expanded, initial, max, songs });
    const controls = useRowControls();
    const style = useColumnStyle(controls);

    return (
        <div className={styles.root} data-artist-track-list="" style={style}>
            <ol className={styles.list}>
                {rows.map((song, index) => {
                    const active = playingId === song.id;
                    return (
                        <TrackRow
                            active={active}
                            artistId={artistId}
                            controls={controls}
                            index={index}
                            key={song.id}
                            onPlay={onPlay}
                            playing={active && status === PlayerStatus.PLAYING}
                            song={song}
                        />
                    );
                })}
            </ol>
            {toggle && (
                <div className={styles.footer}>
                    <button
                        className={styles.toggle}
                        onClick={() => setExpanded(toggle === 'more')}
                        onKeyDown={keepKeys}
                        type="button"
                    >
                        {toggle === 'more'
                            ? t('page.albumArtistDetail.seeMore')
                            : t('page.albumArtistDetail.showLess')}
                    </button>
                    {toggle === 'less' && showAllTo && (
                        <Link
                            className={`${styles.toggle} ${styles.showAll}`}
                            onKeyDown={keepKeys}
                            to={showAllTo}
                        >
                            {t('page.albumArtistDetail.showAll')}
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
};

/** The rating and heart the rows draw, and what editing them calls (the album table's mutations). */
interface RowControls {
    favorite: boolean;
    favoriteBusy: boolean;
    onFavorite: (song: Song, favorite: boolean) => void;
    onRate: (song: Song, rating: number) => void;
    rating: boolean;
    ratingBusy: boolean;
}

const useRowControls = (): RowControls => {
    const server = useCurrentServer();
    const showRatings = useShowRatings();
    const showFavorites = useShowFavorites();
    const setRating = useSetRating();
    const setFavorite = useSetFavorite();
    const ratingBusy = useIsMutatingRating();
    const creating = useIsMutatingCreateFavorite();
    const deleting = useIsMutatingDeleteFavorite();
    return {
        favorite: showFavorites,
        favoriteBusy: creating || deleting,
        onFavorite: (song, favorite) =>
            setFavorite(song._serverId, [song.id], LibraryItem.SONG, favorite),
        onRate: (song, rating) => setRating(song._serverId, [song.id], LibraryItem.SONG, rating),
        // Jellyfin keeps no star ratings.
        rating: showRatings && server?.type !== ServerType.JELLYFIN,
        ratingBusy,
    };
};

/** The grid's columns, wide and narrow, from the model; the stylesheet only picks one by width. */
const useColumnStyle = ({ favorite, rating }: Pick<RowControls, 'favorite' | 'rating'>) =>
    useMemo(
        () =>
            ({
                '--track-columns': trackColumnTemplate(
                    trackColumns(Number.POSITIVE_INFINITY, { favorite, rating }),
                ),
                '--track-columns-narrow': trackColumnTemplate(
                    trackColumns(TRACK_LIST_NARROW_PX - 1, { favorite, rating }),
                ),
            }) as CSSProperties,
        [favorite, rating],
    );

const stopDoubleClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
};

interface TrackRowProps {
    active: boolean;
    artistId?: string;
    controls: RowControls;
    index: number;
    onPlay: (song: Song) => void;
    playing: boolean;
    song: Song;
}

const TrackRow = ({ active, artistId, controls, index, onPlay, playing, song }: TrackRowProps) => {
    const { t } = useTranslation();
    // The five stars are drawn while the row is pointed at or focused, and while a rating save is
    // in flight (B-265: they stayed drawn until the page was left). Otherwise a rated row shows its
    // stars as one element and an unrated row shows none, so the page keeps R10's node count.
    const [pointer, setPointer] = useState(false);
    const [focus, setFocus] = useState<RowFocus>(NO_ROW_FOCUS);
    const [drawn, setDrawn] = useState(false);
    const ratingRef = useRef<HTMLDivElement>(null);
    const starsDrawn = nextStarsDrawn({ busy: controls.ratingBusy, drawn, focus, pointer });
    if (starsDrawn !== drawn) setDrawn(starsDrawn);
    // A click focuses the row itself and does not keep the stars drawn; Tab (focus-visible) or a
    // star holding the focus does (R15 review I3).
    const onFocus = (event: FocusEvent<HTMLLIElement>) => {
        const target = event.target as HTMLElement;
        setFocus(
            rowFocusOf({
                focusVisible: target.matches(':focus-visible'),
                inStars: ratingRef.current?.contains(target) ?? false,
            }),
        );
    };
    // Focus moving between the row's own controls (star to star, star to heart) is not a leave, and
    // neither is the window losing the focus (R15 review I4: Alt-Tab with a star focused).
    const onBlur = (event: FocusEvent<HTMLLIElement>) => {
        const keep = blurKeepsRowFocus({
            toInsideRow: event.currentTarget.contains(event.relatedTarget as Node | null),
            windowFocused: document.hasFocus(),
        });
        if (!keep) setFocus(NO_ROW_FOCUS);
    };
    const openMenu = (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        ContextMenuController.call({ cmd: { items: [song], type: LibraryItem.SONG }, event });
    };
    // The row drags its song, as the library table's rows and the album tiles below it do: onto the
    // queue (which takes a SONG drop) or a sidebar playlist (any ADD drop). One song, no selection.
    const drag = useMemo(
        () => ({
            getId: () => [song.id],
            getItem: () => [song],
            itemType: LibraryItem.SONG,
            operation: [DragOperation.ADD],
            target: DragTarget.SONG,
        }),
        [song],
    );
    const { isDragging, ref } = useDragDrop<HTMLLIElement>({ drag, isEnabled: true });
    // The row is focusable and Enter on it plays from it (the table's Enter). A key on a control
    // inside (play, the artist links, the menu) is that control's, kept from the page's hotkey.
    const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
        if (event.target !== event.currentTarget) {
            keepKeys(event);
            return;
        }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        onPlay(song);
    };

    return (
        <li
            className={styles.row}
            data-active={active || undefined}
            data-dragging={isDragging || undefined}
            onBlur={onBlur}
            onContextMenu={openMenu}
            onDoubleClick={() => onPlay(song)}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
            onPointerEnter={() => setPointer(true)}
            onPointerLeave={() => setPointer(false)}
            ref={ref}
            tabIndex={0}
        >
            <div className={styles.index}>
                {active ? (
                    <span
                        aria-hidden
                        className={`${equalizer.equalizer} ${styles.mark}`}
                        data-playing={playing || undefined}
                    >
                        <span />
                        <span />
                        <span />
                    </span>
                ) : (
                    <span className={styles.mark}>{index + 1}</span>
                )}
                <button
                    aria-label={t('page.albumArtistDetail.playSong', { title: song.name })}
                    className={styles.play}
                    onClick={() => onPlay(song)}
                    onDoubleClick={(event) => event.stopPropagation()}
                    type="button"
                >
                    <Icon fill="default" icon="mediaPlay" />
                </button>
            </div>
            <ItemImage
                blurHash={song.blurHash}
                className={styles.coverImage}
                containerClassName={styles.cover}
                explicitStatus={song.explicitStatus}
                id={song.imageId}
                itemType={LibraryItem.SONG}
                serverId={song._serverId}
                src={song.imageUrl}
                thumbHash={song.thumbHash}
                type="table"
            />
            <div className={styles.text}>
                {/* Plain text, as the table's title was: a link here would take the first click of a
                    double-click and open the album instead of playing ("Go to album" is in the menu). */}
                <span className={styles.title}>
                    {song.name}
                    <ExplicitIndicator explicitStatus={song.explicitStatus} />
                </span>
                {hasOtherArtists(song.artists, artistId) && (
                    <span className={styles.artists}>
                        <JoinedArtists
                            artistName={song.artistName}
                            artists={song.artists}
                            {...JOINED_ARTISTS_MUTED_PROPS}
                        />
                    </span>
                )}
            </div>
            {controls.rating && (
                <div className={styles.rating} onDoubleClick={stopDoubleClick} ref={ratingRef}>
                    {!starsDrawn && song.userRating ? (
                        // Until the row is pointed at or focused, a rated row's stars are one
                        // element (R13 review M5: five Mantine stars are ~36 nodes a row).
                        <span
                            aria-label={t('page.albumArtistDetail.songRated', {
                                count: song.userRating,
                                title: song.name,
                            })}
                            className={styles.staticStars}
                            role="img"
                            style={
                                {
                                    '--stars-filled': `calc(${song.userRating} * var(--theme-font-size-xs))`,
                                    '--stars-mask': staticStarsMask(song.userRating),
                                } as CSSProperties
                            }
                        />
                    ) : null}
                    {starsDrawn && (
                        <Rating
                            busy={controls.ratingBusy}
                            className={song.userRating ? undefined : styles.hoverOnly}
                            // Each star names its song: five rows of "1" to "5" read alike. The
                            // first input is Mantine's "no rating".
                            getSymbolLabel={(count) =>
                                count === 0
                                    ? t('page.albumArtistDetail.rateSongNone', { title: song.name })
                                    : t('page.albumArtistDetail.rateSong', {
                                          count,
                                          title: song.name,
                                      })
                            }
                            onChange={(rating) => controls.onRate(song, rating)}
                            size="xs"
                            value={song.userRating || 0}
                        />
                    )}
                </div>
            )}
            {controls.favorite && (
                <ActionIcon
                    // Not `disabled` while a save is in flight, which would drop the keyboard focus.
                    aria-disabled={controls.favoriteBusy || undefined}
                    aria-label={t(
                        song.userFavorite
                            ? 'page.albumArtistDetail.unfavoriteSong'
                            : 'page.albumArtistDetail.favoriteSong',
                        { title: song.name },
                    )}
                    aria-pressed={song.userFavorite}
                    className={song.userFavorite ? undefined : styles.hoverOnly}
                    icon="favorite"
                    iconProps={{
                        color: song.userFavorite ? 'primary' : 'muted',
                        fill: song.userFavorite ? 'primary' : undefined,
                        size: 'md',
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        if (controls.favoriteBusy) return;
                        controls.onFavorite(song, !song.userFavorite);
                    }}
                    onDoubleClick={stopDoubleClick}
                    size="xs"
                    variant="subtle"
                />
            )}
            <span className={styles.duration}>{formatDuration(song.duration)}</span>
            <button
                aria-label={t('page.albumArtistDetail.songMenu', { title: song.name })}
                className={styles.more}
                onClick={openMenu}
                onDoubleClick={(event) => event.stopPropagation()}
                type="button"
            >
                <Icon icon="ellipsisHorizontal" />
            </button>
        </li>
    );
};

/** The list's shape while its songs load: the rows it will most likely show, so nothing jumps. */
const SKELETON_STYLE = {
    '--track-columns': trackColumnTemplate(
        trackColumns(Number.POSITIVE_INFINITY, { favorite: true, rating: true }),
    ),
    '--track-columns-narrow': trackColumnTemplate(
        trackColumns(TRACK_LIST_NARROW_PX - 1, { favorite: true, rating: true }),
    ),
} as CSSProperties;

export const ArtistTrackListSkeleton = ({ rows = 5 }: { rows?: number }) => (
    <div aria-hidden className={styles.root} style={SKELETON_STYLE}>
        <div className={styles.list}>
            {Array.from({ length: rows }, (_, index) => (
                <div className={styles.row} key={index}>
                    <span className={styles.index} />
                    <Skeleton className={styles.cover} enableAnimation height={40} width={40} />
                    <Skeleton enableAnimation height="0.9rem" width={`${60 - index * 6}%`} />
                </div>
            ))}
        </div>
    </div>
);
