import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './discography.module.css';

import { DataRow } from '/@/renderer/components/item-card/item-card';
import { ItemControls } from '/@/renderer/components/item-list/types';
import { ReleaseTile } from '/@/renderer/features/discography/components/release-tile';
import { type Section } from '/@/renderer/features/discography/discography-model';
import { Fold } from '/@/renderer/features/motion/fold';
import { GROW_MS_TALL } from '/@/renderer/features/motion/grow';
import { ArrivalProps } from '/@/renderer/features/motion/use-arrival';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { Album } from '/@/shared/types/domain-types';

/** As before: a section shows 100 tiles until asked for the rest. */
const MAX_SECTION_TILES = 100;

interface ReleaseSectionProps {
    albumsById: Map<string, Album>;
    /** The tile's arrival, fixed when the tile mounts (a filter change never replays it). */
    arrivalFor: (index: number) => ArrivalProps | undefined;
    artistMbid?: null | string;
    artistName: string;
    collapsed: boolean;
    controls: ItemControls;
    itemsPerRow: number;
    known: boolean;
    ndArtistId: string;
    onToggle: (header: HTMLElement) => void;
    rows: DataRow[] | undefined;
    section: Section;
}

export const ReleaseSection = ({
    albumsById,
    arrivalFor,
    artistMbid,
    artistName,
    collapsed,
    controls,
    itemsPerRow,
    known,
    ndArtistId,
    onToggle,
    rows,
    section,
}: ReleaseSectionProps) => {
    const { t } = useTranslation();
    const [showAll, setShowAll] = useState(false);
    // The grid folds open and closed (brief 8), but a collapsed section mounts nothing below its
    // header: it mounts, then opens on the next frames; it closes, then unmounts once folded.
    const [mounted, setMounted] = useState(!collapsed);
    const [open, setOpen] = useState(!collapsed);
    useEffect(() => {
        if (!collapsed) {
            let second = 0;
            const first = requestAnimationFrame(() => {
                setMounted(true);
                second = requestAnimationFrame(() => setOpen(true));
            });
            return () => {
                cancelAnimationFrame(first);
                cancelAnimationFrame(second);
            };
        }
        const close = requestAnimationFrame(() => setOpen(false));
        const unmount = window.setTimeout(() => setMounted(false), GROW_MS_TALL + 50);
        return () => {
            cancelAnimationFrame(close);
            window.clearTimeout(unmount);
        };
    }, [collapsed]);
    const shown = showAll ? section.items : section.items.slice(0, MAX_SECTION_TILES);
    const name = t(`naviConnect.discography.kind.${section.kind}`);
    const summary = collapsed
        ? t('naviConnect.discography.collapsedSummary', { count: section.items.length })
        : section.summary;

    const tiles = useMemo(
        () =>
            shown.map((item, index) => (
                <TileSlot
                    album={item.albumId ? albumsById.get(item.albumId) : undefined}
                    arrivalFor={arrivalFor}
                    artistMbid={artistMbid}
                    artistName={artistName}
                    controls={controls}
                    index={index}
                    item={item}
                    key={item.key}
                    known={known}
                    ndArtistId={ndArtistId}
                    rows={rows}
                />
            )),
        [albumsById, arrivalFor, artistMbid, artistName, controls, known, ndArtistId, rows, shown],
    );

    return (
        <section
            className={styles.section}
            data-collapsed={collapsed ? 'true' : 'false'}
            data-section={section.kind}
        >
            <h3 className={styles.sectionHead}>
                <button
                    aria-expanded={!collapsed}
                    className={styles.sectionToggle}
                    onClick={(event) => onToggle(event.currentTarget)}
                    type="button"
                >
                    <Icon icon={collapsed ? 'arrowRightS' : 'arrowDownS'} />
                    <span className={styles.sectionName}>{name}</span>
                    <small className={styles.sectionSummary}>{summary}</small>
                </button>
            </h3>
            {mounted && (
                <Fold name={section.kind} open={open} tall={section.items.length > itemsPerRow * 2}>
                    <div
                        className={styles.grid}
                        style={{ '--items-per-row': itemsPerRow } as React.CSSProperties}
                    >
                        {tiles}
                    </div>
                    {section.items.length > MAX_SECTION_TILES && !showAll && (
                        <div className={styles.more}>
                            <Button onClick={() => setShowAll(true)} variant="subtle">
                                {t('action.viewMore')}
                            </Button>
                        </div>
                    )}
                </Fold>
            )}
        </section>
    );
};

/** Fixes the arrival when the tile mounts, so a tile that stays through a filter change does not replay it. */
const TileSlot = ({
    arrivalFor,
    index,
    ...props
}: Omit<Parameters<typeof ReleaseTile>[0], 'arrival'> & {
    arrivalFor: (index: number) => ArrivalProps | undefined;
    index: number;
}) => {
    const [arrival] = useState(() => arrivalFor(index));
    return <ReleaseTile arrival={arrival} {...props} />;
};
