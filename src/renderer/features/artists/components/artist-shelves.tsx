import { CSSProperties, type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link, useLocation } from 'react-router';

import styles from './artist-shelves.module.css';

import { DataRow } from '/@/renderer/components/item-card/item-card';
import { useDefaultItemListControls } from '/@/renderer/components/item-list/helpers/item-list-controls';
import { useGridRows } from '/@/renderer/components/item-list/helpers/use-grid-rows';
import { ItemControls } from '/@/renderer/components/item-list/types';
import { SidewaysRow } from '/@/renderer/components/sideways-row/sideways-row';
import { useArtistChipStore } from '/@/renderer/features/discography/artist-chip.store';
import {
    chipRow,
    type DiscographyChip,
    discographyChips,
    discographyLine,
    lbBotCanScan,
    kindLines,
} from '/@/renderer/features/discography/artist-shelves';
import {
    getItemsPerRow,
    TILE_BREAKPOINTS,
} from '/@/renderer/features/discography/components/discography';
import { ReleaseTile } from '/@/renderer/features/discography/components/release-tile';
import {
    type DiscographyItem,
    kindSettings,
} from '/@/renderer/features/discography/discography-model';
import { DEFAULT_VIEW, writeView } from '/@/renderer/features/discography/discography-view';
import { useArtistScan } from '/@/renderer/features/discography/hooks/use-artist-scan';
import { useDiscographyItems } from '/@/renderer/features/discography/hooks/use-discography-items';
import { type ReleaseKind } from '/@/renderer/features/discography/release-kind';
import { type ArrivalProps, useArrival } from '/@/renderer/features/motion/use-arrival';
import { useContainerQuery } from '/@/renderer/hooks';
import { AppRoute } from '/@/renderer/router/routes';
import { useArtistReleaseTypeItems } from '/@/renderer/store/settings.store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Album, LibraryItem } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

interface ArtistShelvesProps {
    artistMbid?: null | string;
    artistName: string;
    ndId: string;
    owned: Album[];
}

// The artist page binds Enter to "play the selection" app-wide; a chip keeps its own keys.
const keepKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};

/**
 * The owned artist page's releases (R10, B-219), as Spotify lays them out: one Discography header
 * with "Show all", a row of chips (Popular releases, then one per release kind the artist has in
 * Settings' order, kinds switched off left out, singles and EPs together) and ONE row of tiles that
 * the chip switches; then Appears on as its own row. The chip is kept per history entry. The page
 * mounts one row of tiles per row on screen (R2), never the whole discography.
 */
