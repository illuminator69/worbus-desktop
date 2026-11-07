import { ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './discography.module.css';

import { useDefaultItemListControls } from '/@/renderer/components/item-list/helpers/item-list-controls';
import { useGridRows } from '/@/renderer/components/item-list/helpers/use-grid-rows';
import { FilterBar } from '/@/renderer/features/discography/components/filter-bar';
import { GhostSections } from '/@/renderer/features/discography/components/ghost-sections';
import { ReleaseSection } from '/@/renderer/features/discography/components/release-section';
import { RescanControl } from '/@/renderer/features/discography/components/rescan-control';
import { ScanBar } from '/@/renderer/features/discography/components/scan-bar';
import {
    type DiscographyItem,
    filterItems,
    sectionsOf,
    sortItems,
} from '/@/renderer/features/discography/discography-model';
import { DEFAULT_VIEW, viewIsDefault } from '/@/renderer/features/discography/discography-view';
import { useArtistScan } from '/@/renderer/features/discography/hooks/use-artist-scan';
import { useDiscographyItems } from '/@/renderer/features/discography/hooks/use-discography-items';
import { useDiscographyView } from '/@/renderer/features/discography/hooks/use-discography-view';
import { type ReleaseKind } from '/@/renderer/features/discography/release-kind';
import { useArrival } from '/@/renderer/features/motion/use-arrival';
import { useContainerQuery } from '/@/renderer/hooks';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import { useArtistReleaseTypeItems, useSettingsStore } from '/@/renderer/store/settings.store';
import { Button } from '/@/shared/components/button/button';
import { Text } from '/@/shared/components/text/text';
import { useDebouncedValue } from '/@/shared/hooks/use-debounced-value';
import { Album, LibraryItem } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

/** A section's open or closed state as the person set it this session, per artist (not persisted). */
const collapseOverrides = new Map<string, Map<ReleaseKind, boolean>>();

/** The tile grid's container widths; the artist page's lines use the same, so a tile is one size. */
export const TILE_BREAKPOINTS = {
    '2xl': 1280,
    '3xl': 1440,
    lg: 960,
    md: 720,
    sm: 520,
    xl: 1152,
    xs: 360,
};

export const getItemsPerRow = (cq: ReturnType<typeof useContainerQuery>) => {
    if (cq.is3xl) return 8;
    if (cq.is2xl) return 7;
    if (cq.isXl) return 6;
    if (cq.isLg) return 5;
    if (cq.isMd) return 4;
    if (cq.isSm) return 3;
    return 2;
};

const scrollParentOf = (el: HTMLElement | null): HTMLElement | null => {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight
        ) {
            return node;
        }
    }
    return null;
};

interface DiscographyProps {
    artistMbid?: null | string;
    artistName: string;
    /** The MusicBrainz menu (Wrong artist, Refresh About), after the Rescan control. */
    menu?: ReactNode;
    ndId: string;
    /** Navidrome's albums for the artist; null on the not-owned page. */
    owned: Album[] | null;
}

/**
 * An artist's discography (B-165): every release, owned or not, in one section per kind, with the
 * filters, ownership and sort the page keeps in its URL. Both artist pages render this one component
 * over the one model, so their kinds cannot drift.
 */
