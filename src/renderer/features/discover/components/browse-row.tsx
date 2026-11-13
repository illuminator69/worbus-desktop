import { useCallback, useMemo } from 'react';
import { generatePath, useNavigate } from 'react-router';

import { useDiscoverGenre, useSetDiscoverGenre } from '../discover-genre.store';
import { DiscoverRow } from './discover-row';
import styles from './discover-row.module.css';
import { DiscoverTile } from './discover-tile';

import { AcquireButton } from '/@/renderer/features/lbbot/components/acquire-button';
import {
    useLbBotDeezerChart,
    useLbBotDeezerEditorial,
    useLbBotDeezerGenres,
    useOpenLbBotArtist,
    useResolveBrowseAlbum,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    artistLinkPath,
    externalAlbumPathFor,
} from '/@/renderer/features/lbbot/utils/external-paths';
import { useLibraryContextMenu } from '/@/renderer/features/shared/hooks/use-library-context-menu';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem } from '/@/shared/types/domain-types';
import { LbBotBrowseAlbum } from '/@/shared/types/lbbot-types';

/**
 * The two Deezer browse rows — "Charts" and "Editorial".
 *
 * One component, because they differ only in which feed they read and what
 * their reason line says. The rows themselves are identical in shape, and
 * writing them twice is how the two would come to disagree about, say, whether
 * an unresolved row is tappable.
 *
 * **These rows are honest about being a chart.** Every other Discover row names
 * something about *you* — an artist you listen to, a record you own, a mood you
 * asked for. These name popularity and an editor's taste, which is a weaker
 * claim, so they say so plainly rather than borrowing the grammar of a
 * recommendation. That is the whole reason `because` is a required prop.
 *
 * Deezer has no MusicBrainz ids, so lb-bot marks these feeds against its
 * **local** index by name and marks conservatively: a row it cannot place
 * carries no `rgid` at all. For a global chart that is most rows, because the
 * index only knows artists somebody has scanned — so treating them as inert
 * would make this row mostly decorative.
 *
 * Instead the id is fetched on **tap**: one MusicBrainz search for the one album
 * the user chose, rather than a per-row fan-out that would spend lb-bot's entire
 * 1 req/sec scanner budget on a shelf nobody touched. That split is lb-bot's own
 * design for these feeds. The acquire control is still withheld from an
 * unmarked row — one tap cannot be honest about a record whose identity is not
 * yet known, and the album page it opens is where the fetch belongs.
 */

interface BrowseRowProps {
    feed: 'chart' | 'editorial';
    /**
     * Draw the genre chips on this row.
     *
     * Exactly one of the two browse rows does, and which one is decided by the
     * screen rather than here: both read the same genre, so two chip rows would
     * be two controls for one value. The screen is the only place that knows
     * which of the pair is actually visible — either can be hidden on its own
     * capability.
     */
    showGenres?: boolean;
    title: string;
}

const BECAUSE: Record<BrowseRowProps['feed'], string> = {
    chart: 'What is charting on Deezer right now — popularity, not a recommendation',
    editorial: "Deezer's own editorial picks, marked against what your library already holds",
};

