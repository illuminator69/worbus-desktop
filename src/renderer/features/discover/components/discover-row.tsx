import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';

import styles from './discover-row.module.css';

import {
    GridCarousel,
    useGridCarouselContainerQuery,
} from '/@/renderer/components/grid-carousel/grid-carousel-v2';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

/**
 * The shell every Discover row renders inside.
 *
 * Two rules live here rather than in each row, because they are the two things
 * that went wrong everywhere else:
 *
 * 1. **A row with nothing to show renders nothing** — not a heading with an
 *    empty shelf under it, not a spinner that never resolves. Fresh, the
 *    similar-albums shelf and the CLAP entry each invented their own version of
 *    this and they do not agree. **A row that showed cards last time and is
 *    waiting for its answer is not "nothing to show", though:** it reserves its
 *    height with skeleton tiles, for a bounded time. Rendering nothing until the
 *    data arrived made every row below it jump down by a row's height, once per
 *    row, as each one answered. A row with no such history still renders
 *    nothing until it answers — a skeleton that then collapses is the same jump
 *    twice.
 * 2. **`because` is not optional.** The attribution rule this stack follows is
 *    that a recommendation names the thing that justifies it; an unattributed
 *    shelf is indistinguishable from a popularity chart. Making it a required
 *    prop is what stops a row shipping without one.
 *
 * The rows page through `GridCarousel`, the same component the home carousels
 * use, so they get this app's own arrows, its keyboard and wheel paging and its
 * card sizing rather than a hand-rolled scroller. It takes an opaque
 * `{content, id}[]`, which is why an lb-bot row can use it directly while the
 * typed wrappers (`album-infinite-carousel` and friends) cannot — those are
 * bound to Navidrome queries. Paging is local: these lists arrive whole and
 * already ranked, so there is no next page to fetch and the handlers are
 * deliberately empty, exactly as `AlbumArtistGridCarousel` does it.
 */
interface DiscoverRowProps {
    /**
     * A control that scopes the row, drawn under the reason line and above the
     * shelf it applies to — today the Deezer genre chips.
     *
     * A slot rather than something each row lays out, so a scoped row keeps the
     * same header, the same reason line and the same empty rule as an unscoped
     * one.
     */
    aside?: ReactNode;
    /** The "why am I seeing this" line. Required, deliberately. */
    because: string;
    /** Cards to page through. Rows that are not cards pass `children`. */
    cards?: { content: ReactNode; id: string }[];
    children?: ReactNode;
    /**
     * The page's shared container query, when the row sits among upstream carousels
     * that measure one (Home, the album page), so it pages by the same width as they do.
     */
    containerQuery?: ReturnType<typeof useGridCarouselContainerQuery>;
    /** Render nothing at all when there is nothing to show. */
    isEmpty: boolean;
    /**
     * The row's answer is on its way. A row that showed cards the last time it
     * answered holds its height meanwhile with a shelf of skeleton tiles, for
     * at most {@link SKELETON_MAX_MS}; any other row renders nothing until it
     * answers, as rule 1 says. Only a row that is actually fetching should pass
     * it; a disabled query must not.
     */
    isLoading?: boolean;
    /** Optional "see all" target, e.g. the full Fresh feed. */
    seeAll?: { label: string; to: string };
    title: string;
}

const noop = () => {};

/** Enough to fill the widest carousel page; `GridCarousel` shows as many as fit. */
const SKELETON_COUNT = 8;

/**
 * How long a skeleton may stand in for a row. react-query retries a failing
 * read indefinitely while reporting it as still loading, and a skeleton that
 * never resolves is the "spinner that never resolves" rule 1 forbids.
 */
const SKELETON_MAX_MS = 10_000;

/**
 * Titles of the rows that showed cards the last time they answered — the only
 * rows that get a skeleton. A skeleton is a promise that a shelf is coming: made
 * by a row that then answers empty (a user with no Rediscovery set, say), it
 * paints a shelf and collapses it, moving every row below twice instead of
 * once. Remembering the last answer confines that to a row's first visit, and
 * to a row whose content has genuinely gone. A per-viewer convenience, so
 * browser storage: an unreadable one just means no skeletons.
 */
const ROWS_WITH_CARDS_KEY = 'discover-rows-with-cards';
let rowsWithCards: null | Set<string> = null;

