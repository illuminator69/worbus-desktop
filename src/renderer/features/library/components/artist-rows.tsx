import type { FuzzyTier } from '/@/shared/utils/fuzzy-match';
import type { CSSProperties, KeyboardEvent, ReactElement, UIEvent } from 'react';

import {
    forwardRef,
    memo,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { List, type RowComponentProps, useListRef } from 'react-window-v2';

import styles from './artist-rows.module.css';

import {
    ARTIST_ROW_HEIGHT,
    ExternalArtistRow,
    GhostRow,
    OwnedArtistRow,
    type RowKeys,
} from '/@/renderer/features/library/components/artist-row';
import { LinkRow } from '/@/renderer/features/library/components/link-row';
import { useArrival } from '/@/renderer/features/motion/use-arrival';
import { Button } from '/@/shared/components/button/button';
import { AlbumArtist } from '/@/shared/types/domain-types';

export type ArtistRowsHandle = { focusFirst: () => void };

/**
 * One line of the Artists page's list, in order: headings, rows, states and the note are all items.
 * A row's `arrive` is its place in its own section, for the arrival's stagger.
 */
export type PageItem =
    | { arrive: number; artist: AlbumArtist; key: string; kind: 'owned'; tier: FuzzyTier }
    | {
          arrive: number;
          key: string;
          kind: 'external';
          line: string;
          mbid: string;
          name: string;
          to: string;
      }
    | {
          host: string;
          key: string;
          kind: 'link';
          message: string;
          onOpen: () => void;
          pending: boolean;
      }
    | { key: string; kind: 'ghost'; label?: string }
    | { key: string; kind: 'heading'; note: string; section: 'owned' | 'unowned'; title: string }
    | { key: string; kind: 'message'; retry?: () => void; retryLabel?: string; text: string }
    | { key: string; kind: 'note'; text: string };

const HEADING_HEIGHT = 48;
const MESSAGE_HEIGHT = 52;
const NOTE_LINE_HEIGHT = 18;

const isFocusable = (item: PageItem) =>
    item.kind === 'owned' || item.kind === 'external' || item.kind === 'link';

type ArrivalFor = ReturnType<typeof useArrival>['propsFor'];

interface ArtistRowsProps {
    initialOffset?: number;
    items: PageItem[];
    onLeaveTop: () => void;
    onScroll: (offset: number) => void;
    /** The text as typed: a typo row says it was found by fuzzy match. */
    query: string;
    /** The text and sort the list was ranked for: a new one starts at the top. */
    resetKey: string;
    /** The settled lookup term: each MusicBrainz answer arrives once. */
    term: string;
}

type RowProps = {
    active: number;
    externalArrival: ArrivalFor;
    items: PageItem[];
    onKeys: RowKeys;
    ownedArrival: ArrivalFor;
    query: string;
};

const Row = ({
    active,
    externalArrival,
    index,
    items,
    onKeys,
    ownedArrival,
    query,
    style,
}: RowComponentProps<RowProps>) => {
    const item = items[index];
    switch (item.kind) {
        case 'external':
            return (
                <ExternalArtistRow
                    arrival={externalArrival(item.arrive)}
                    index={index}
                    line={item.line}
                    mbid={item.mbid}
                    name={item.name}
                    onKeys={onKeys}
                    style={{ ...style, padding: '0 12px' }}
                    tabbable={active === index}
                    to={item.to}
                />
            );
        case 'ghost':
            return <GhostRow label={item.label} style={{ ...style, padding: '0 28px' }} />;
        case 'heading':
            return (
                <div className={styles.heading} data-library-section={item.section} style={style}>
                    <h2 className={styles.headingTitle}>{item.title}</h2>
                    {item.note && <small className={styles.headingNote}>{item.note}</small>}
                </div>
            );
        case 'link':
            return (
                <LinkRow
                    host={item.host}
                    index={index}
                    message={item.message}
                    onKeys={onKeys}
                    onOpen={item.onOpen}
                    pending={item.pending}
                    style={{ ...style, padding: '0 12px' }}
                    tabbable={active === index}
                />
            );
        case 'message':
            return (
                <div className={styles.message} style={style}>
                    <span>{item.text}</span>
                    {item.retry && (
                        <Button data-library-retry onClick={item.retry} size="xs" variant="default">
                            {item.retryLabel}
                        </Button>
                    )}
                </div>
            );
        case 'note':
            return (
                <p className={styles.note} style={style}>
                    {item.text}
                </p>
            );
        case 'owned':
            return (
                <OwnedArtistRow
                    arrival={ownedArrival(item.arrive)}
                    artist={item.artist}
                    index={index}
                    onKeys={onKeys}
                    style={{ ...style, padding: '0 12px' }}
                    tabbable={active === index}
                    typo={item.tier === 'typo' ? query : ''}
                />
            );
    }
};

/**
 * F6: the Artists page's list, windowed (react-window-v2, 68 px rows), so 20,000 artists draw only
 * what is on screen. One scrollbar for the page; Up and Down move from row to row, Enter opens.
 */
export const ArtistRows = memo(
    forwardRef<ArtistRowsHandle, ArtistRowsProps>(
        ({ initialOffset, items, onLeaveTop, onScroll, query, resetKey, term }, ref) => {
            const listRef = useListRef(null);
            const [width, setWidth] = useState(800);
            const firstFocusable = items.findIndex(isFocusable);
            const [activeKey, setActiveKey] = useState<null | string>(null);
            const activeIndex = (() => {
                const at = activeKey ? items.findIndex((i) => i.key === activeKey) : -1;
                return at >= 0 ? at : firstFocusable;
            })();
            const { propsFor: ownedArrival } = useArrival(items.some((i) => i.kind === 'owned'));
            const { propsFor: externalArrival } = useArrival(
                items.some((i) => i.kind === 'external'),
                term,
            );

            const focusIndex = useCallback(
                (index: number) => {
                    const item = items[index];
                    if (!item) return;
                    setActiveKey(item.key);
                    listRef.current?.scrollToRow({ align: 'smart', index });
                    requestAnimationFrame(() => {
                        const el = listRef.current?.element?.querySelector<HTMLElement>(
                            `[data-row-index="${index}"]`,
                        );
                        el?.focus();
                    });
                },
                [items, listRef],
            );

            useImperativeHandle(
                ref,
                () => ({
                    focusFirst: () => {
                        if (firstFocusable >= 0) focusIndex(firstFocusable);
                    },
                }),
                [firstFocusable, focusIndex],
            );

            const onKeys: RowKeys = useCallback(
                (event: KeyboardEvent<HTMLElement>, index: number) => {
                    if (event.key === 'Enter') {
                        // The app binds Enter to "play the list's selection" and prevents its default;
                        // here it opens the row's link.
                        event.stopPropagation();
                        return;
                    }
                    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
                    if (!step) return;
                    event.preventDefault();
                    event.stopPropagation();
                    let next = index + step;
                    while (next >= 0 && next < items.length && !isFocusable(items[next]))
                        next += step;
                    if (next < 0) onLeaveTop();
                    else if (next < items.length) focusIndex(next);
                },
                [focusIndex, items, onLeaveTop],
            );

            // Back to this page: the list's place, once it has rows to scroll. The list's element is
            // attached a frame or two after mount, so it is tried for a few frames, once, never later.
            const restored = useRef(false);
            useEffect(() => {
                if (restored.current || !initialOffset || items.length < 2) return undefined;
                let frames = 0;
                let id = 0;
                const tryRestore = () => {
                    const el = listRef.current?.element;
                    if (el && el.scrollHeight > el.clientHeight) {
                        restored.current = true;
                        el.scrollTop = initialOffset;
                        return;
                    }
                    if (++frames < 30) id = requestAnimationFrame(tryRestore);
                    else restored.current = true;
                };
                tryRestore();
                return () => cancelAnimationFrame(id);
            }, [initialOffset, items.length, listRef]);

            // A new text or sort is a new ranking, best first, so it starts at the top; left where it was,
            // a shorter list would show its bottom. Back's restore above is for an unchanged list only.
            const lastReset = useRef(resetKey);
            useEffect(() => {
                if (lastReset.current === resetKey) return;
                lastReset.current = resetKey;
                restored.current = true;
                if (items.length > 0) listRef.current?.scrollToRow({ align: 'start', index: 0 });
            }, [items.length, listRef, resetKey]);

            const rowHeight = useCallback(
                (index: number, props: RowProps): number => {
                    const item = props.items[index];
                    switch (item.kind) {
                        case 'external':
                        case 'ghost':
                        case 'link':
                        case 'owned':
                            return ARTIST_ROW_HEIGHT;
                        case 'heading':
                            return HEADING_HEIGHT;
                        case 'message':
                            return MESSAGE_HEIGHT;
                        case 'note':
                            return noteHeight(item.text, width);
                    }
                },
                [width],
            );

            // Stable while nothing it shows changes: the list places every row from these, so a render
            // that only moved the field's text must not touch 20,000 positions.
            const rowProps = useMemo(
                () => ({
                    active: activeIndex,
                    externalArrival,
                    items,
                    onKeys,
                    ownedArrival,
                    query,
                }),
                [activeIndex, externalArrival, items, onKeys, ownedArrival, query],
            );
            const handleScroll = useCallback(
                (event: UIEvent<HTMLDivElement>) => onScroll(event.currentTarget.scrollTop),
                [onScroll],
            );
            const handleResize = useCallback((size: { width: number }) => setWidth(size.width), []);

            return (
                <List
                    className={styles.list}
                    listRef={listRef}
                    onResize={handleResize}
                    onScroll={handleScroll}
                    overscanCount={6}
                    rowComponent={Row as (props: RowComponentProps<RowProps>) => ReactElement}
                    rowCount={items.length}
                    rowHeight={rowHeight}
                    rowProps={rowProps}
                    style={LIST_STYLE}
                />
            );
        },
    ),
);

const LIST_STYLE = { '--note-line': `${NOTE_LINE_HEIGHT}px` } as CSSProperties;

// The note wraps: its height from an estimate of its width (13 px Figtree runs about 6.6 px a character).
const noteHeight = (text: string, width: number) => {
    const perLine = Math.max(20, Math.floor((width - 56) / 6.6));
    const lines = Math.min(5, Math.ceil(text.length / perLine));
    return 16 + lines * NOTE_LINE_HEIGHT + 16;
};