export const BrowseRow = ({ feed, showGenres, title }: BrowseRowProps) => {
    const navigate = useNavigate();
    const openMenu = useLibraryContextMenu();
    // B-407: an artist lb-bot did not match is looked up in the library by name (B-313's rule).
    const { open: openArtist } = useOpenLbBotArtist();
    const { pending, resolve } = useResolveBrowseAlbum();
    const genre = useDiscoverGenre();
    const setGenre = useSetDiscoverGenre();
    // Hidden entirely unless the hub advertises the route, which is what makes
    // the whole picker additive: an older hub drops `genre` silently and both
    // rows answer the global chart, which is exactly what they did before.
    const genres = useLbBotDeezerGenres().data?.genres ?? [];
    // Both hooks are called because hooks cannot be conditional, and picking
    // afterwards costs nothing: each is independently gated on its own
    // `/lb/status.routes` entry, so the unused one is `enabled: false` and never
    // reaches the network. The two rows mounted together therefore issue exactly
    // two requests between them, not four — react-query dedupes the pair each
    // row creates.
    const chart = useLbBotDeezerChart(20, genre);
    const editorial = useLbBotDeezerEditorial(20, genre);
    const { data, isLoading, isPlaceholderData } = feed === 'chart' ? chart : editorial;
    // A genre switch in flight: `keepPreviousData` holds the previous genre's
    // answer, which leaves `isLoading` false. Those tiles are not this genre's,
    // so they are shown dimmed and inert, and nothing may call the genre empty.
    const switching = isPlaceholderData;

    /**
     * Where a tile goes. Every branch of that decision lives in
     * `useResolveBrowseAlbum`, including the two cheap ones — it checks the
     * library before the network, and validates a MusicBrainz answer against
     * what was asked instead of taking its first hit.
     *
     * That split matters: the destination used to be chosen here, half from
     * lb-bot's badge and half from a lookup's ranking, and the two halves
     * disagreed. A tile for an album owned in full opened a parody's download
     * page captioned "Not in your library", which was two defects wearing one
     * symptom.
     */
    const openAlbum = useCallback(
        async (album: LbBotBrowseAlbum) => {
            const target = await resolve(album);
            if (!target) {
                // Declining is a correct outcome, not a failure to handle.
                // Opening the wrong album reads as the feature being broken;
                // this reads as the near miss it is.
                toast.show({
                    message: `Couldn't match "${album.title}" by ${album.artist} to a release.`,
                });
                return;
            }
            navigate(
                target.kind === 'library'
                    ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: target.albumId })
                    : externalAlbumPathFor({
                          artist: target.artist,
                          rgid: target.rgid,
                          title: target.title,
                          year: target.year,
                      }),
            );
        },
        [navigate, resolve],
    );

    /**
     * The genre chips. Genre is the only axis that exists: Deezer's open API has
     * no country parameter, so the chart is geolocated by lb-bot's own egress
     * address and no client can ask for another country. A country picker would
     * be a control that silently did nothing, so there is not one.
     */
    const genreChips = showGenres && genres.length > 0 && (
        <Group gap="xs" mt="xs" wrap="wrap">
            {genres.map((row) => (
                // The fork's chip: filled when chosen, subtle otherwise, the button's own
                // radius, as on Downloads, Library Matches and My Listening. Compact here,
                // where two dozen sit in a row's header.
                <Button
                    key={row.id}
                    onClick={() => setGenre(row.id)}
                    size="compact-sm"
                    variant={row.id === genre ? 'filled' : 'subtle'}
                >
                    {row.name}
                </Button>
            ))}
        </Group>
    );

    const cards = useMemo(() => {
        const albums = (data?.albums ?? []).map((album) => ({
            content: (
                <DiscoverTile
                    action={
                        // No rgid means lb-bot could not resolve the name to a
                        // release-group, so there is nothing to fetch by.
                        album.releaseOwned || !album.rgid ? undefined : (
                            <AcquireButton
                                artist={album.artist}
                                className={styles.action}
                                onReview={() =>
                                    navigate(
                                        externalAlbumPathFor({
                                            artist: album.artist,
                                            rgid: album.rgid,
                                            title: album.title,
                                        }),
                                    )
                                }
                                rgid={album.rgid}
                                title={album.title}
                            />
                        )
                    }
                    imageUrl={album.coverUrl}
                    // The row the search is running for, so the tile it was
                    // started from is the one that looks busy.
                    isBusy={switching || pending === `${album.artist}-${album.title}`}
                    isUnowned={!album.releaseOwned}
                    itemType={LibraryItem.ALBUM}
                    onClick={() => void openAlbum(album)}
                    onContextMenu={(event) =>
                        void openMenu(
                            event,
                            album.releaseAlbumId
                                ? { id: album.releaseAlbumId, kind: 'album' }
                                : null,
                        )
                    }
                    subtitle={album.artist}
                    title={album.title}
                />
            ),
            id: `album-${album.rgid || `${album.artist}-${album.title}`}`,
        }));

        // Artists after albums rather than in a row of their own: two rows for
        // one feed would double a screen that is already eight rows long, and
        // the artists Deezer returns for a chart are a restatement of the albums
        // above them often enough that a separate heading would over-promise.
        const artists = (data?.artists ?? [])
            .filter((artist) => artistLinkPath(artist.artistId, artist.mbid))
            .map((artist) => {
                return {
                    content: (
                        <DiscoverTile
                            imageId={artist.owned ? artist.artistId : null}
                            // Deezer's picture for an artist the library does
                            // not have: there is no Navidrome id to draw one
                            // from, and a chart of unnamed silhouettes is not a
                            // chart anybody reads.
                            imageUrl={artist.owned ? null : artist.imageUrl}
                            isBusy={switching}
                            isRound
                            isUnowned={!artist.owned}
                            itemType={LibraryItem.ALBUM_ARTIST}
                            onClick={() =>
                                openArtist({
                                    artistId: artist.artistId,
                                    mbid: artist.mbid,
                                    name: artist.name,
                                })
                            }
                            onContextMenu={(event) =>
                                void openMenu(
                                    event,
                                    artist.owned && artist.artistId
                                        ? { id: artist.artistId, kind: 'artist' }
                                        : null,
                                )
                            }
                            subtitle={artist.owned ? 'In your library' : 'Not in your library'}
                            title={artist.name}
                        />
                    ),
                    id: `artist-${artist.mbid || artist.name}`,
                };
            });

        return [...albums, ...artists];
    }, [data, navigate, openAlbum, openArtist, openMenu, pending, switching]);

    // A genre the feed answered nothing for. The row would normally render
    // nothing at all, but the chips are the only way back to one that works —
    // hiding them would strand the user on a dead genre with no control on
    // screen to change it. So this is a row with something to say, not an empty
    // shelf: the chips stay, the carousel does not.
    // Not while the genre's first answer is still on its way: that is the
    // skeleton row below, chips included, not a genre known to be empty.
    if (cards.length === 0 && genreChips && !isLoading && !switching) {
        return (
            <DiscoverRow because={BECAUSE[feed]} isEmpty={false} title={title}>
                {/* One child: the chip-style slot is a wrapping flex row, so two
                    siblings would lay the sentence out beside the chips. */}
                <Stack gap="xs">
                    {genreChips}
                    <Text isMuted size="sm">
                        Deezer has nothing here for this genre.
                    </Text>
                </Stack>
            </DiscoverRow>
        );
    }

    return (
        <DiscoverRow
            aside={genreChips || undefined}
            because={BECAUSE[feed]}
            cards={cards}
            isEmpty={cards.length === 0}
            // A genre switch keeps the previous genre's tiles on screen, dimmed;
            // counted as loading too for the case with none to keep.
            isLoading={isLoading || switching}
            title={title}
        />
    );
};