const rowsWithCardsSet = (): Set<string> => {
    if (rowsWithCards) return rowsWithCards;
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(ROWS_WITH_CARDS_KEY) ?? '[]');
        rowsWithCards = new Set(
            Array.isArray(stored) ? stored.filter((t): t is string => typeof t === 'string') : [],
        );
    } catch {
        rowsWithCards = new Set();
    }
    return rowsWithCards;
};

const rememberRow = (title: string, hadCards: boolean) => {
    const set = rowsWithCardsSet();
    if (set.has(title) === hadCards) return;
    if (hadCards) set.add(title);
    else set.delete(title);
    try {
        localStorage.setItem(ROWS_WITH_CARDS_KEY, JSON.stringify([...set]));
    } catch {
        // Remembered for this session only.
    }
};

/**
 * A `DiscoverTile`'s silhouette - a square cover and two text lines on the same
 * poster card - so swapping it for the real tile moves nothing.
 */
const DiscoverTileSkeleton = () => (
    <div className={styles.wrapper}>
        <div aria-hidden className={styles.tile}>
            <div className={styles.cover}>
                <Skeleton />
            </div>
            <div className={styles.skeletonLine}>
                <Skeleton width="80%" />
            </div>
            <div className={styles.skeletonLine}>
                <Skeleton width="55%" />
            </div>
        </div>
    </div>
);

const SKELETON_CARDS = Array.from({ length: SKELETON_COUNT }, (_, index) => ({
    content: <DiscoverTileSkeleton />,
    id: `skeleton-${index}`,
}));

export const DiscoverRow = ({
    aside,
    because,
    cards,
    children,
    containerQuery,
    isEmpty,
    isLoading,
    seeAll,
    title,
}: DiscoverRowProps) => {
    const hasCards = !!cards && cards.length > 0;
    const wantsSkeleton = !!isLoading && !hasCards && rowsWithCardsSet().has(title);
    // Reset whenever the row starts or stops waiting (React's "adjust state on a
    // prop change" pattern), so each wait gets its own allowance.
    const [expired, setExpired] = useState(false);
    const [wasWanting, setWasWanting] = useState(wantsSkeleton);
    if (wasWanting !== wantsSkeleton) {
        setWasWanting(wantsSkeleton);
        setExpired(false);
    }
    useEffect(() => {
        if (!wantsSkeleton) return undefined;
        const timer = window.setTimeout(() => setExpired(true), SKELETON_MAX_MS);
        return () => window.clearTimeout(timer);
    }, [wantsSkeleton]);
    // Only a carousel row's settled answer is remembered; a chip row has none.
    const settled = !isLoading && !!cards;
    useEffect(() => {
        if (settled) rememberRow(title, hasCards);
    }, [settled, hasCards, title]);

    const waiting = wantsSkeleton && !expired;
    if (isEmpty && !waiting) return null;

    const header = (
        <div className={styles.header}>
            <div className={styles.headerTitle}>
                <TextTitle fw={700} isNoSelect order={3}>
                    {title}
                </TextTitle>
                {seeAll && (
                    <Text isMuted size="sm">
                        <Link to={seeAll.to}>{seeAll.label}</Link>
                    </Text>
                )}
            </div>
            <Text isMuted size="sm">
                {because}
            </Text>
            {/* Inside the header rather than wrapped around the carousel: the
                header occupies GridCarousel's own title slot, so this is the
                one place a control can sit under the reason line and above the
                shelf it scopes without moving every other row's spacing. */}
            {aside}
        </div>
    );

    if (waiting) {
        // Keyed apart from the real shelf so it does not inherit the page the
        // user paged the skeletons to.
        return (
            <GridCarousel
                arrive={false}
                cards={SKELETON_CARDS}
                containerQuery={containerQuery}
                key="skeleton"
                onNextPage={noop}
                onPrevPage={noop}
                title={header}
            />
        );
    }

    if (!cards) {
        return (
            <Stack gap="md">
                {header}
                <div className={styles.chips}>{children}</div>
            </Stack>
        );
    }

    return (
        <GridCarousel
            cards={cards}
            containerQuery={containerQuery}
            key="cards"
            onNextPage={noop}
            onPrevPage={noop}
            title={header}
        />
    );
};
