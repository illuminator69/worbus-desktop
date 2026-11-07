import clsx from 'clsx';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';

import styles from './play-queue.module.css';

import { useItemListColumnReorder } from '/@/renderer/components/item-list/helpers/use-item-list-column-reorder';
import { useItemListColumnResize } from '/@/renderer/components/item-list/helpers/use-item-list-column-resize';
import {
    ItemTableList,
    TableGroupHeader,
    TableItemProps,
} from '/@/renderer/components/item-list/item-table-list/item-table-list';
import { ItemTableListColumn } from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { ItemListHandle } from '/@/renderer/components/item-list/types';
import { eventEmitter } from '/@/renderer/events/event-emitter';
import { hubTrackToQueueSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { useQueueRows } from '/@/renderer/features/now-playing/hooks/use-queue-rows';
import { useIsPlayerFetching, usePlayer } from '/@/renderer/features/player/context/player-context';
import { searchLibraryItems } from '/@/renderer/features/shared/utils';
import { useDragDrop } from '/@/renderer/hooks/use-drag-drop';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import {
    isShuffleEnabled,
    mapShuffledToQueueIndex,
    subscribeCurrentTrack,
    subscribePlayerQueue,
    useCurrentServerId,
    useFollowCurrentSong,
    useHubIsRemoteActive,
    useHubStore,
    useListSettings,
    usePlayerActions,
    usePlayerSong,
    usePlayerStore,
} from '/@/renderer/store';
import { Flex } from '/@/shared/components/flex/flex';
import { LoadingOverlay } from '/@/shared/components/loading-overlay/loading-overlay';
import { useDebouncedValue } from '/@/shared/hooks/use-debounced-value';
import { useFocusWithin } from '/@/shared/hooks/use-focus-within';
import { useMergedRef } from '/@/shared/hooks/use-merged-ref';
import { Folder, LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';
import { DragTarget } from '/@/shared/types/drag-and-drop';
import { ItemListKey, Play } from '/@/shared/types/types';

// The side queue's rows (F4): 48 px songs and 32 px group captions. At module scope so the table
// sees one function; it sizes captions in the scroll maths too (scrollCellProps carries the map).
const groupedRowHeight = (index: number, cellProps: TableItemProps) =>
    cellProps.groupHeaderInfoByRowIndex?.has(index) ? 32 : 48;

type QueueProps = {
    enableScrollShadow?: boolean;
    /**
     * The side queue (F4): rows in groups by who put them there, no column header row, and
     * follow-current from an effect once the groups are in the table.
     */
    grouped?: boolean;
    listKey: ItemListKey;
    searchTerm: string | undefined;
};

export const PlayQueue = forwardRef<ItemListHandle, QueueProps>(
    ({ enableScrollShadow = true, grouped = false, listKey, searchTerm }, ref) => {
        const { table } = useListSettings(listKey) || {};

        const isFetching = useIsPlayerFetching();
        const tableRef = useRef<ItemListHandle>(null);
        const mergedRef = useMergedRef(ref, tableRef);
        const { getQueue } = usePlayerActions();
        const followCurrentSong = useFollowCurrentSong();

        const [debouncedSearchTerm] = useDebouncedValue(searchTerm, 200);

        const [data, setData] = useState<QueueSong[]>([]);
        const [groups, setGroups] = useState<TableGroupHeader[]>([]);

        const isRemoteActive = useHubIsRemoteActive();
        const serverId = useCurrentServerId();
        const remoteQueue = useHubStore((s) => s.remoteQueue, shallow);
        const remoteIndex = useHubStore((s) => s.remoteQueueIndex);

        // While playback is on another navi-connect device the side queue shows the REMOTE
        // session queue. The `remote:<i>` uniqueId is the sentinel that routes a row
        // double-click to a hub jump (see mediaPlay in player-context).
        const remoteData: QueueSong[] = useMemo(
            () =>
                remoteQueue.map((track, i) =>
                    hubTrackToQueueSong(track, serverId ?? '', null, `remote:${i}`),
                ),
            [remoteQueue, serverId],
        );

        useEffect(() => {
            const setQueue = () => {
                const queue = getQueue() || { groups: [], items: [] };

                setData(queue.items);

                setGroups([]);
            };

            const unsub = subscribePlayerQueue(() => {
                setQueue();
            });

            // Grouped, these indexes would be converted with the grouping before the change:
            // the side queue follows from the effect below instead.
            const unsubCurrentTrack = subscribeCurrentTrack((e) => {
                if (!grouped && followCurrentSong && e.index !== -1) {
                    tableRef.current?.scrollToIndex(e.index, {
                        align: 'center',
                        behavior: 'auto',
                    });
                }
            });

            const handleAutoDJQueueAdded = () => {
                // A top-up regroups the side queue; it must not move the user.
                if (!grouped && followCurrentSong) {
                    const state = usePlayerStore.getState();
                    let index = state.player.index;

                    if (isShuffleEnabled(state)) {
                        index = mapShuffledToQueueIndex(index, state.queue.shuffled);
                    }

                    if (index !== -1) {
                        // Use setTimeout to ensure the DOM has updated with the new queue items
                        setTimeout(() => {
                            tableRef.current?.scrollToIndex(index, {
                                align: 'center',
                                behavior: 'auto',
                            });
                        }, 0);
                    }
                }
            };

            eventEmitter.on('AUTODJ_QUEUE_ADDED', handleAutoDJQueueAdded);

            setQueue();

            if (!grouped && followCurrentSong) {
                const state = usePlayerStore.getState();
                let index = state.player.index;

                if (isShuffleEnabled(state)) {
                    index = mapShuffledToQueueIndex(index, state.queue.shuffled);
                }

                if (index !== -1) {
                    setTimeout(() => {
                        tableRef.current?.scrollToIndex(index, {
                            align: 'center',
                            behavior: 'auto',
                        });
                    }, 0);
                }
            }

            return () => {
                unsub();
                unsubCurrentTrack();
                eventEmitter.off('AUTODJ_QUEUE_ADDED', handleAutoDJQueueAdded);
            };
        }, [getQueue, tableRef, followCurrentSong, grouped]);

        const baseData = isRemoteActive ? remoteData : data;

        const filteredData: QueueSong[] = useMemo(() => {
            if (debouncedSearchTerm) {
                const searched = searchLibraryItems(
                    baseData,
                    debouncedSearchTerm,
                    LibraryItem.SONG,
                );
                return searched;
            }

            return baseData;
        }, [baseData, debouncedSearchTerm]);

        const isEmpty = filteredData.length === 0;

        const { handleColumnReordered } = useItemListColumnReorder({
            itemListKey: listKey,
        });

        const { handleColumnResized } = useItemListColumnResize({
            itemListKey: listKey,
        });

        const currentSong = usePlayerSong();

        const currentSongUniqueId = currentSong?._uniqueId;
        const activeRowId = isRemoteActive ? `remote:${remoteIndex}` : currentSongUniqueId;

        // A filtered subset cannot keep its playing row: no groups while the search has text.
        const queueRows = useQueueRows(filteredData, activeRowId, grouped && !debouncedSearchTerm);

        // Follow the playing row after its grouping is in the table: on a track change (and on
        // mount), never on a regroup alone, which must not move the user.
        const followedRef = useRef<string | undefined>(undefined);
        useEffect(() => {
            if (!grouped || !followCurrentSong || !activeRowId) return;
            if (followedRef.current === activeRowId) return;
            if (queueRows.playingIndex < 0) return;
            followedRef.current = activeRowId;
            tableRef.current?.scrollToIndex(queueRows.playingIndex, {
                align: 'center',
                behavior: 'auto',
            });
            // Keyed on the playing row and the grouping it was found in.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [activeRowId, followCurrentSong, grouped, queueRows.signature]);

        const { focused, ref: containerFocusRef } = useFocusWithin();
        const player = usePlayer();

        useHotkeys([
            [
                'delete',
                () => {
                    if (focused) {
                        const selectedItems =
                            tableRef.current?.internalState.getSelected() as QueueSong[];

                        if (!selectedItems || selectedItems.length === 0) {
                            return;
                        }

                        player.clearSelected(selectedItems);
                    }
                },
            ],
        ]);

        return (
            <div
                className={clsx(styles.container, { [styles.grouped]: grouped })}
                ref={containerFocusRef}
            >
                <LoadingOverlay pos="absolute" visible={isFetching} />
                <ItemTableList
                    activeRowId={activeRowId}
                    autoFitColumns={table.autoFitColumns}
                    autoScrollToActiveRow={followCurrentSong}
                    CellComponent={ItemTableListColumn}
                    columns={table.columns}
                    data={filteredData}
                    enableAlternateRowColors={table.enableAlternateRowColors}
                    // Remote rows are draggable too: the reorder is routed to the hub
                    // session in player-context.moveSelectedTo (single-item moves).
                    enableDrag
                    enableExpansion={false}
                    enableHeader={grouped ? false : table.enableHeader}
                    enableHorizontalBorders={table.enableHorizontalBorders}
                    enableRowHoverHighlight={table.enableRowHoverHighlight}
                    enableScrollShadow={enableScrollShadow}
                    enableSelection
                    enableSelectionDialog={false}
                    enableVerticalBorders={table.enableVerticalBorders}
                    getRowId="_uniqueId"
                    groups={grouped ? queueRows.groups : groups.length > 0 ? groups : undefined}
                    initialTop={{
                        to: 0,
                        type: 'offset',
                    }}
                    itemType={LibraryItem.QUEUE_SONG}
                    markActiveRow={grouped}
                    onColumnReordered={handleColumnReordered}
                    onColumnResized={handleColumnResized}
                    ref={mergedRef}
                    rowHeight={grouped ? groupedRowHeight : undefined}
                    size={table.size}
                />
                {isEmpty && <EmptyQueueDropZone />}
            </div>
        );
    },
);

const EmptyQueueDropZone = () => {
    const playerContext = usePlayer();

    const { isDraggedOver, ref } = useDragDrop<HTMLDivElement>({
        drop: {
            canDrop: () => {
                return true;
            },
            getData: () => {
                return {
                    id: [],
                    item: [],
                    itemType: LibraryItem.QUEUE_SONG,
                    type: DragTarget.QUEUE_SONG,
                };
            },
            onDrag: () => {
                return;
            },
            onDragLeave: () => {
                return;
            },
            onDrop: (args) => {
                if (args.self.type === DragTarget.QUEUE_SONG) {
                    const sourceServerId = (
                        args.source.item?.[0] as unknown as { _serverId: string }
                    )?._serverId;

                    const sourceItemType = args.source.itemType as LibraryItem;

                    switch (args.source.type) {
                        case DragTarget.ALBUM: {
                            if (sourceServerId) {
                                playerContext.addToQueueByFetch(
                                    sourceServerId,
                                    args.source.id,
                                    sourceItemType,
                                    Play.NOW,
                                );
                            }
                            break;
                        }
                        case DragTarget.ALBUM_ARTIST: {
                            if (sourceServerId) {
                                playerContext.addToQueueByFetch(
                                    sourceServerId,
                                    args.source.id,
                                    sourceItemType,
                                    Play.NOW,
                                );
                            }
                            break;
                        }
                        case DragTarget.ARTIST: {
                            if (sourceServerId) {
                                playerContext.addToQueueByFetch(
                                    sourceServerId,
                                    args.source.id,
                                    sourceItemType,
                                    Play.NOW,
                                );
                            }
                            break;
                        }
                        case DragTarget.FOLDER: {
                            const items = args.source.item;

                            const { folders, songs } = (items || []).reduce<{
                                folders: Folder[];
                                songs: Song[];
                            }>(
                                (acc, item) => {
                                    if ((item as unknown as Song)._itemType === LibraryItem.SONG) {
                                        acc.songs.push(item as unknown as Song);
                                    } else if (
                                        (item as unknown as Folder)._itemType === LibraryItem.FOLDER
                                    ) {
                                        acc.folders.push(item as unknown as Folder);
                                    }
                                    return acc;
                                },
                                { folders: [], songs: [] },
                            );

                            const folderIds = folders.map((folder) => folder.id);

                            // Handle folders: fetch and add to queue
                            if (folderIds.length > 0) {
                                playerContext.addToQueueByFetch(
                                    sourceServerId,
                                    folderIds,
                                    LibraryItem.FOLDER,
                                    Play.NOW,
                                );
                            }

                            // Handle songs: add directly to queue
                            if (songs.length > 0) {
                                playerContext.addToQueueByData(songs, Play.NOW);
                            }

                            break;
                        }
                        case DragTarget.GENRE: {
                            if (sourceServerId) {
                                playerContext.addToQueueByFetch(
                                    sourceServerId,
                                    args.source.id,
                                    sourceItemType,
                                    Play.NOW,
                                );
                            }
                            break;
                        }
                        case DragTarget.PLAYLIST: {
                            if (sourceServerId) {
                                playerContext.addToQueueByFetch(
                                    sourceServerId,
                                    args.source.id,
                                    sourceItemType,
                                    Play.NOW,
                                );
                            }
                            break;
                        }
                        case DragTarget.QUEUE_SONG: {
                            const sourceItems = (args.source.item || []) as QueueSong[];
                            if (sourceItems.length > 0) {
                                playerContext.addToQueueByData(sourceItems, Play.NOW);
                            }
                            break;
                        }
                        case DragTarget.SONG: {
                            const sourceItems = (args.source.item || []) as Song[];
                            if (sourceItems.length > 0) {
                                playerContext.addToQueueByData(sourceItems, Play.NOW);
                            }
                            break;
                        }
                        default: {
                            break;
                        }
                    }
                }

                return;
            },
        },
        isEnabled: true,
    });

    return (
        <Flex
            align="center"
            className={clsx(styles.dropZone, {
                [styles.draggedOver]: isDraggedOver,
            })}
            direction="column"
            gap="md"
            justify="center"
            ref={ref}
            w="100%"
        />
    );
};
