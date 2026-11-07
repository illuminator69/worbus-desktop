import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import isElectron from 'is-electron';
import {
    lazy,
    KeyboardEvent as ReactKeyboardEvent,
    ReactNode,
    PointerEvent as ReactPointerEvent,
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { Pane, SplitPane, usePersistence } from 'react-split-pane';

import styles from './sidebar-play-queue.module.css';

import { ItemListHandle } from '/@/renderer/components/item-list/types';
import { lyricsQueries } from '/@/renderer/features/lyrics/api/lyrics-api';
import { Lyrics } from '/@/renderer/features/lyrics/lyrics';
import { Fold } from '/@/renderer/features/motion/fold';
import { GROW_MS_TALL } from '/@/renderer/features/motion/grow';
import { DockedSimilarSongs } from '/@/renderer/features/now-playing/components/docked-similar-songs';
import { PlayQueue } from '/@/renderer/features/now-playing/components/play-queue';
import { QueuePanelHeader } from '/@/renderer/features/now-playing/components/queue-panel-header';
import { QueueSheetTab } from '/@/renderer/features/now-playing/components/queue-sheet-tabs';
import {
    clampLyricsHeight,
    lyricsHeightRange,
} from '/@/renderer/features/now-playing/utils/lyrics-height';
import { movePanel } from '/@/renderer/features/now-playing/utils/panel-order';
import { AppRoute } from '/@/renderer/router/routes';
import {
    useCombinedLyricsAndVisualizer,
    useFullScreenPlayerStore,
    usePlaybackSettings,
    usePlayerSong,
    useQueueLyricsHeight,
    useQueueLyricsOpen,
    useSettingsStore,
    useSettingsStoreActions,
    useShowLyricsInSidebar,
    useShowQueueInSidebar,
    useShowVisualizerInSidebar,
    useSidebarPanelOrder,
    useWindowSettings,
} from '/@/renderer/store';
import { ActionIcon, ActionIconGroup } from '/@/shared/components/action-icon/action-icon';
import { Flex } from '/@/shared/components/flex/flex';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { ItemListKey, Platform } from '/@/shared/types/types';

type SidebarPanelType = 'lyrics' | 'queue' | 'visualizer';

const AudioMotionAnalyzerVisualizer = lazy(() =>
    import('../../visualizer/components/audiomotionanalyzer/visualizer').then((module) => ({
        default: module.Visualizer,
    })),
);

const ButterchurnVisualizer = lazy(() =>
    import('../../visualizer/components/butternchurn/visualizer').then((module) => ({
        default: module.Visualizer,
    })),
);

export function useSidebarPanels(): SidebarPanelType[] {
    const location = useLocation();
    const combinedLyricsAndVisualizer = useCombinedLyricsAndVisualizer();
    const showLyricsInSidebar = useShowLyricsInSidebar();
    const showQueueInSidebar = useShowQueueInSidebar();
    const showVisualizerInSidebar = useShowVisualizerInSidebar();
    const sidebarPanelOrder = useSidebarPanelOrder();
    const { webAudio } = usePlaybackSettings();

    // Filter and order panels based on what's enabled
    return useMemo(() => {
        const showVisualizer = showVisualizerInSidebar && webAudio;
        const showQueue = showQueueInSidebar && location.pathname !== AppRoute.NOW_PLAYING;

        if (combinedLyricsAndVisualizer) {
            // When combined, use the order from settings but filter to only show queue and lyrics (combined)
            return sidebarPanelOrder.filter((panel) => {
                if (panel === 'queue') return showQueue;
                if (panel === 'lyrics') return showLyricsInSidebar || showVisualizer;
                return false;
            });
        }

        return sidebarPanelOrder.filter((panel) => {
            if (panel === 'queue') return showQueue;
            if (panel === 'lyrics') return showLyricsInSidebar;
            if (panel === 'visualizer') return showVisualizer;
            return false;
        });
    }, [
        combinedLyricsAndVisualizer,
        location.pathname,
        showLyricsInSidebar,
        showQueueInSidebar,
        showVisualizerInSidebar,
        sidebarPanelOrder,
        webAudio,
    ]);
}

export const SidebarPlayQueue = () => {
    const tableRef = useRef<ItemListHandle | null>(null);
    const [search, setSearch] = useState<string | undefined>(undefined);
    const [activeTab, setActiveTab] = useState<QueueSheetTab>('queue');
    const location = useLocation();
    const {
        expanded: isFullScreenPlayerExpanded,
        visualizerExpanded: isFullScreenVisualizerExpanded,
    } = useFullScreenPlayerStore();
    const [shouldRender, setShouldRender] = useState(!isFullScreenPlayerExpanded);
    const combinedLyricsAndVisualizer = useCombinedLyricsAndVisualizer();
    const showLyricsInSidebar = useShowLyricsInSidebar();
    const showQueueInSidebar = useShowQueueInSidebar();
    const showVisualizerInSidebar = useShowVisualizerInSidebar();
    const { webAudio } = usePlaybackSettings();
    const { windowBarStyle } = useWindowSettings();
    const showVisualizer = showVisualizerInSidebar && webAudio;
    const showPanel = showLyricsInSidebar || showVisualizer;
    const showQueue = showQueueInSidebar && location.pathname !== AppRoute.NOW_PLAYING;
    const orderedPanels = useSidebarPanels();

    const shouldAddTopMargin = isElectron() && windowBarStyle === Platform.WEB;

    useEffect(() => {
        if (isFullScreenPlayerExpanded || isFullScreenVisualizerExpanded) {
            // Immediately hide when fullscreen player opens
            setShouldRender(false);
            return undefined;
        } else {
            // Wait 500ms before re-rendering when fullscreen player closes to avoid performance issues
            const timeoutId = setTimeout(() => {
                setShouldRender(true);
            }, 500);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isFullScreenPlayerExpanded, isFullScreenVisualizerExpanded]);

    const [defaultLayout, onLayoutChange] = usePersistence({
        debounce: 300,
        key: 'sidebar-play-queue-container',
        storage: localStorage,
    });

    // F4: one header for both queue branches, in place of the icon tabs, the toolbar and the chips.
    const header = (
        <QueuePanelHeader
            activeTab={activeTab}
            listKey={ItemListKey.SIDE_QUEUE}
            onSearch={setSearch}
            onTabChange={setActiveTab}
            searchTerm={search}
            tableRef={tableRef}
        />
    );

    const renderPanel = (panelType: SidebarPanelType) => {
        if (panelType === 'queue') {
            return (
                <Stack gap={0} h="100%" w="100%">
                    {header}
                    {activeTab === 'queue' ? (
                        <>
                            <div className={styles.playQueueSection}>
                                <PlayQueue
                                    grouped
                                    listKey={ItemListKey.SIDE_QUEUE}
                                    ref={tableRef}
                                    searchTerm={search}
                                />
                            </div>
                        </>
                    ) : (
                        <div className={styles.playQueueSection}>
                            <DockedSimilarSongs />
                        </div>
                    )}
                </Stack>
            );
        }

        if (combinedLyricsAndVisualizer && (panelType === 'lyrics' || panelType === 'visualizer')) {
            return <CombinedLyricsAndVisualizerPanel />;
        }

        if (panelType === 'lyrics') {
            return <LyricsPanel />;
        }

        if (panelType === 'visualizer') {
            return <VisualizerPanel />;
        }

        return null;
    };

    const getPanelSize = useCallback(
        (panelType: SidebarPanelType, index: number) => {
            // Queue panel should always autofit
            if (panelType === 'queue') {
                return undefined;
            }

            const hasQueue = orderedPanels.includes('queue');

            // Without a queue to absorb remaining space, fill the sidebar height
            if (!hasQueue) {
                if (orderedPanels.length === 1 || index === orderedPanels.length - 1) {
                    return undefined;
                }

                if (
                    defaultLayout &&
                    Array.isArray(defaultLayout) &&
                    defaultLayout[index] !== undefined
                ) {
                    return defaultLayout[index];
                }

                return 100;
            }

            // If defaultLayout exists and has saved sizes, use them
            if (
                defaultLayout &&
                Array.isArray(defaultLayout) &&
                defaultLayout[index] !== undefined
            ) {
                return defaultLayout[index];
            }

            // Calculate default sizes for non-queue panels based on order
            const nonQueuePanels = orderedPanels.filter((p) => p !== 'queue');
            const nonQueueCount = nonQueuePanels.length;

            if (nonQueueCount === 0) {
                return undefined;
            }

            // If only one non-queue panel, give it a default size
            if (nonQueueCount === 1) {
                return 100;
            }

            // If multiple non-queue panels, distribute sizes evenly
            // First non-queue panel gets a size, others get undefined to share remaining
            const nonQueueIndex = orderedPanels.slice(0, index).filter((p) => p !== 'queue').length;
            if (nonQueueIndex === 0) {
                // First non-queue panel gets a default size
                return 100;
            }

            // Other non-queue panels autofit
            return undefined;
        },
        [defaultLayout, orderedPanels],
    );

    // Unmount when fullscreen player is open
    if (!shouldRender) {
        return null;
    }

    return (
        <Stack gap={0} h="100%" id="sidebar-play-queue-container" pos="relative" w="100%">
            {shouldAddTopMargin && <div className={styles.draggableRegion} />}
            {showPanel ? (
                orderedPanels.length === 1 ? (
                    <div className={styles.panelsContainer}>{renderPanel(orderedPanels[0])}</div>
                ) : orderedPanels.includes('queue') ? (
                    /*
                     * R6 (B-207): with the queue, the lyrics/visualiser area is a strip across the
                     * panel's bottom that opens (the board's QueueStates), in place of the fixed
                     * split that left the queue a few rows. The order setting still orders lyrics
                     * and visualiser inside the area.
                     */
                    <div className={clsx(styles.panelsContainer, styles.panelsWithStrip)}>
                        <div className={styles.queueArea}>{renderPanel('queue')}</div>
                        <QueueLyricsStrip
                            kind={
                                orderedPanels.includes('lyrics') && showLyricsInSidebar
                                    ? 'lyrics'
                                    : 'visualizer'
                            }
                        >
                            {orderedPanels
                                .filter((panel) => panel !== 'queue')
                                .map((panel) => (
                                    <div className={styles.stripPanel} key={panel}>
                                        {renderPanel(panel)}
                                    </div>
                                ))}
                        </QueueLyricsStrip>
                    </div>
                ) : (
                    <SplitPane
                        className={styles.panelsContainer}
                        direction="vertical"
                        dividerClassName={styles.resizeHandle}
                        onResize={onLayoutChange}
                    >
                        {orderedPanels.map((panel, index) => (
                            <Pane key={panel} size={getPanelSize(panel, index)}>
                                {renderPanel(panel)}
                            </Pane>
                        ))}
                    </SplitPane>
                )
            ) : (
                showQueue && (
                    <Stack className={styles.queueOnly} gap={0} w="100%">
                        {header}
                        {activeTab === 'queue' ? (
                            <>
                                <Flex className={styles.queueOnlyContent} direction="column">
                                    <div className={styles.playQueueSection}>
                                        <PlayQueue
                                            grouped
                                            listKey={ItemListKey.SIDE_QUEUE}
                                            ref={tableRef}
                                            searchTerm={search}
                                        />
                                    </div>
                                </Flex>
                            </>
                        ) : (
                            <Flex className={styles.queueOnlyContent} direction="column">
                                <div className={styles.playQueueSection}>
                                    <DockedSimilarSongs />
                                </div>
                            </Flex>
                        )}
                    </Stack>
                )
            )}
        </Stack>
    );
};

/**
 * The queue panel's lyrics/visualiser area as a 40 px strip (R6, B-207): folded, one row with the
 * area's icon, its name and a chevron, and nothing else mounted; open, the area takes at most
 * 320 px and at most 40 % of the panel. Open or folded is the user's, persisted
 * (`general.queueLyricsOpen`), so it holds across songs and restarts. The area folds on the kit's
 * clock (Fold), instant under reduced motion; it mounts before opening and unmounts once folded.
 */
const QueueLyricsStrip = ({
    children,
    kind,
}: {
    children: ReactNode;
    kind: 'lyrics' | 'visualizer';
}) => {
    const { t } = useTranslation();
    const open = useQueueLyricsOpen();
    const wanted = useQueueLyricsHeight();
    const { setSettings } = useSettingsStoreActions();
    const [mounted, setMounted] = useState(open);
    const [shown, setShown] = useState(open);
    const rootRef = useRef<HTMLDivElement>(null);
    const [panel, setPanel] = useState(0);
    // The height while the handle is held: written to the setting on release, not on every move.
    const [live, setLive] = useState<null | number>(null);
    const dragRef = useRef<null | { last: number; startHeight: number; startY: number }>(null);

    useEffect(() => {
        if (open) {
            let second = 0;
            const first = requestAnimationFrame(() => {
                setMounted(true);
                second = requestAnimationFrame(() => setShown(true));
            });
            return () => {
                cancelAnimationFrame(first);
                cancelAnimationFrame(second);
            };
        }
        const close = requestAnimationFrame(() => setShown(false));
        const unmount = window.setTimeout(() => setMounted(false), GROW_MS_TALL + 50);
        return () => {
            cancelAnimationFrame(close);
            window.clearTimeout(unmount);
        };
    }, [open]);

    // The panel the strip shares with the queue and its header (the `queue-panel` container): the
    // limits of the area's height follow it, so a window shrunk after a drag never lets the area take it.
    useLayoutEffect(() => {
        const parent = rootRef.current?.parentElement;
        if (!parent) return undefined;
        setPanel(parent.clientHeight);
        const observer = new ResizeObserver(() => setPanel(parent.clientHeight));
        observer.observe(parent);
        return () => observer.disconnect();
    }, []);

    // Until the panel is measured the stylesheet's default height holds.
    const height = panel > 0 ? clampLyricsHeight({ panel, wanted: live ?? wanted }) : undefined;
    // What the handle can reach, announced as the separator's range.
    const range = panel > 0 ? lyricsHeightRange(panel) : undefined;

    const commit = (next: null | number) => setSettings({ general: { queueLyricsHeight: next } });

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || height === undefined) return;
        // A selection left anywhere (a double-click selects the strip's text) would turn this press
        // into a native drag of it, and Chromium then cancels the pointer after the first move.
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { last: height, startHeight: height, startY: event.clientY };
        setLive(height);
    };

    // 1:1 with the pointer, no easing: the area is as tall as the pointer says it is.
    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || panel <= 0) return;
        drag.last = clampLyricsHeight({
            panel,
            wanted: drag.startHeight + (drag.startY - event.clientY),
        });
        setLive(drag.last);
    };

    const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        // A click on the grip without moving keeps the setting: committing it would turn the
        // default (null, which follows the window) into a fixed number.
        if (drag.last !== drag.startHeight) commit(drag.last);
        setLive(null);
    };

    const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (height === undefined || panel <= 0) return;
        const step = event.shiftKey ? 48 : 16;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            commit(
                clampLyricsHeight({
                    panel,
                    wanted: height + (event.key === 'ArrowUp' ? step : -step),
                }),
            );
        }
    };

    const label = t(`naviConnect.queue.strip.${kind}`);

    return (
        <div className={styles.lyricsStrip} data-open={open ? 'true' : 'false'} ref={rootRef}>
            {open && (
                <div
                    aria-label={t('naviConnect.queue.strip.resize')}
                    aria-orientation="horizontal"
                    aria-valuemax={range?.max}
                    aria-valuemin={range?.min}
                    aria-valuenow={height}
                    className={styles.stripHandle}
                    data-dragging={live !== null ? 'true' : undefined}
                    onDoubleClick={() => commit(null)}
                    onKeyDown={onHandleKeyDown}
                    onLostPointerCapture={() => {
                        dragRef.current = null;
                        setLive(null);
                    }}
                    onPointerCancel={onPointerEnd}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerEnd}
                    role="separator"
                    tabIndex={0}
                />
            )}
            <button
                aria-expanded={open}
                className={styles.stripRow}
                onClick={() => setSettings({ general: { queueLyricsOpen: !open } })}
                type="button"
            >
                <Icon icon={kind === 'lyrics' ? 'microphone' : 'audioLines'} />
                <span className={styles.stripLabel}>{label}</span>
                <Icon className={styles.stripChevron} icon={open ? 'arrowDownS' : 'arrowUpS'} />
            </button>
            {/* Tall: the area is usually more than the kit's GROW_TALL_PX (up to 320 px). */}
            <Fold name="queue-lyrics" open={shown} tall>
                {mounted && (
                    <div
                        className={styles.stripArea}
                        style={height === undefined ? undefined : { height }}
                    >
                        {children}
                    </div>
                )}
            </Fold>
        </div>
    );
};

