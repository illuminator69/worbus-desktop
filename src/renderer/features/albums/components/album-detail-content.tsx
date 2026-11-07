import type {
    ItemListStateActions,
    ItemListStateItemWithRequiredProperties,
} from '/@/renderer/components/item-list/helpers/item-list-state';

import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ReactNode, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link, useParams } from 'react-router';

import styles from './album-detail-content.module.css';

import { useGridCarouselContainerQuery } from '/@/renderer/components/grid-carousel/grid-carousel-v2';
import { useItemListStateSubscription } from '/@/renderer/components/item-list/helpers/item-list-state';
import { playSongFromItemListControl } from '/@/renderer/components/item-list/helpers/play-row-from-list';
import { useItemListColumnReorder } from '/@/renderer/components/item-list/helpers/use-item-list-column-reorder';
import { useItemListColumnResize } from '/@/renderer/components/item-list/helpers/use-item-list-column-resize';
import { SONG_TABLE_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { ItemTableList } from '/@/renderer/components/item-list/item-table-list/item-table-list';
import { ItemTableListColumn } from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { ItemControls } from '/@/renderer/components/item-list/types';
import { aboutRow } from '/@/renderer/features/albums/album-page-layout';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { AlbumInfiniteCarousel } from '/@/renderer/features/albums/components/album-infinite-carousel';
import { AlbumGapBox } from '/@/renderer/features/lbbot/components/gap-box';
import { SimilarAlbumsShelf } from '/@/renderer/features/lbbot/components/similar-albums-shelf';
import { useLbBotAlbumMeta } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ClampFold } from '/@/renderer/features/motion/clamp-fold';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    ListConfigMenu,
    SONG_DISPLAY_TYPES,
} from '/@/renderer/features/shared/components/list-config-menu';
import {
    CLIENT_SIDE_SONG_FILTERS,
    ListSortByDropdownControlled,
} from '/@/renderer/features/shared/components/list-sort-by-dropdown';
import { FILTER_KEYS, searchLibraryItems } from '/@/renderer/features/shared/utils';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServer, usePlayerSong } from '/@/renderer/store';
import { useExternalLinks, useSettingsStore } from '/@/renderer/store/settings.store';
import { sentenceCase, titleCase } from '/@/renderer/utils';
import { replaceURLWithHTMLLinks } from '/@/renderer/utils/linkify';
import { normalizeReleaseTypes } from '/@/renderer/utils/normalize-release-types';
import { setJsonSearchParam } from '/@/renderer/utils/query-params';
import { sanitize } from '/@/renderer/utils/sanitize';
import { sortSongList } from '/@/shared/api/utils';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { useDebouncedValue } from '/@/shared/hooks/use-debounced-value';
import {
    Album,
    AlbumListSort,
    ExplicitStatus,
    LibraryItem,
    ServerType,
    Song,
    SongListSort,
    SortOrder,
} from '/@/shared/types/domain-types';
import { LbBotMeta, LbBotMetaCredit } from '/@/shared/types/lbbot-types';
import { ItemListKey, ListDisplayType } from '/@/shared/types/types';

/** One chip in the About row's right column (board `.tags span`): a link when it has `to`. */
interface AlbumChip {
    id: string;
    label: string;
    to?: null | string;
}

const MOOD_TAG = 'mood';
const GROUPING_TAG = 'grouping';
const RELEASE_COUNTRY_TAG = 'releasecountry';
const RELEASE_STATUS_TAG = 'releasestatus';

/**
 * The right column's chips, in the board's two lines: the genres, then the tags (release types,
 * country, status, explicit or clean, moods, groupings) with the record label last as
 * "Record label: X". The label used to be a ℗ line under the table; it is a chip here.
 */
