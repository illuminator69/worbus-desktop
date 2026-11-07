import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './discography.module.css';

import { DataRow, MemoizedItemCard } from '/@/renderer/components/item-card/item-card';
import { ItemControls } from '/@/renderer/components/item-list/types';
import { ReleasePill } from '/@/renderer/features/discography/components/release-pill';
import { type DiscographyItem } from '/@/renderer/features/discography/discography-model';
import { MissingAlbumTile } from '/@/renderer/features/lbbot/components/missing-album-tile';
import { gapIsBusy, gapProgress, useWatchedGap } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ArrivalProps } from '/@/renderer/features/motion/use-arrival';
import { Album, LibraryItem } from '/@/shared/types/domain-types';

/** "9 of 12", from the live gap when it is being filled. Carries the gap watch, as the badge did. */
const PartlyPill = ({
    gap,
    ndArtistId,
}: {
    gap: NonNullable<DiscographyItem['gap']>;
    ndArtistId: string;
}) => {
    const { t } = useTranslation();
    const live = useWatchedGap(gap.groupId, ndArtistId);
    const progress = gapProgress(live);
    const filling = !!live && gapIsBusy(live) && progress.wanted > 0;
    const present = live?.present ?? gap.present;
    const total = live?.total ?? gap.total;
    return filling ? (
        <ReleasePill onCover tone="active">
            {t('naviConnect.discography.pill.filling', {
                done: progress.done,
                wanted: progress.wanted,
            })}
        </ReleasePill>
    ) : (
        <ReleasePill onCover tone="partly">
            {t('naviConnect.discography.pill.partly', { present, total })}
        </ReleasePill>
    );
};

interface ReleaseTileProps {
    /** Navidrome's album, when the page lists it: the library's own card. */
    album: Album | undefined;
    arrival: ArrivalProps | undefined;
    artistMbid?: null | string;
    artistName: string;
    controls: ItemControls;
    item: DiscographyItem;
    /** lb-bot knows the artist: owned albums carry the Owned pill. */
    known: boolean;
    ndArtistId: string;
    rows: DataRow[] | undefined;
}

/**
 * One release in a section. An album the library lists is the library's own card (context menu,
 * drag, play on hover) with its ownership pill; anything else is the missing-album card.
 */
export const ReleaseTile = memo(function ReleaseTile({
    album,
    arrival,
    artistMbid,
    artistName,
    controls,
    item,
    known,
    ndArtistId,
    rows,
}: ReleaseTileProps) {
    const { t } = useTranslation();
    return (
        <div
            className={[styles.tile, arrival?.className].filter(Boolean).join(' ')}
            data-arrive={arrival?.['data-arrive']}
            data-ownership={item.ownership}
            data-release={item.key}
            style={arrival?.style}
        >
            {album ? (
                <>
                    {item.gap ? (
                        <PartlyPill gap={item.gap} ndArtistId={ndArtistId} />
                    ) : (
                        known && (
                            <ReleasePill onCover tone="owned">
                                {t('naviConnect.discography.pill.owned')}
                            </ReleasePill>
                        )
                    )}
                    <MemoizedItemCard
                        controls={controls}
                        data={album}
                        enableDrag
                        enableExpansion
                        itemType={LibraryItem.ALBUM}
                        rows={rows}
                        type="poster"
                        withControls
                    />
                </>
            ) : (
                <MissingAlbumTile
                    albumId={item.albumId}
                    artistMbid={artistMbid}
                    artistName={artistName}
                    ndArtistId={ndArtistId}
                    ownership={item.ownership}
                    rgid={item.rgid}
                    title={item.title}
                    year={item.year}
                />
            )}
        </div>
    );
});