const PanelReorderControls = ({ panelType }: { panelType: 'lyrics' | 'visualizer' }) => {
    const { t } = useTranslation();
    const { setSettings } = useSettingsStoreActions();
    const sidebarPanelOrder = useSidebarPanelOrder();
    const combinedLyricsAndVisualizer = useCombinedLyricsAndVisualizer();

    // R6 (B-207): the arrows order lyrics and the visualiser between themselves, and show only
    // when both are on; the queue's place is the strip's, so a move past it did nothing.
    const panels = useSidebarPanels();
    const bothShown = panels.includes('lyrics') && panels.includes('visualizer');
    const movedUp = movePanel(sidebarPanelOrder, panelType, 'up');
    const movedDown = movePanel(sidebarPanelOrder, panelType, 'down');

    const handleMoveUp = useCallback(() => {
        if (movedUp) setSettings({ general: { sidebarPanelOrder: movedUp } });
    }, [movedUp, setSettings]);

    const handleMoveDown = useCallback(() => {
        if (movedDown) setSettings({ general: { sidebarPanelOrder: movedDown } });
    }, [movedDown, setSettings]);

    const handleClose = useCallback(() => {
        if (combinedLyricsAndVisualizer && panelType === 'lyrics') {
            setSettings({
                general: {
                    showLyricsInSidebar: false,
                    showVisualizerInSidebar: false,
                },
            });
        } else if (panelType === 'lyrics') {
            setSettings({
                general: {
                    showLyricsInSidebar: false,
                },
            });
        } else if (panelType === 'visualizer') {
            setSettings({
                general: {
                    showVisualizerInSidebar: false,
                },
            });
        }
    }, [combinedLyricsAndVisualizer, panelType, setSettings]);

    return (
        <div className={styles.panelReorderControls}>
            <ActionIconGroup>
                {bothShown && (
                    <>
                        <ActionIcon
                            disabled={!movedUp}
                            icon="arrowUp"
                            iconProps={{ size: 'sm' }}
                            onClick={handleMoveUp}
                            size="xs"
                            tooltip={{
                                label: t('action.moveUp'),
                            }}
                            variant="subtle"
                        />
                        <ActionIcon
                            disabled={!movedDown}
                            icon="arrowDown"
                            iconProps={{ size: 'sm' }}
                            onClick={handleMoveDown}
                            size="xs"
                            tooltip={{
                                label: t('action.moveDown'),
                            }}
                            variant="subtle"
                        />
                    </>
                )}
                <ActionIcon
                    icon="x"
                    iconProps={{ size: 'sm' }}
                    onClick={handleClose}
                    size="xs"
                    tooltip={{
                        label: t('common.close'),
                    }}
                    variant="subtle"
                />
            </ActionIconGroup>
        </div>
    );
};