export const ArtistShelves = ({ artistMbid, artistName, ndId, owned }: ArtistShelvesProps) => {
    const { t } = useTranslation();
    const { albumsById, discography, items, known } = useDiscographyItems({
        artistMbid,
        ndId,
        owned,
    });
    const scan = useArtistScan({ artistMbid, artistName, discography, ndId });
    const releaseTypeItems = useArtistReleaseTypeItems();
    const rows = useGridRows(LibraryItem.ALBUM, ItemListKey.ALBUM);
    const controls = useDefaultItemListControls();
    const cq = useContainerQuery(TILE_BREAKPOINTS);
    const itemsPerRow = getItemsPerRow(cq);

    const entry = useLocation().key;
    const storedChip = useArtistChipStore((state) => state.chips[entry]);
    const storeChip = useArtistChipStore((state) => state.setChip);
    const [chosen, setChosen] = useState<string | undefined>(storedChip);
    // Written in an effect, and again under a new entry key (a replace keeps the page mounted).
    useEffect(() => {
        if (chosen) storeChip(entry, chosen);
    }, [chosen, entry, storeChip]);

    const { appearsOn, chips } = useMemo(() => {
        const { disabled, order } = kindSettings(releaseTypeItems);
        return {
            appearsOn: kindLines(items, ['appears-on'], disabled, itemsPerRow)[0],
            chips: discographyChips(items, order, disabled),
        };
    }, [items, itemsPerRow, releaseTypeItems]);
    // A chip the artist no longer has (a rescan, a Settings change) falls back to the first.
    const selected = chips.find((chip) => chip.kind === chosen) ?? chips[0];
    const line = discographyLine(chips, lbBotCanScan(discography.data));
    const row = useMemo(
        () => (selected ? chipRow(items, selected, itemsPerRow) : []),
        [items, itemsPerRow, selected],
    );
    // The row arrives once per history entry (R4); Appears on appears with the page.
    const { propsFor } = useArrival(cq.isCalculated && row.length > 0);

    const discographyPath = generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL_DISCOGRAPHY, {
        albumArtistId: ndId,
    });
    const kindPath = (kind: ReleaseKind) =>
        `${discographyPath}?${writeView({ ...DEFAULT_VIEW, type: kind }, new URLSearchParams())}`;
    // "Show all" opens the discography at the chip's kind; the discography filters one kind at a
    // time, so Popular releases, and Singles and EPs holding both, open it unfiltered.
    const showAllPath =
        selected && selected.kind !== 'popular' && selected.kinds.length === 1
            ? kindPath(selected.kinds[0])
            : discographyPath;
    // lb-bot's first scan: the row shows what the library has, and the link to the discography
    // (where the scan's bar and line are) says one is running.
    const scanning = scan.phase === 'running' && !known;

    const chipLabel = (chip: DiscographyChip) =>
        chip.kind === 'popular'
            ? t('page.albumArtistDetail.popularReleases')
            : chip.kind === 'singles-and-eps'
              ? t('page.albumArtistDetail.singlesAndEps')
              : t(`naviConnect.discography.kind.${chip.kind}`);

    const tileProps = { albumsById, artistMbid, artistName, controls, known, ndId, rows };

    return (
        <div className={styles.root} data-artist-shelves="" ref={cq.ref}>
            {cq.isCalculated && (
                <>
                    {line !== 'none' && (
                        <section className={styles.line} data-line="discography">
                            <div className={styles.head}>
                                <h2 className={styles.title}>
                                    {t('page.albumArtistDetail.discographyKicker')}
                                </h2>
                                <Link
                                    aria-busy={scanning || undefined}
                                    className={styles.link}
                                    data-scanning={scanning ? 'true' : undefined}
                                    title={scanning ? scan.line : undefined}
                                    to={showAllPath}
                                >
                                    {scanning && <Spinner size={12} />}
                                    {t('page.albumArtistDetail.showAll')}
                                </Link>
                            </div>
                            {line === 'chips' && selected ? (
                                <>
                                    <SidewaysRow
                                        aria-label={t('page.albumArtistDetail.discographyKicker')}
                                        className={styles.chips}
                                        frameProps={{ className: styles.chipsFrame }}
                                        role="group"
                                        wheel="page"
                                    >
                                        {chips.map((chip) => (
                                            <button
                                                aria-pressed={chip.kind === selected.kind}
                                                className={styles.chip}
                                                data-chip={chip.kind}
                                                key={chip.kind}
                                                onClick={() => setChosen(chip.kind)}
                                                onKeyDown={keepKeys}
                                                type="button"
                                            >
                                                {chipLabel(chip)}
                                            </button>
                                        ))}
                                    </SidewaysRow>
                                    <Row itemsPerRow={itemsPerRow}>
                                        {row.map((item, index) => (
                                            <Slot
                                                {...tileProps}
                                                arrivalFor={propsFor}
                                                index={index}
                                                item={item}
                                                key={item.key}
                                            />
                                        ))}
                                    </Row>
                                </>
                            ) : (
                                <p className={styles.empty}>
                                    {t('page.albumArtistDetail.discographyEmpty')}
                                </p>
                            )}
                        </section>
                    )}
                    {appearsOn && (
                        <section className={styles.line} data-line="appears-on">
                            <div className={styles.head}>
                                <h2 className={styles.title}>
                                    {t('page.albumArtistDetail.appearsOn')}
                                </h2>
                                {appearsOn.more && (
                                    <Link className={styles.link} to={kindPath('appears-on')}>
                                        {t('page.albumArtistDetail.showAll')}
                                    </Link>
                                )}
                            </div>
                            <Row itemsPerRow={itemsPerRow}>
                                {appearsOn.items.map((item) => (
                                    <Tile {...tileProps} item={item} key={item.key} />
                                ))}
                            </Row>
                        </section>
                    )}
                </>
            )}
        </div>
    );
};

/** The board's `.dg`, one row: a line never holds more tiles than fit across. */
const Row = ({ children, itemsPerRow }: { children: React.ReactNode; itemsPerRow: number }) => (
    <div className={styles.row} style={{ '--items-per-row': itemsPerRow } as CSSProperties}>
        {children}
    </div>
);

interface TileProps {
    albumsById: Map<string, Album>;
    arrival?: ArrivalProps;
    artistMbid?: null | string;
    artistName: string;
    controls: ItemControls;
    item: DiscographyItem;
    known: boolean;
    ndId: string;
    rows: DataRow[] | undefined;
}

const Tile = ({ albumsById, arrival, item, ndId, ...props }: TileProps) => (
    <ReleaseTile
        {...props}
        album={item.albumId ? albumsById.get(item.albumId) : undefined}
        arrival={arrival}
        item={item}
        ndArtistId={ndId}
    />
);

/** Fixes the arrival when the tile mounts, so a tile that stays through a resize does not replay it. */
const Slot = ({
    arrivalFor,
    index,
    ...props
}: Omit<TileProps, 'arrival'> & {
    arrivalFor: (index: number) => ArrivalProps | undefined;
    index: number;
}) => {
    const [arrival] = useState(() => arrivalFor(index));
    return <Tile {...props} arrival={arrival} />;
};
