import type { ArrivalProps } from '/@/renderer/features/motion/use-arrival';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';

import clsx from 'clsx';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import styles from './artist-row.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { useMirrorGaps } from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import { AppRoute } from '/@/renderer/router/routes';
import { tintHues } from '/@/shared/components/animations/tint-hues';
import { Icon } from '/@/shared/components/icon/icon';
import { AlbumArtist, LibraryItem } from '/@/shared/types/domain-types';

export const ARTIST_ROW_HEIGHT = 68;

/** The row's keys: the list moves focus with Up and Down; Enter is kept from the app's list hotkey. */
export type RowKeys = (event: KeyboardEvent<HTMLElement>, index: number) => void;

/**
 * The arrival (a rise in `transform`) on an inner box: the windowed list places each row with its own
 * `transform`, which the animation's fill would otherwise replace.
 */
const Arriving = ({
    arrival,
    children,
    style,
}: {
    arrival?: ArrivalProps;
    children: ReactNode;
    style?: CSSProperties;
}) => (
    <div style={style}>
        <div
            className={arrival?.className}
            data-arrive={arrival?.['data-arrive']}
            style={arrival?.style}
        >
            {children}
        </div>
    </div>
);

export const Pill = ({ children, kind }: { children: ReactNode; kind: 'gaps' | 'unowned' }) => (
    <span
        className={clsx(styles.pill, styles[kind])}
        data-gap-pill={kind === 'gaps' ? '' : undefined}
    >
        {children}
    </span>
);

const GapPill = ({ id, mbid }: { id: string; mbid: null | string }) => {
    const { t } = useTranslation();
    const gaps = useMirrorGaps(id, mbid);
    if (!gaps) return <span />;
    return <Pill kind="gaps">{t('page.library.withGaps', { count: gaps })}</Pill>;
};

interface OwnedRowProps {
    arrival?: ArrivalProps;
    artist: AlbumArtist;
    index: number;
    onKeys: RowKeys;
    style?: CSSProperties;
    tabbable: boolean;
    /** The text as typed, for the fuzzy note; empty for a row that is not a typo match. */
    typo: string;
}

/** One of your artists: round cover, name, "N releases", the gap pill when lb-bot indexed it. */
export const OwnedArtistRow = memo(
    ({ arrival, artist, index, onKeys, style, tabbable, typo }: OwnedRowProps) => {
        const { t } = useTranslation();
        const releases =
            artist.albumCount !== null && artist.albumCount !== undefined
                ? t('page.library.releases', { count: artist.albumCount })
                : '';
        const fuzzy = typo ? t('page.library.foundByFuzzy', { text: typo }) : '';
        const line = [releases, fuzzy].filter(Boolean).join(' - ');

        const onContextMenu = (event: MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault();
            ContextMenuController.call({
                cmd: { items: [artist], type: LibraryItem.ALBUM_ARTIST },
                event,
            });
        };

        return (
            <Arriving arrival={arrival} style={style}>
                <Link
                    className={styles.row}
                    data-artist-row={artist.id}
                    data-row-index={index}
                    onContextMenu={onContextMenu}
                    onKeyDown={(event) => onKeys(event, index)}
                    tabIndex={tabbable ? 0 : -1}
                    to={generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, {
                        albumArtistId: artist.id,
                    })}
                >
                    <ItemImage
                        containerClassName={styles.cover}
                        id={artist.imageId ?? artist.id}
                        itemType={LibraryItem.ALBUM_ARTIST}
                        src={artist.imageUrl}
                        type="table"
                    />
                    <span className={styles.text}>
                        <span className={styles.name}>{artist.name}</span>
                        {line && <span className={styles.line}>{line}</span>}
                    </span>
                    <GapPill id={artist.id} mbid={artist.mbz} />
                    <Icon className={styles.chevron} icon="arrowRightS" size="md" />
                </Link>
            </Arriving>
        );
    },
);

interface ExternalRowProps {
    arrival?: ArrivalProps;
    index: number;
    line: string;
    mbid: string;
    name: string;
    onKeys: RowKeys;
    style?: CSSProperties;
    tabbable: boolean;
    to: string;
}

/** An artist from MusicBrainz you do not own: a tinted placeholder (no cover exists), "Not owned". */
export const ExternalArtistRow = memo(
    ({ arrival, index, line, mbid, name, onKeys, style, tabbable, to }: ExternalRowProps) => {
        const { t } = useTranslation();
        const [a, b] = tintHues(mbid);
        return (
            <Arriving arrival={arrival} style={style}>
                <Link
                    className={styles.row}
                    data-artist-row={mbid}
                    data-row-index={index}
                    onKeyDown={(event) => onKeys(event, index)}
                    tabIndex={tabbable ? 0 : -1}
                    to={to}
                >
                    <span
                        aria-hidden
                        className={clsx(styles.cover, styles.tint)}
                        style={{ '--tint-a': a, '--tint-b': b } as CSSProperties}
                    />
                    <span className={styles.text}>
                        <span className={styles.name}>{name}</span>
                        <span className={styles.line}>{line}</span>
                    </span>
                    <Pill kind="unowned">{t('page.library.notOwned')}</Pill>
                    <Icon className={styles.chevron} icon="arrowRightS" size="md" />
                </Link>
            </Arriving>
        );
    },
);

/** The board's ghost row: a circle, two lines and a pill, pulsing (and still under reduced motion). */
export const GhostRow = ({ label, style }: { label?: string; style?: CSSProperties }) => (
    <div
        aria-label={label}
        className={styles.ghostRow}
        role={label ? 'status' : undefined}
        style={style}
    >
        <span className={clsx(styles.ghost, styles.ghostCover)} />
        <span className={styles.text}>
            <span className={clsx(styles.ghost, styles.ghostLine)} />
            <span className={clsx(styles.ghost, styles.ghostLineShort)} />
        </span>
        <span className={clsx(styles.ghost, styles.ghostPill)} />
        <span />
    </div>
);
