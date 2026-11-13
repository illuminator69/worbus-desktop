import clsx from 'clsx';
import { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';

import styles from './discover-row.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * One card in a Discover row, shaped like the poster cards the rest of the app
 * uses rather than like Worbus for Android's tiles.
 *
 * It is not `ItemCard`, and the reason is routing rather than looks: `ItemCard`
 * derives its link from `getTitlePath(itemType, data.id)`, so every card it can
 * render is a library item. Half of what Discover shows is deliberately *not*
 * in the library — an unowned artist has no Navidrome id and belongs on the
 * virtual `mb:` page. So the destination is passed in, and everything else
 * (the image pipeline, its blurhash placeholder, its per-type unloader icon,
 * the surface, the radius) comes from the same components `ItemCard` uses.
 *
 * `ItemImage` is what makes the artwork appear at all: an owned artist is drawn
 * from Navidrome by id, an external release from the Cover Art Archive URL
 * lb-bot sends, and anything with neither falls back to the type's own empty
 * icon instead of a text-only tile.
 */
interface DiscoverTileProps {
    /**
     * A control laid over the cover — today the one-tap acquire on an unowned
     * release. Rendered as a sibling of the card's own button rather than inside
     * it, because a button within a button is markup browsers resolve by
     * dropping the inner one.
     */
    action?: ReactNode;
    /**
     * Laid over the bottom of the cover: a release's state ("In library", a fill's
     * progress), the way a library card carries its rating badge.
     */
    badge?: ReactNode;
    /** Where the badge sits: the bottom stack (default), or a chip at the cover's top-left corner. */
    badgePlacement?: 'bottom' | 'top-start';
    /** A third, smaller line under the subtitle (a date and a release type). */
    caption?: string;
    /**
     * Artwork drawn instead of `ItemImage`, for a card whose picture is not a
     * library item's — today a mix, whose cover is either its seed's art or a
     * glyph naming the kind of recipe it is.
     */
    cover?: ReactNode;
    /** Navidrome id, for anything the library holds. */
    imageId?: null | string;
    /** A ready-made URL, for release art that lives outside the library. */
    imageUrl?: null | string;
    /**
     * A tap on this tile started a request that has not answered yet.
     *
     * Only the unmarked Deezer rows use it: their release-group id is looked up
     * on tap rather than on render, which is a MusicBrainz second. A card that
     * looks inert for a second gets tapped again, and a second tap is a second
     * search for the same row.
     */
    isBusy?: boolean;
    /** Artists are circles here, exactly as they are on the artist carousels. */
    isRound?: boolean;
    /**
     * Held from a previous answer while the row's new one loads (react-query's placeholder
     * data): dimmed, so it does not read as the new answer, as the Fresh page dims its rows.
     */
    isStale?: boolean;
    /** Faded and dashed, the same grammar the missing-album tiles use. */
    isUnowned?: boolean;
    itemType: LibraryItem;
    /** Absent: the card goes nowhere, so it is drawn as a plain card, not a button. */
    onClick?: () => void;
    /** The app's own menu for what this card shows (an album, an artist, a song). */
    onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
    /** B-407: the subtitle link's tap, before it navigates (`preventDefault` to go elsewhere). */
    onSubtitleClick?: (event: MouseEvent) => void;
    subtitle?: string;
    /**
     * Where the subtitle goes (an artist's page). The card is then a clickable box
     * rather than a <button>, so the link inside it is valid markup.
     */
    subtitleTo?: string;
    title: string;
}

export const DiscoverTile = ({
    action,
    badge,
    badgePlacement = 'bottom',
    caption,
    cover,
    imageId,
    imageUrl,
    isBusy,
    isRound,
    isStale,
    isUnowned,
    itemType,
    onClick,
    onContextMenu,
    onSubtitleClick,
    subtitle,
    subtitleTo,
    title,
}: DiscoverTileProps) => {
    const image = cover ?? (
        <ItemImage
            className={styles.image}
            containerClassName={clsx(styles.cover, {
                [styles.round]: isRound,
                [styles.unowned]: isUnowned,
            })}
            id={imageId}
            itemType={itemType}
            src={imageUrl}
            type="itemCard"
        />
    );
    const content = (
        <>
            {badge ? (
                <div className={styles.badged}>
                    {image}
                    <div
                        className={badgePlacement === 'top-start' ? styles.badgeTop : styles.badge}
                    >
                        {badge}
                    </div>
                </div>
            ) : (
                image
            )}
            <Text className={styles.name} size="sm">
                {title}
            </Text>
            {subtitle &&
                (subtitleTo ? (
                    <Text
                        className={styles.name}
                        component={Link}
                        isLink
                        isMuted
                        onClick={(event: MouseEvent) => {
                            event.stopPropagation();
                            onSubtitleClick?.(event);
                        }}
                        size="sm"
                        to={subtitleTo}
                    >
                        {subtitle}
                    </Text>
                ) : (
                    <Text className={styles.name} isMuted size="sm">
                        {subtitle}
                    </Text>
                ))}
            {caption && (
                <Text className={styles.name} isMuted size="xs">
                    {caption}
                </Text>
            )}
        </>
    );
    return (
        <div
            aria-busy={isStale || undefined}
            className={clsx(styles.wrapper, { [styles.stale]: isStale })}
            onContextMenu={onContextMenu}
        >
            {onClick && subtitleTo ? (
                // A box that acts as a button, so the artist link inside it is valid.
                <div
                    aria-busy={isBusy || undefined}
                    className={styles.tile}
                    onClick={isBusy ? undefined : onClick}
                    onKeyDown={(event) => {
                        if (event.target === event.currentTarget && event.key === 'Enter') {
                            onClick();
                        }
                    }}
                    role="button"
                    tabIndex={0}
                >
                    {content}
                </div>
            ) : onClick ? (
                <button
                    aria-busy={isBusy || undefined}
                    className={styles.tile}
                    disabled={isBusy}
                    onClick={onClick}
                    type="button"
                >
                    {content}
                </button>
            ) : (
                // Nowhere to go: no button role, no pointer.
                <div className={clsx(styles.tile, styles.inert)}>{content}</div>
            )}
            {action}
        </div>
    );
};
