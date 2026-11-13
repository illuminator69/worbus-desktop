import { useMemo } from 'react';

import { useDiscoverSeedArtist } from '../use-discover-seed';
import { DiscoverRow } from './discover-row';
import { DiscoverTile } from './discover-tile';

import {
    useLbBotRelatedArtists,
    useLbBotSimilarArtists,
    useOpenLbBotArtist,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { artistLinkPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { useLibraryContextMenu } from '/@/renderer/features/shared/hooks/use-library-context-menu';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * "Fans also like" — and unlike every similar-artist surface this stack already
 * has, the artists you do *not* own are the point.
 *
 * Navidrome's own similar artists are library residents by construction, and
 * lb-bot's similar-albums shelf filters unowned candidates out on purpose
 * ("more of what you already have"). The merge behind both has always produced
 * unowned artists with real MusicBrainz ids and nothing has ever been able to
 * see them. `/lb/artist/similar` marks ownership instead of filtering, so this
 * row is the first surface in the app that can answer "who am I missing".
 *
 * Unowned rows route to the virtual `mb:<mbid>` artist page, which renders their
 * discography from lb-bot and is where a fill is started. Owned ones go to the
 * real page. `artistLinkPath` already encodes that choice and is shared with the
 * Fresh tile so the two cannot drift.
 *
 * An owned artist is drawn from Navidrome by id, so this row shows the same
 * photographs the artist carousels do. An unowned one has no id anywhere and
 * falls back to the empty-artist icon: an absent picture is an absence, not a
 * reason to drop to a text-only tile.
 */
export const SimilarArtistsRow = ({ title }: { title: string }) => {
    const openMenu = useLibraryContextMenu();
    // B-407: an artist lb-bot did not match is looked up in the library by name (B-313's rule).
    const { isPending: pendingArtist, open: openArtist } = useOpenLbBotArtist();
    const { pending: seedPending, seed } = useDiscoverSeedArtist();
    const { data, isLoading } = useLbBotSimilarArtists({
        mbid: seed?.mbid,
        name: seed?.name,
    });
    // Deezer, as a THIRD similarity source beside ListenBrainz and Last.fm. It
    // is appended rather than merged into the ranking: the two routes compute
    // different things and their scores are not comparable, so interleaving
    // them would be arithmetic on two different scales. lb-bot already marks
    // ownership identically on both, which is what lets one renderer take both.
    const related = useLbBotRelatedArtists({
        mbid: seed?.mbid,
        name: seed?.name,
    });

    // Someone with neither an id nor an MBID has nowhere to go, so they are not
    // a row — they are a name with no page behind it.
    const artists = useMemo(() => {
        const rows = (data?.artists ?? []).filter((a) => artistLinkPath(a.artistId, a.mbid));
        // Dedupe by MBID where there is one and by lower-cased name otherwise.
        // The two sources agree about popular artists often enough that without
        // this the tail of the row is a repeat of its head.
        const seen = new Set(rows.map((a) => a.mbid || a.name.toLowerCase()));
        for (const artist of related.data?.artists ?? []) {
            const key = artist.mbid || artist.name.toLowerCase();
            if (seen.has(key) || !artistLinkPath(artist.artistId, artist.mbid)) continue;
            seen.add(key);
            rows.push(artist);
        }
        return rows.slice(0, 20);
    }, [data, related.data]);

    const cards = useMemo(
        () =>
            artists.map((artist) => {
                return {
                    content: (
                        <DiscoverTile
                            imageId={artist.owned ? artist.artistId : null}
                            isBusy={pendingArtist(artist)}
                            isRound
                            isUnowned={!artist.owned}
                            itemType={LibraryItem.ALBUM_ARTIST}
                            onClick={() =>
                                openArtist({
                                    artistId: artist.artistId,
                                    mbid: artist.mbid,
                                    name: artist.name,
                                    owned: artist.owned,
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
                    id: artist.mbid || artist.name,
                };
            }),
        [artists, openArtist, openMenu, pendingArtist],
    );

    return (
        <DiscoverRow
            because={
                data?.because
                    ? `Because you listen to ${data.because}`
                    : 'Artists close to what you already play'
            }
            cards={cards}
            isEmpty={cards.length === 0}
            // Waiting on the seed (a local library read) or on the similar-artists
            // answer. Deezer's related list is appended afterwards and is never
            // waited for: it only lengthens a row that already has cards.
            isLoading={seedPending || isLoading}
            title={title}
        />
    );
};