const useAlbumChips = (album: Album | undefined): { genres: AlbumChip[]; tags: AlbumChip[] } => {
    const { t } = useTranslation();

    return useMemo(() => {
        if (!album) return { genres: [], tags: [] };

        const genres: AlbumChip[] = (album.genres ?? []).map((genre) => ({
            id: `genre-${genre.id}`,
            label: genre.name,
            to: generatePath(AppRoute.LIBRARY_GENRES_DETAIL, { genreId: genre.id }),
        }));

        const releaseTypes = [...(album.releaseTypes ?? [])];
        if (
            album.isCompilation &&
            !releaseTypes.some((type) => type.toLowerCase() === 'compilation')
        ) {
            releaseTypes.push('compilation');
        }

        const tags: AlbumChip[] = [
            ...normalizeReleaseTypes(releaseTypes, t).map((type) => ({
                id: `type-${type}`,
                label: titleCase(type),
            })),
            ...(album.tags?.[RELEASE_COUNTRY_TAG] ?? []).map((country) => ({
                id: `country-${country}`,
                label: country,
            })),
            ...(album.tags?.[RELEASE_STATUS_TAG] ?? []).map((status) => ({
                id: `status-${status}`,
                label: status,
            })),
        ];

        if (album.explicitStatus === ExplicitStatus.EXPLICIT) {
            tags.push({ id: 'explicit', label: t('common.explicit') });
        } else if (album.explicitStatus === ExplicitStatus.CLEAN) {
            tags.push({ id: 'clean', label: t('common.clean') });
        }

        for (const mood of album.tags?.[MOOD_TAG] ?? []) {
            tags.push({ id: `mood-${mood}`, label: mood });
        }

        for (const grouping of album.tags?.[GROUPING_TAG] ?? []) {
            tags.push({
                id: `grouping-${grouping}`,
                label: grouping,
                to:
                    album._serverType === ServerType.NAVIDROME
                        ? `${AppRoute.LIBRARY_ALBUMS}?${setJsonSearchParam(
                              new URLSearchParams(),
                              FILTER_KEYS.ALBUM._CUSTOM,
                              { grouping: [grouping] },
                          ).toString()}`
                        : null,
            });
        }

        for (const label of album.recordLabels ?? []) {
            tags.push({
                id: `label-${label}`,
                label: t('page.albumDetail.recordLabelChip', { label }),
                to:
                    album._serverType === ServerType.SUBSONIC
                        ? null
                        : `${AppRoute.LIBRARY_ALBUMS}?${setJsonSearchParam(
                              new URLSearchParams(),
                              FILTER_KEYS.ALBUM._CUSTOM,
                              album._serverType === ServerType.JELLYFIN
                                  ? { Studios: [label] }
                                  : { recordlabel: [label] },
                          ).toString()}`,
            });
        }

        return { genres, tags };
    }, [album, t]);
};

const ChipLine = ({ chips }: { chips: AlbumChip[] }) =>
    chips.length > 0 ? (
        <div className={styles.chips}>
            {chips.map((chip) =>
                chip.to ? (
                    <Link className={styles.chipTag} key={chip.id} to={chip.to}>
                        {chip.label}
                    </Link>
                ) : (
                    <span className={styles.chipTag} key={chip.id}>
                        {chip.label}
                    </span>
                ),
            )}
        </div>
    ) : null;

// interface AlbumMetadataArtistsProps {
//     artists?: Array<{ id: string; name: string }>;
// }

// const AlbumMetadataArtists = ({ artists }: AlbumMetadataArtistsProps) => {
//     const { t } = useTranslation();

//     if (!artists || artists.length === 0) return null;

//     return (
//         <Stack gap="xs">
//             <Text fw={600} isNoSelect size="sm" tt="uppercase">
//                 {t('entity.albumArtist', {
//                     count: artists.length,
//                 })}
//             </Text>
//             <Pill.Group>
//                 {artists.map((artist) => (
//                     <PillLink
//                         key={`artist-${artist.id}`}
//                         size="md"
//                         to={generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, {
//                             albumArtistId: artist.id,
//                         })}
//                     >
//                         {artist.name}
//                     </PillLink>
//                 ))}
//             </Pill.Group>
//         </Stack>
//     );
// };

const getListenBrainzUrl = (
    mbzReleaseGroupId: null | string,
    albumArtist?: string,
    albumName?: string,
) => {
    if (mbzReleaseGroupId) {
        return `https://listenbrainz.org/album/${mbzReleaseGroupId}`;
    }

    if (albumArtist || albumName) {
        return `https://listenbrainz.org/search/?search_term=${encodeURIComponent([albumArtist, albumName].filter(Boolean).join(' ').trim())}`;
    }

    return null;
};

const getQobuzUrl = (albumArtist?: string, albumName?: string) => {
    if (albumArtist || albumName) {
        return `https://www.qobuz.com/us-en/search/albums/${encodeURIComponent([albumArtist, albumName].filter(Boolean).join(' ').trim())}`;
    }

    return null;
};