const LyricsPanel = () => {
    return (
        <div className={styles.lyricsSection}>
            <PanelReorderControls panelType="lyrics" />
            <Lyrics fadeOutNoLyricsMessage={false} settingsKey="sidebar" />
        </div>
    );
};

const VisualizerPanel = () => {
    const visualizerType = useSettingsStore((store) => store.visualizer.type);

    return (
        <div className={styles.visualizerSection}>
            <PanelReorderControls panelType="visualizer" />
            <Suspense fallback={<></>}>
                {visualizerType === 'butterchurn' ? (
                    <ButterchurnVisualizer />
                ) : (
                    <AudioMotionAnalyzerVisualizer />
                )}
            </Suspense>
        </div>
    );
};

const CombinedLyricsAndVisualizerPanel = () => {
    const currentSong = usePlayerSong();
    const visualizerType = useSettingsStore((store) => store.visualizer.type);
    const showLyricsInSidebar = useShowLyricsInSidebar();
    const showVisualizerInSidebar = useShowVisualizerInSidebar();
    const { webAudio } = usePlaybackSettings();
    const showVisualizer = showVisualizerInSidebar && webAudio;

    const { data: lyricsData } = useQuery(
        lyricsQueries.songLyrics(
            {
                options: {
                    enabled: !!currentSong?.id && showLyricsInSidebar,
                },
                query: { songId: currentSong?.id || '' },
                serverId: currentSong?._serverId || '',
            },
            currentSong,
        ),
    );

    const hasLyrics = useMemo(() => {
        if (!lyricsData) return false;

        if (Array.isArray(lyricsData)) {
            return lyricsData.length > 0 && !!lyricsData[0]?.lyrics;
        }

        const lyrics = lyricsData.selected?.lyrics;

        if (Array.isArray(lyrics)) {
            return lyrics.length > 0;
        }

        if (typeof lyrics === 'string') {
            return lyrics.trim().length > 0;
        }

        return false;
    }, [lyricsData]);

    return (
        <div className={styles.lyricsSection}>
            <PanelReorderControls panelType="lyrics" />
            {showLyricsInSidebar && <Lyrics fadeOutNoLyricsMessage={true} settingsKey="sidebar" />}
            {showVisualizer && (
                <div
                    className={clsx(styles.visualizerOverlay, {
                        [styles.visualizerOverlayDimmed]: hasLyrics && showLyricsInSidebar,
                    })}
                >
                    <Suspense fallback={<></>}>
                        {visualizerType === 'butterchurn' ? (
                            <ButterchurnVisualizer />
                        ) : (
                            <AudioMotionAnalyzerVisualizer />
                        )}
                    </Suspense>
                </div>
            )}
        </div>
    );
};