export const Discography = ({ artistMbid, artistName, menu, ndId, owned }: DiscographyProps) => {
    const { t } = useTranslation();
    const { setView, view } = useDiscographyView();
    const { albumsById, discography, items, known } = useDiscographyItems({
        artistMbid,
        ndId,
        owned,
    });
    const scan = useArtistScan({ artistMbid, artistName, discography, ndId });
    const releaseTypeItems = useArtistReleaseTypeItems();
    const [search, setSearch] = useState('');
    const [debounced] = useDebouncedValue(search, 300);
    const debouncedSearch = debounced ?? '';
    const rows = useGridRows(LibraryItem.ALBUM, ItemListKey.ALBUM);
    const controls = useDefaultItemListControls();
    const searchRef = useRef<HTMLInputElement>(null);
    const binding = useSettingsStore((state) => state.hotkeys.bindings.localSearch);
    useHotkeys([[binding.hotkey, () => searchRef.current?.focus()]]);

    const shown = useMemo(() => {
        const needle = debouncedSearch.trim().toLowerCase();
        const filtered = filterItems(items, view).filter(
            (item: DiscographyItem) => !needle || item.title.toLowerCase().includes(needle),
        );
        return sortItems(filtered, view);
    }, [debouncedSearch, items, view]);
    const sections = useMemo(
        () => sectionsOf(shown, view, releaseTypeItems),
        [releaseTypeItems, shown, view],
    );

    const [, bump] = useState(0);
    const overrides = collapseOverrides.get(ndId);
    // A section's own chip always opens it, whatever it was set to by hand.
    const isCollapsed = (kind: ReleaseKind, fallback: boolean) =>
        view.type === kind ? false : (overrides?.get(kind) ?? fallback);

    // Keep the header that was pressed where it is: whatever opens or closes, the page does not move under it.
    const anchor = useRef<null | { el: HTMLElement; top: number }>(null);
    useLayoutEffect(() => {
        const held = anchor.current;
        if (!held) return;
        anchor.current = null;
        const scroller = scrollParentOf(held.el);
        const moved = held.el.getBoundingClientRect().top - held.top;
        if (scroller && Math.abs(moved) > 0.5) scroller.scrollTop += moved;
    });
    const toggle = useCallback(
        (kind: ReleaseKind, collapsed: boolean, header: HTMLElement) => {
            anchor.current = { el: header, top: header.getBoundingClientRect().top };
            const map = collapseOverrides.get(ndId) ?? new Map<ReleaseKind, boolean>();
            map.set(kind, !collapsed);
            collapseOverrides.set(ndId, map);
            bump((n) => n + 1);
        },
        [ndId],
    );

    const cq = useContainerQuery(TILE_BREAKPOINTS);
    const itemsPerRow = getItemsPerRow(cq);
    const viewKey = `${view.type}|${view.own}|${view.sort}|${view.dir}|${debouncedSearch}`;
    const { propsFor } = useArrival(cq.isCalculated && shown.length > 0, viewKey);

    const filterName = [
        view.type !== 'all' ? t(`naviConnect.discography.kind.${view.type}`) : '',
        view.own !== 'all' ? t(`naviConnect.discography.own.${view.own}`) : '',
        debouncedSearch.trim() ? `"${debouncedSearch.trim()}"` : '',
    ]
        .filter(Boolean)
        .join(' + ');

    return (
        <div
            className={styles.root}
            data-discography=""
            data-view-own={view.own}
            data-view-sort={view.sort}
            data-view-type={view.type}
        >
            <FilterBar
                items={items}
                known={known}
                rescan={
                    <>
                        <RescanControl scan={scan} />
                        {menu}
                    </>
                }
                search={search}
                searchRef={searchRef}
                setSearch={setSearch}
                setView={setView}
                view={view}
            />
            <ScanBar scan={scan} />
            <div className={styles.sections} ref={cq.ref}>
                {items.length > 0 && shown.length === 0 ? (
                    <div className={styles.empty} data-discography-empty="">
                        <Text isMuted>
                            {t('naviConnect.discography.nothingMatches', {
                                filter: filterName,
                            })}
                        </Text>
                        <Button
                            onClick={() => {
                                setSearch('');
                                if (!viewIsDefault(view)) setView(DEFAULT_VIEW);
                            }}
                            size="compact-sm"
                            variant="default"
                        >
                            {t('naviConnect.discography.showAll')}
                        </Button>
                    </div>
                ) : (
                    cq.isCalculated &&
                    sections.map((section) => {
                        const collapsed = isCollapsed(section.kind, section.collapsed);
                        return (
                            <ReleaseSection
                                albumsById={albumsById}
                                arrivalFor={propsFor}
                                artistMbid={artistMbid}
                                artistName={artistName}
                                collapsed={collapsed}
                                controls={controls}
                                itemsPerRow={itemsPerRow}
                                key={section.kind}
                                known={known}
                                ndArtistId={ndId}
                                onToggle={(header) => toggle(section.kind, collapsed, header)}
                                rows={rows}
                                section={section}
                            />
                        );
                    })
                )}
                {/* A first scan: the missing releases' place, shaped like the answer. */}
                {scan.phase === 'running' && !known && cq.isCalculated && (
                    <GhostSections itemsPerRow={itemsPerRow} />
                )}
            </div>
        </div>
    );
};
