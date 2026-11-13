import { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import styles from './artist-columns.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { ReleasePill } from '/@/renderer/features/discography/components/release-pill';
import {
    useLbBotSimilarArtists,
    useOpenLbBotArtist,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { artistLinkPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { tintHues } from '/@/shared/components/animations/tint-hues';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * Similar artists from lb-bot (Call 12), as the side column's rows (board ArtistUnowned): a round
 * cover, the name, Owned or Not owned. Absent when lb-bot has no answer or the hub lacks the route.
 */
export const SimilarArtistList = ({ mbid, name }: { mbid: string; name: string }) => {
    const { t } = useTranslation();
    const { data } = useLbBotSimilarArtists({ limit: 8, mbid, name });
    // B-407: an artist lb-bot did not match is looked up in the library by name (B-313's rule).
    const artistLink = useOpenLbBotArtist();
    const rows = (data?.artists ?? []).filter((artist) =>
        artistLinkPath(artist.artistId, artist.mbid),
    );
    if (rows.length === 0) return null;
    return (
        <section data-similar-artists="">
            <h2 className={styles.sideLabel}>{t('naviConnect.artistPage.similar')}</h2>
            {rows.map((artist) => {
                const [a, b] = tintHues(artist.mbid || artist.name);
                const row = {
                    artistId: artist.artistId,
                    mbid: artist.mbid,
                    name: artist.name,
                    owned: artist.owned,
                };
                return (
                    <Link
                        className={styles.artistRow}
                        key={artist.mbid || artist.name}
                        onClick={
                            artistLink.looksUp(row)
                                ? (event) => {
                                      event.preventDefault();
                                      artistLink.open(row);
                                  }
                                : undefined
                        }
                        to={artistLinkPath(artist.artistId, artist.mbid, artist.name)!}
                    >
                        {artist.owned && artist.artistId ? (
                            <ItemImage
                                containerClassName={styles.artistCover}
                                id={artist.artistId}
                                itemType={LibraryItem.ALBUM_ARTIST}
                                type="table"
                            />
                        ) : (
                            <span
                                aria-hidden="true"
                                className={`${styles.artistCover} ${styles.artistTint}`}
                                style={{ '--tint-a': a, '--tint-b': b } as CSSProperties}
                            />
                        )}
                        <span className={styles.artistName}>{artist.name}</span>
                        <ReleasePill tone={artist.owned ? 'owned' : 'missing'}>
                            {t(
                                artist.owned
                                    ? 'naviConnect.artistPage.owned'
                                    : 'naviConnect.artistPage.notOwned',
                            )}
                        </ReleasePill>
                    </Link>
                );
            })}
        </section>
    );
};