/** One external link in the right column (board `.lnk`): the service's name, opened outside. */
interface AlbumLink {
    href: string;
    key: string;
    label: string;
    newWindow: boolean;
    title: string;
}

/**
 * The external links the user's settings allow, as the board's text links. Service names are
 * proper nouns and stay as written; the "Open in X" tooltip carries the translation.
 */
const useAlbumLinks = (album: Album | undefined): AlbumLink[] => {
    const { t } = useTranslation();
    const { externalLinks, lastFM, listenBrainz, musicBrainz, nativeSpotify, qobuz, spotify } =
        useExternalLinks();

    if (!album || !externalLinks) return [];

    const albumArtist = album.albumArtistName;
    const albumName = album.name;
    const links: AlbumLink[] = [];

    if (lastFM) {
        links.push({
            href: `https://www.last.fm/music/${encodeURIComponent(
                albumArtist || '',
            )}/${encodeURIComponent(albumName || '')}`,
            key: 'lastfm',
            label: 'Last.fm',
            newWindow: true,
            title: t('action.openIn.lastfm'),
        });
    }
    if (album.mbzId && musicBrainz) {
        links.push({
            href: `https://musicbrainz.org/release/${album.mbzId}`,
            key: 'musicbrainz',
            label: 'MusicBrainz',
            newWindow: true,
            title: t('action.openIn.musicbrainz'),
        });
    }
    const listenBrainzUrl = getListenBrainzUrl(
        album.mbzReleaseGroupId || null,
        albumArtist,
        albumName,
    );
    if (listenBrainz && listenBrainzUrl) {
        links.push({
            href: listenBrainzUrl,
            key: 'listenbrainz',
            label: 'ListenBrainz',
            newWindow: true,
            title: t('action.openIn.listenbrainz'),
        });
    }
    const qobuzUrl = getQobuzUrl(albumArtist, albumName);
    if (qobuz && qobuzUrl) {
        links.push({
            href: qobuzUrl,
            key: 'qobuz',
            label: 'Qobuz',
            newWindow: true,
            title: t('action.openIn.qobuz'),
        });
    }
    if (spotify) {
        links.push({
            href: nativeSpotify
                ? `spotify:search:${encodeURIComponent(albumArtist || '')}%20${encodeURIComponent(albumName || '')}`
                : `https://open.spotify.com/search/${encodeURIComponent(albumArtist || '')}%20${encodeURIComponent(albumName || '')}`,
            key: 'spotify',
            label: 'Spotify',
            newWindow: !nativeSpotify,
            title: t('action.openIn.spotify'),
        });
    }

    return links;
};

