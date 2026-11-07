import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate } from 'react-router';

import styles from './missing-album-tile.module.css';

import { ReleasePill } from '/@/renderer/features/discography/components/release-pill';
import { type Ownership } from '/@/renderer/features/discography/discography-model';
import discoverStyles from '/@/renderer/features/discover/components/discover-row.module.css';
import { DiscoverTile } from '/@/renderer/features/discover/components/discover-tile';
import { AcquireButton } from '/@/renderer/features/lbbot/components/acquire-button';
import { SHORT_STATE } from '/@/renderer/features/lbbot/fill-vocabulary';
import { caaCoverUrl, useWatchedFill } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { externalAlbumPathFor } from '/@/renderer/features/lbbot/utils/external-paths';
import { AppRoute } from '/@/renderer/router/routes';
import { Progress } from '/@/shared/components/progress/progress';
import { LibraryItem } from '/@/shared/types/domain-types';
import { LbBotFillState } from '/@/shared/types/lbbot-types';

interface MissingAlbumTileProps {
    /** A Navidrome album lb-bot's row names that the page's list has not caught up with. */
    albumId: null | string;
    /** The artist's MusicBrainz id, a hint for the album page (it re-reads the real values). */
    artistMbid?: null | string;
    artistName: string;
    ndArtistId: string;
    ownership: Ownership;
    rgid: string;
    title: string;
    year: null | number;
}

/**
 * One release lb-bot knows about that the library doesn't hold (or has only just received), drawn
 * inside the section of its kind beside the owned albums, with its state on a pill at the cover's
 * top-left: Missing, Added, syncing, or the running fill's own word (the same words as the downloads
 * view, PROTOCOL 15.2). The faded, dashed cover still says the library does not have it.
 */
export const MissingAlbumTile = ({
    albumId,
    artistMbid,
    artistName,
    ndArtistId,
    ownership,
    rgid,
    title,
    year,
}: MissingAlbumTileProps) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    // From the ledger, which the app-root watcher keeps live: a fill that failed while this page was
    // closed still shows, and a settled one keeps its word until dismissed.
    const fill = useWatchedFill(rgid, ndArtistId);
    const fillState = fill ? ((fill.state || 'searching') as LbBotFillState) : null;
    const fillWord = fillState ? SHORT_STATE[fillState] : undefined;
    const percent = fill?.percent ?? 0;
    // B-169: the album's own page (About first, Find sources), with the hints this tile has.
    const albumPage = externalAlbumPathFor({
        artist: artistName,
        artistId: ndArtistId.startsWith('mb:') ? undefined : ndArtistId,
        artistMbid: artistMbid || (ndArtistId.startsWith('mb:') ? ndArtistId.slice(3) : undefined),
        rgid,
        title,
        year: year ? String(year) : undefined,
    });

    const pill = fillWord ? (
        <ReleasePill tone={fillState === 'failed' ? 'failed' : 'active'}>{fillWord}</ReleasePill>
    ) : (
        <ReleasePill tone={ownership}>{t(`naviConnect.discography.pill.${ownership}`)}</ReleasePill>
    );

    return (
        <DiscoverTile
            // Only on a row that is genuinely absent: an owned row opens the album, and a fill in
            // flight has its own progress on the cover.
            action={
                !albumId && ownership === 'missing' && (!fill || fill.settled) ? (
                    <AcquireButton
                        artist={artistName}
                        className={discoverStyles.action}
                        onReview={() => navigate(albumPage)}
                        rgid={rgid}
                        title={title}
                    />
                ) : undefined
            }
            badge={
                <>
                    {pill}
                    {fill && !fill.settled && percent > 0 && percent < 100 && (
                        <Progress className={styles.progress} size="xs" value={percent} />
                    )}
                </>
            }
            badgePlacement="top-start"
            imageUrl={caaCoverUrl(rgid)}
            isUnowned={!albumId}
            itemType={LibraryItem.ALBUM}
            onClick={() =>
                albumId
                    ? navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId }))
                    : navigate(albumPage)
            }
            subtitle={year ? String(year) : undefined}
            title={title}
        />
    );
};
