import clsx from 'clsx';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import styles from './library-chips.module.css';

import { SidewaysRow } from '/@/renderer/components/sideways-row/sideways-row';
import { useDiscoverCapabilities } from '/@/renderer/features/discover/use-discover-capabilities';
import { useMirrorShown } from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import { LIBRARY_TAB_ROUTES } from '/@/renderer/features/library/library-routes';
import {
    disabledSidebarIds,
    type LibraryTab,
    libraryTabForPath,
    libraryTabs,
} from '/@/renderer/features/library/library-tabs';
import { useSidebarItems } from '/@/renderer/store/settings.store';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';

/** The chips the frame shows now, with their translated labels. */
export const useLibraryTabs = () => {
    const { t } = useTranslation();
    const hubConfigured = useMirrorShown();
    const { hasSources } = useDiscoverCapabilities();
    const sidebarItems = useSidebarItems();

    return useMemo(() => {
        const tabs = libraryTabs({
            disabledIds: disabledSidebarIds(sidebarItems),
            hasDiscoverSources: hasSources,
            hubConfigured,
            routes: LIBRARY_TAB_ROUTES,
        });
        const label = (tab: LibraryTab): LibraryTab => ({
            ...tab,
            label: t(`page.library.tab.${tab.id}`, { defaultValue: tab.label }),
        });
        return {
            more: tabs.more.map(label),
            primary: tabs.primary.map(label),
            secondary: tabs.secondary.map(label),
        };
    }, [hasSources, hubConfigured, sidebarItems, t]);
};

// A list page binds Enter to "play the selection" app-wide, and the hotkey hook prevents the default
// of every Enter it sees, so a focused link or button would never activate. The chips keep their keys.
const keepKeys = (keys: string[]) => (event: KeyboardEvent<HTMLElement>) => {
    if (keys.includes(event.key)) event.stopPropagation();
};
const keepEnter = keepKeys(['Enter']);
const keepEnterAndSpace = keepKeys(['Enter', ' ']);

const Chip = ({ selected, tab }: { selected: boolean; tab: LibraryTab }) => (
    <Link
        aria-current={selected ? 'page' : undefined}
        className={styles.chip}
        data-library-chip={tab.id}
        onKeyDown={keepEnter}
        to={tab.route}
    >
        {tab.label}
    </Link>
);

/**
 * The Library's sections as a row of chips (design brief 7.2): Artists, Albums, Tracks, a divider,
 * then Mixes, Playlists, Genres, Folders, Radio stations, and More. Each chip is a link to its page;
 * the row never wraps and scrolls sideways when it does not fit, by the mouse wheel too: it sits in
 * the frame's fixed head, where a wheel has nothing else to scroll (B-285).
 */
export const LibraryChips = () => {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const tabs = useLibraryTabs();
    const selected = libraryTabForPath(pathname, tabs);
    const moreSelected = tabs.more.some((tab) => tab.id === selected);
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLButtonElement>(null);
    // Tab leaves the open menu (the menu button pattern) instead of cycling inside it. Caught before
    // the menu's focus trap (which cancels every Tab): focus goes back to More, and the browser's own
    // Tab then moves on from there.
    const leaveOnTab = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab') return;
        event.stopPropagation();
        setMoreOpen(false);
        moreRef.current?.focus();
    };

    return (
        <SidewaysRow
            aria-label={t('page.library.sections')}
            as="nav"
            className={styles.row}
            // On the frame, the head's own child: the head's short-window rule addresses it there.
            frameProps={{ 'data-library-chips': true }}
            wheel="chrome"
        >
            {tabs.primary.map((tab) => (
                <Chip key={tab.id} selected={selected === tab.id} tab={tab} />
            ))}
            {tabs.secondary.length > 0 && <span aria-hidden className={styles.divider} />}
            {tabs.secondary.map((tab) => (
                <Chip key={tab.id} selected={selected === tab.id} tab={tab} />
            ))}
            {tabs.more.length > 0 && (
                <DropdownMenu onChange={setMoreOpen} opened={moreOpen} position="bottom-start">
                    <DropdownMenu.Target>
                        <button
                            aria-current={moreSelected ? 'page' : undefined}
                            className={clsx(styles.chip, styles.more)}
                            data-library-more
                            onKeyDown={keepEnterAndSpace}
                            ref={moreRef}
                            type="button"
                        >
                            {moreSelected
                                ? tabs.more.find((tab) => tab.id === selected)!.label
                                : t('page.library.more')}
                            <Icon icon="arrowDownS" size="sm" />
                        </button>
                    </DropdownMenu.Target>
                    <DropdownMenu.Dropdown>
                        {/* The dropdown's own capture handler is Mantine's (Escape); this one is ours. */}
                        <div onKeyDownCapture={leaveOnTab} role="none">
                            {tabs.more.map((tab) => (
                                <DropdownMenu.Item
                                    component={Link}
                                    data-library-chip={tab.id}
                                    isSelected={selected === tab.id}
                                    key={tab.id}
                                    onKeyDown={keepEnter}
                                    to={tab.route}
                                >
                                    {tab.label}
                                </DropdownMenu.Item>
                            ))}
                        </div>
                    </DropdownMenu.Dropdown>
                </DropdownMenu>
            )}
        </SidewaysRow>
    );
};