export const AlbumDetailContent = () => {
    const { t } = useTranslation();
    const { albumId } = useParams() as { albumId: string };
    const server = useCurrentServer();
    const detailQuery = useSuspenseQuery(
        albumQueries.detail({ query: { id: albumId }, serverId: server.id }),
    );

    const comment = detailQuery?.data?.comment;

    const mbzId = detailQuery?.data?.mbzId;
    const mbzReleaseGroupId = detailQuery?.data?.mbzReleaseGroupId;

    // `getAlbumInfo2.notes` — the album's own description, and since the Apple
    // Music agent joined Navidrome's chain it is real editorial prose rather
    // than the empty field it used to be. The page never asked for it: the
    // controller has produced it all along with Discord Rich Presence as its
    // only consumer, and that reads `imageUrl` alone.
    const albumInfoQuery = useQuery({
        ...albumQueries.info({ query: { id: albumId }, serverId: server.id }),
        enabled: Boolean(server?.id && albumId),
    });
    const notes = albumInfoQuery.data?.notes;
    // Until this settles we do not know whether there are notes, and rendering
    // the `comment` meanwhile would mean replacing it the moment they land —
    // the very swap this whole block exists to remove. It is a Navidrome call
    // alongside the detail the page already waits for, so the slot is filled
    // once, by one decision.
    const notesPending = albumInfoQuery.isLoading;

    const metaQuery = useLbBotAlbumMeta(mbzReleaseGroupId, mbzId);
    const meta = metaQuery.data;
    const hasMetaText = Boolean(meta?.summary || meta?.paragraphs.length);
    const hasDescription = !notesPending && Boolean(notes || comment || hasMetaText);
    // A skeleton of the block while its text may still come: the album's own notes are
    // not read yet, or lb-bot's prose is on its way and nothing else will fill the slot.
    // Without it the block arrived after the tracklist was drawn and pushed it down.
    const descriptionLoading =
        notesPending || (!notes && !comment && Boolean(mbzReleaseGroupId) && metaQuery.isLoading);

    const chips = useAlbumChips(detailQuery?.data);
    const links = useAlbumLinks(detailQuery?.data);
    const row = aboutRow({
        aboutLoading: descriptionLoading,
        hasAbout: hasDescription,
        linkCount: links.length,
        tagCount: chips.genres.length + chips.tags.length,
    });
    const showAbout = row === 'two' || row === 'about-only';
    const showSide = row === 'two' || row === 'side-only';

    return (
        <div className={styles.contentContainer}>
            <div className={styles.detailContainer}>
                {/* The About row, in the artist page's order (R13, B-243): the text folded to five
                    lines, then the genres, the tags with the record label, and the links, full
                    width under it; nothing when neither side has anything (album-page-layout.ts). */}
                {row !== 'none' && (
                    <div className={styles.aboutRow} data-about-row={row}>
                        {/* ONE description, and the slot is filled by the response
                            this page already blocks on. These used to be unconditional
                            siblings, so an album carrying both `notes` and a `comment`
                            tag rendered two unlabelled descriptions stacked on top of
                            each other, and the lb-bot block popped in above whatever
                            you had started reading.

                            Order is arrival order, which is also preference order:
                            Navidrome's `notes` and the ID3 `comment` are both part of
                            the album detail this page waits for anyway, so they are on
                            screen at once and never move. lb-bot's Wikipedia prose is
                            last, it arrives a second or more later behind a
                            MusicBrainz hop, so it may only ever fill a slot that was
                            EMPTY. It must never replace text already being read. */}
                        {showAbout &&
                            (descriptionLoading ? (
                                <section className={styles.about}>
                                    <div className={styles.label}>
                                        {t('page.albumDetail.about')}
                                    </div>
                                    <Stack gap="xs">
                                        <Skeleton height={16} />
                                        <Skeleton height={16} />
                                        <Skeleton height={16} width="70%" />
                                    </Stack>
                                </section>
                            ) : (
                                <AlbumAbout
                                    albumId={albumId}
                                    // lb-bot's prose carries its CC BY-SA attribution and
                                    // its links, outside the clamp, so collapsing never
                                    // hides them.
                                    footer={
                                        !notes && !comment && meta ? (
                                            <MetaSource meta={meta} />
                                        ) : null
                                    }
                                >
                                    {notes ? (
                                        // Editorial notes are HTML ("<b>100 Best Albums</b>",
                                        // "<i>Dummy</i>"), so they go through the sanitizer
                                        // like the artist biography, not into a plain Text.
                                        <div
                                            dangerouslySetInnerHTML={{ __html: sanitize(notes) }}
                                        />
                                    ) : comment ? (
                                        <div>{replaceURLWithHTMLLinks(comment)}</div>
                                    ) : (
                                        meta && (
                                            <div>
                                                {(meta.paragraphs.length > 0
                                                    ? meta.paragraphs
                                                    : [meta.summary]
                                                )
                                                    .filter(Boolean)
                                                    .map((paragraph, index) => (
                                                        <p key={index}>{paragraph}</p>
                                                    ))}
                                            </div>
                                        )
                                    )}
                                </AlbumAbout>
                            ))}
                        {showSide && (
                            <div className={styles.side}>
                                <ChipLine chips={chips.genres} />
                                <ChipLine chips={chips.tags} />
                                {links.length > 0 && (
                                    <div className={styles.links}>
                                        {links.map((link) => (
                                            <a
                                                className={styles.link}
                                                href={link.href}
                                                key={link.key}
                                                rel="noopener noreferrer"
                                                target={link.newWindow ? '_blank' : undefined}
                                                title={link.title}
                                            >
                                                {link.label}
                                                <Icon icon="externalLink" size="sm" />
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {detailQuery?.data?.songs && detailQuery.data.songs.length > 0 && (
                    <div className={styles.songsColumn}>
                        {/* R11 (B-223): lb-bot's gaps box, above the toolbar, only for an album
                            the library holds part of. */}
                        <AlbumGapBox album={detailQuery.data} />
                        <AlbumDetailSongsTable songs={detailQuery.data.songs} />
                    </div>
                )}
                {/* Credits are a section of their own, below the tracklist. They come
                    from lb-bot and so land late, which is fine: nothing is under them
                    but the carousels, which land late as well. */}
                {meta && meta.credits.length > 0 && (
                    <Stack className={styles.credits} gap="md">
                        <AlbumCredits credits={meta.credits} />
                    </Stack>
                )}
                <AlbumDetailCarousels data={detailQuery?.data} />
            </div>
        </div>
    );
};

/** The About open state as the person set it this session, per album (not persisted). */
const aboutOpen = new Set<string>();

/**
 * The About (R13, B-243): the board's `.lbl` label, then the text at 14 px / 1.55, 62ch wide,
 * folded like the artist page's About (`ClampFold`: five lines, the arrow at the cut, the fold's
 * motion). The tags and links sit under it, so a folded About leaves no empty band beside them.
 */
const AlbumAbout = ({
    albumId,
    children,
    footer,
}: {
    albumId: string;
    children: ReactNode;
    footer?: ReactNode;
}) => {
    const { t } = useTranslation();
    return (
        <section className={styles.about}>
            <div className={styles.label}>{t('page.albumDetail.about')}</div>
            <ClampFold
                className={styles.aboutText}
                initialOpen={aboutOpen.has(albumId)}
                name="album-about"
                onOpenChange={(open) => {
                    if (open) aboutOpen.add(albumId);
                    else aboutOpen.delete(albumId);
                }}
            >
                {children}
            </ClampFold>
            {footer}
        </section>
    );
};

/** lb-bot's attribution (a CC BY-SA condition) and its links, under its prose. */
const MetaSource = ({ meta }: { meta: LbBotMeta }) => {
    const { t } = useTranslation();
    if (!meta.source && meta.links.length === 0) return null;
    return (
        <div className={styles.metaSource}>
            {meta.source && (
                <Text isMuted size="sm">
                    {t('page.albumDetail.aboutSource', {
                        license: meta.source.license,
                        name: meta.source.name,
                    })}{' '}
                    <a href={meta.source.url} rel="noreferrer" target="_blank">
                        {t('page.albumDetail.readMore')}
                    </a>
                </Text>
            )}
            {meta.links.length > 0 && (
                <Group gap="sm">
                    {meta.links.map((link) => (
                        <Text isMuted key={link.url} size="sm">
                            <a href={link.url} rel="noreferrer" target="_blank">
                                {link.label}
                            </a>
                        </Text>
                    ))}
                </Group>
            )}
        </div>
    );
};

/**
 * Producer, engineer, writer, featured performer — from MusicBrainz release
 * relations, roles already collapsed per person by lb-bot.
 *
 * A flat list rather than a table: MusicBrainz's role vocabulary is long and
 * uneven, and grouping by role produces a dozen one-line sections on a typical
 * record.
 */
const AlbumCredits = ({ credits }: { credits: LbBotMetaCredit[] }) => (
    <Stack gap="xs">
        <TextTitle fw={700} order={3}>
            Credits
        </TextTitle>
        <Stack gap={2}>
            {credits.map((credit) => (
                <Text key={credit.mbid || credit.name} size="sm">
                    <Text component="span" isMuted size="sm">
                        {`${credit.roles.join(', ')} — `}
                    </Text>
                    {credit.name}
                </Text>
            ))}
        </Stack>
    </Stack>
);

interface AlbumDetailSongsTableProps {
    songs: Song[];
}

interface DiscGroupRowProps {
    discGroup: {
        discNumber: number;
        discSubtitle: null | string;
    };
    groupItems: unknown[];
    internalState: ItemListStateActions;
    t: (key: string, options?: any) => string;
}

const DiscGroupRow = ({ discGroup, groupItems, internalState, t }: DiscGroupRowProps) => {
    const selectionVersion = useItemListStateSubscription(internalState, (state) =>
        state ? state.version : 0,
    );

    const selectedCount = groupItems.filter((item) => {
        if (!item || typeof item !== 'object' || !('id' in item)) return false;
        const rowId = internalState.extractRowId(item);
        return rowId ? internalState.isSelected(rowId) : false;
    }).length;

    const isAllSelected = selectedCount === groupItems.length;

    void selectionVersion;

    const handleCheckboxChange = () => {
        const selectableItems = groupItems.filter(
            (item): item is ItemListStateItemWithRequiredProperties =>
                item !== null && typeof item === 'object',
        );

        if (isAllSelected) {
            // Deselect all items in the group
            const currentlySelected =
                internalState.getSelected() as ItemListStateItemWithRequiredProperties[];
            const groupItemIds = new Set(
                selectableItems.map((item) => internalState.extractRowId(item)).filter(Boolean),
            );
            const itemsToKeep = currentlySelected.filter(
                (item) => !groupItemIds.has(internalState.extractRowId(item) || ''),
            );
            internalState.setSelected(itemsToKeep);
        } else {
            // Select all items in the group (add to existing selection)
            const currentlySelected =
                internalState.getSelected() as ItemListStateItemWithRequiredProperties[];
            const selectedIds = new Set(
                currentlySelected.map((item) => internalState.extractRowId(item)).filter(Boolean),
            );
            const itemsToAdd = selectableItems.filter(
                (item) => !selectedIds.has(internalState.extractRowId(item) || ''),
            );
            internalState.setSelected([...currentlySelected, ...itemsToAdd]);
        }
    };

    return (
        <Group align="center" h="100%" px="md" w="100%">
            <Checkbox
                checked={isAllSelected}
                id={`disc-${discGroup.discNumber}`}
                label={
                    <Text component="label" size="sm" truncate>
                        {t('common.disc')} {discGroup.discNumber}
                        {discGroup.discSubtitle && ` - ${discGroup.discSubtitle}`}
                    </Text>
                }
                onChange={handleCheckboxChange}
                size="xs"
            />
        </Group>
    );
};

function AlbumDetailCarousels({ data }: { data: Album }) {
    const { t } = useTranslation();

    const genreCarousels = useMemo(() => {
        const genreLimit = 2;
        const selectedGenres = data?.genres?.slice(0, genreLimit);

        if (!selectedGenres || selectedGenres.length === 0) return [];

        return selectedGenres
            .map((genre) => {
                const uniqueId = `moreFromGenre-${genre.id}`;
                return {
                    enableRefresh: true,
                    excludeIds: data?.id ? [data.id] : undefined,
                    isHidden: !genre,
                    query: {
                        genreIds: [genre.id],
                    },
                    rowCount: 1,
                    sortBy: AlbumListSort.RANDOM,
                    sortOrder: SortOrder.ASC,
                    title: sentenceCase(
                        t('page.albumDetail.moreFromGeneric', {
                            item: genre.name,
                        }),
                    ),
                    uniqueId,
                };
            })
            .filter((carousel) => !carousel.isHidden);
    }, [data, t]);

    const carousels = useMemo(() => {
        const moreFromArtistUniqueId = 'moreFromArtist';
        return [
            {
                enableRefresh: false,
                excludeIds: data?.id ? [data.id] : undefined,
                isHidden: !data?.albumArtists?.[0]?.id,
                query: {
                    artistIds: data?.albumArtists.length ? [data?.albumArtists[0].id] : undefined,
                },
                rowCount: 1,
                sortBy: AlbumListSort.YEAR,
                sortOrder: SortOrder.DESC,
                title: t('page.albumDetail.moreFromArtist'),
                uniqueId: moreFromArtistUniqueId,
            },
            ...genreCarousels,
        ];
    }, [data.albumArtists, data.id, genreCarousels, t]);

    const cq = useGridCarouselContainerQuery();

    return (
        <Stack gap="lg" mt="3rem" ref={cq.ref}>
            {carousels
                .filter((c) => !c.isHidden)
                .map((carousel) => (
                    <AlbumInfiniteCarousel
                        containerQuery={cq}
                        enableRefresh={carousel.enableRefresh}
                        excludeIds={carousel.excludeIds}
                        key={`carousel-${carousel.uniqueId}`}
                        query={carousel.query}
                        rowCount={carousel.rowCount}
                        sortBy={carousel.sortBy}
                        sortOrder={carousel.sortOrder}
                        title={carousel.title}
                    />
                ))}
            {/* navi-connect: lb-bot's similar albums, last, so its late answer never
                pushes the upstream rows down. Navidrome's `albumArtists` rows carry
                only an id and a name, so there is no artist MBID to send: lb-bot
                resolves it from its own Navidrome artist index before asking
                ListenBrainz, whose similar-artists endpoint is keyed by MBID. */}
            <SimilarAlbumsShelf
                artistName={data?.albumArtistName}
                containerQuery={cq}
                rgid={data?.mbzReleaseGroupId}
            />
        </Stack>
    );
}

const AlbumDetailSongsTable = ({ songs }: AlbumDetailSongsTableProps) => {
    const { t } = useTranslation();
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm] = useDebouncedValue(searchTerm, 300);
    const tableConfig = useSettingsStore((state) => state.lists[ItemListKey.ALBUM_DETAIL]?.table);

    const currentSong = usePlayerSong();

    const [sortBy, setSortBy] = useState<SongListSort>(SongListSort.ID);
    const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.ASC);

    const columns = useMemo(() => {
        return tableConfig?.columns || [];
    }, [tableConfig?.columns]);

    // On an album the id order is the album's own order: the board calls it "Track number".
    const sortFilters = useMemo(
        () =>
            CLIENT_SIDE_SONG_FILTERS.map((filter) =>
                filter.value === SongListSort.ID
                    ? { ...filter, name: t('page.albumDetail.sortTrackNumber') }
                    : filter,
            ),
        [t],
    );
    const sortLabel = sortFilters.find((filter) => filter.value === sortBy)?.name ?? '';
    // The chip flips the order, so its name says what the order is now, not what a press does.
    const sortOrderLabel = t('page.albumDetail.sortOrderChip', {
        value: t(sortOrder === SortOrder.ASC ? 'common.ascending' : 'common.descending'),
    });

    const filteredSongs = useMemo(() => {
        return sortSongList(
            searchLibraryItems(songs, debouncedSearchTerm, LibraryItem.SONG),
            sortBy,
            sortOrder,
        );
    }, [songs, debouncedSearchTerm, sortBy, sortOrder]);

    const { handleColumnReordered } = useItemListColumnReorder({
        itemListKey: ItemListKey.ALBUM_DETAIL,
    });

    const { handleColumnResized } = useItemListColumnResize({
        itemListKey: ItemListKey.ALBUM_DETAIL,
    });

    const discGroups = useMemo(() => {
        if (filteredSongs.length === 0) return [];

        const groups: Array<{
            discNumber: number;
            discSubtitle: null | string;
            itemCount: number;
        }> = [];
        let lastDiscNumber = -1;
        let currentGroupStartIndex = 0;

        filteredSongs.forEach((song, index) => {
            if (song.discNumber !== lastDiscNumber) {
                // If we have a previous group, calculate its item count
                if (groups.length > 0) {
                    groups[groups.length - 1].itemCount = index - currentGroupStartIndex;
                }
                // Start a new group
                groups.push({
                    discNumber: song.discNumber,
                    discSubtitle: song.discSubtitle,
                    itemCount: 0, // Will be calculated when we encounter the next group or end
                });
                currentGroupStartIndex = index;
                lastDiscNumber = song.discNumber;
            }
        });

        // Set item count for the last group
        if (groups.length > 0) {
            groups[groups.length - 1].itemCount = filteredSongs.length - currentGroupStartIndex;
        }

        return groups;
    }, [filteredSongs]);

    const groups = useMemo(() => {
        // Remove groups when filtering
        if (debouncedSearchTerm?.trim()) {
            return undefined;
        }

        // Remove groups when sorting
        if (sortBy !== SongListSort.ID) {
            return undefined;
        }

        if (discGroups.length <= 1) {
            return undefined;
        }

        return discGroups.map((discGroup) => ({
            itemCount: discGroup.itemCount,
            render: ({
                data,
                internalState,
                startDataIndex,
            }: {
                data: unknown[];
                groupIndex: number;
                index: number;
                internalState: ItemListStateActions;
                startDataIndex: number;
            }) => {
                const groupItems = data.slice(startDataIndex, startDataIndex + discGroup.itemCount);

                return (
                    <DiscGroupRow
                        discGroup={discGroup}
                        groupItems={groupItems}
                        internalState={internalState}
                        t={t}
                    />
                );
            },
            rowHeight: 40,
        }));
    }, [debouncedSearchTerm, sortBy, discGroups, t]);

    const player = usePlayer();

    const overrideControls: Partial<ItemControls> = useMemo(() => {
        return {
            onDoubleClick: ({ index, internalState, item, meta }) => {
                if (!item) {
                    return;
                }

                playSongFromItemListControl({
                    index,
                    internalState,
                    item: item as Song,
                    meta,
                    player,
                });
            },
        };
    }, [player]);

    const binding = useSettingsStore((state) => state.hotkeys.bindings.localSearch);

    const searchInputRef = useRef<HTMLInputElement>(null);

    useHotkeys([
        [
            binding.hotkey,
            () => {
                searchInputRef.current?.focus();
            },
        ],
    ]);

    if (!tableConfig || columns.length === 0) {
        return null;
    }

    const currentSongId = currentSong?.id;

    return (
        <>
            {/* The board's toolbar: the search field, the sort as one chip with its order
                beside it, a spacer, the table settings. */}
            <div className={styles.toolbar}>
                <TextInput
                    aria-label={t('page.albumDetail.searchTracks')}
                    classNames={{ input: styles.searchInput, root: styles.search }}
                    leftSection={<Icon icon="search" />}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('page.albumDetail.searchTracks')}
                    ref={searchInputRef}
                    rightSection={
                        searchTerm ? (
                            <ActionIcon
                                aria-label={t('common.clear')}
                                icon="x"
                                onClick={() => setSearchTerm('')}
                                size="sm"
                                variant="transparent"
                            />
                        ) : null
                    }
                    value={searchTerm}
                />
                <ListSortByDropdownControlled
                    filters={sortFilters}
                    itemType={LibraryItem.SONG}
                    setSortBy={(value) => setSortBy(value as SongListSort)}
                    sortBy={sortBy}
                    target={
                        <button className={styles.chip} data-sort-select={sortBy} type="button">
                            <Icon icon="sort" size="sm" />
                            {t('page.albumDetail.sortChip', { value: sortLabel })}
                            <Icon icon="arrowDownS" size="sm" />
                        </button>
                    }
                />
                <button
                    aria-label={sortOrderLabel}
                    className={clsx(styles.chip, styles.iconChip)}
                    data-sort-order={sortOrder}
                    onClick={() =>
                        setSortOrder(sortOrder === SortOrder.ASC ? SortOrder.DESC : SortOrder.ASC)
                    }
                    title={sortOrderLabel}
                    type="button"
                >
                    <Icon icon={sortOrder === SortOrder.ASC ? 'sortAsc' : 'sortDesc'} size="sm" />
                </button>
                <span className={styles.spacer} />
                <ListConfigMenu
                    buttonProps={{
                        'aria-label': t('page.albumDetail.tableSettings'),
                        className: styles.settings,
                        icon: 'mediaSettings',
                        tooltip: { label: t('page.albumDetail.tableSettings') },
                    }}
                    displayTypes={[
                        { hidden: true, value: ListDisplayType.GRID },
                        ...SONG_DISPLAY_TYPES,
                    ]}
                    listKey={ItemListKey.ALBUM_DETAIL}
                    optionsConfig={{
                        table: {
                            itemsPerPage: { hidden: true },
                            pagination: { hidden: true },
                        },
                    }}
                    tableColumnsData={SONG_TABLE_COLUMNS}
                />
            </div>
            <ItemTableList
                activeRowId={currentSongId}
                autoFitColumns={tableConfig.autoFitColumns}
                CellComponent={ItemTableListColumn}
                columns={columns}
                data={filteredSongs}
                enableAlternateRowColors={tableConfig.enableAlternateRowColors}
                enableDrag
                enableDragScroll={false}
                enableExpansion={false}
                enableHeader={tableConfig.enableHeader}
                enableHorizontalBorders={tableConfig.enableHorizontalBorders}
                enableRowHoverHighlight={tableConfig.enableRowHoverHighlight}
                enableSelection
                enableSelectionDialog={false}
                enableStickyGroupRows
                enableStickyHeader
                enableVerticalBorders={tableConfig.enableVerticalBorders}
                groups={groups}
                itemType={LibraryItem.SONG}
                onColumnReordered={handleColumnReordered}
                onColumnResized={handleColumnResized}
                overrideControls={overrideControls}
                size={tableConfig.size}
            />
        </>
    );
};
