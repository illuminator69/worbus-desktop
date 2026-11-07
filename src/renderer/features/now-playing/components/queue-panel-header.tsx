import clsx from 'clsx';
import { RefObject, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import styles from './queue-panel-header.module.css';

import { ItemListHandle } from '/@/renderer/components/item-list/types';
import {
    QueueActionsMenu,
    QueueMenuSection,
    useQueueActions,
} from '/@/renderer/features/now-playing/components/queue-actions-menu';
import { QueueSheetTab } from '/@/renderer/features/now-playing/components/queue-sheet-tabs';
import { usePlayingFrom } from '/@/renderer/features/now-playing/hooks/use-playing-from';
import { useToggleQueuePanel } from '/@/renderer/features/now-playing/hooks/use-queue-panel-toggle';
import { usePlayingRowId } from '/@/renderer/features/now-playing/hooks/use-queue-rows';
import { playingFromLine } from '/@/renderer/features/now-playing/utils/playing-from';
import { queueLength } from '/@/renderer/features/now-playing/utils/queue-grouping';
import {
    autoplayIsOn,
    characterChips,
    chipsFor,
    panelStatusLine,
    selectedChip,
} from '/@/renderer/features/player/station/station-chips';
import {
    tapStationChip,
    toggleStationAutoplay,
} from '/@/renderer/features/player/station/use-station-autoplay';
import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { SearchInput } from '/@/renderer/features/shared/components/search-input';
import { describeQueueSource } from '/@/renderer/features/sonic/audio-muse-palette';
import { useHubIsRemoteActive, useHubStore, usePlayerStoreBase } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Switch } from '/@/shared/components/switch/switch';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { StationCharacterId } from '/@/shared/types/station-types';
import { ItemListKey } from '/@/shared/types/types';

const MENU_SECTIONS: readonly QueueMenuSection[] = [
    'saveRestore',
    'shuffle',
    'goToCurrent',
    'createPlaylist',
    'tableSettings',
];

interface QueuePanelHeaderProps {
    activeTab: QueueSheetTab;
    listKey: ItemListKey;
    onSearch: (value: string) => void;
    onTabChange: (tab: QueueSheetTab) => void;
    searchTerm?: string;
    tableRef: RefObject<ItemListHandle | null>;
}

/** Count and total length of the queue the panel shows: the session's while another device plays. */
const useQueueSize = (): { count: number; totalMs: number } => {
    const isRemote = useHubIsRemoteActive();
    const local = usePlayerStoreBase((s) => {
        let totalMs = 0;
        for (const key of s.queue.default) totalMs += s.queue.songs[key]?.duration ?? 0;
        return { count: s.queue.default.length, totalMs };
    }, shallow);
    const remote = useHubStore((s) => {
        let totalMs = 0;
        for (const track of s.remoteQueue) totalMs += track.durationMs ?? 0;
        return { count: s.remoteQueue.length, totalMs };
    }, shallow);
    return isRemote ? remote : local;
};

/**
 * The side queue's header (F4), Worbus for Android's queue sheet as a desktop panel: what the queue is playing
 * from with the Autoplay switch and the button that hides the panel (R14), the line the chip row
 * used to carry, the three characters, the Up
 * next / Related switch, and the count line with search, the `...` menu and Clear. It replaces, in
 * the side panel only, the icon tabs, the toolbar and the chip row; the drawer, the popover and the
 * Now Playing page keep those.
 */
export const QueuePanelHeader = ({
    activeTab,
    listKey,
    onSearch,
    onTabChange,
    searchTerm,
    tableRef,
}: QueuePanelHeaderProps) => {
    const { t } = useTranslation();
    const words = useStationWords();
    const from = usePlayingFrom();
    const size = useQueueSize();
    const playingRowId = usePlayingRowId();

    const selected = selectedChip({
        autoplay: words.autoplay,
        bound: words.bound,
        mode: words.mode,
        preferred: words.preferred,
    });
    const autoplayOn = autoplayIsOn(selected);
    const characters = characterChips(chipsFor(words.mode));

    const origin = describeQueueSource({
        autoplay: words.autoplay,
        bound: words.bound,
        characterLabel: words.characterLabel,
        labels: {
            autoDj: t('setting.autoDJ'),
            viaNavidrome: t('naviConnect.station.viaNavidrome'),
        },
        mode: words.mode,
        stationName: words.stationName,
    });
    // No status sentence (B-251): the Autoplay switch beside the title says it.
    const statusLine = panelStatusLine(origin?.label ?? null, Boolean(words.bound));
    // The rail's open button, mirrored: the same toggle as the player bar's queue icon (B-250).
    const toggleQueue = useToggleQueuePanel();

    // By the playing row's id in the table's own rows, never `player.index` (a shuffled
    // position, and the local one while another device plays).
    const goToCurrent = useCallback(() => {
        const table = tableRef.current;
        if (!table || !playingRowId) return;
        const index = table.internalState.findItemIndex(playingRowId);
        if (index >= 0) table.scrollToIndex(index, { align: 'center' });
    }, [playingRowId, tableRef]);
    const actions = useQueueActions(goToCurrent);

    const { hours, minutes } = queueLength(size.totalMs);
    const length =
        hours > 0
            ? t('naviConnect.queue.lengthHours', {
                  hours,
                  minutes: String(minutes).padStart(2, '0'),
              })
            : t('naviConnect.queue.lengthMinutes', { minutes });

    const line = playingFromLine(from);
    const sentence = !line
        ? null
        : 'device' in line
          ? t('naviConnect.queue.playingOn', { device: line.device })
          : t(`naviConnect.queue.kind.${line.kind}`);

    return (
        <div className={styles.root} data-queue-header>
            <div className={styles.from}>
                <div className={styles.fromText}>
                    {from.title && (
                        <>
                            <span className={clsx(styles.caption, styles.fromCaption)}>
                                {t('naviConnect.queue.playingFrom')}
                            </span>
                            <Tooltip label={from.title} multiline openDelay={500} w={320}>
                                <span className={styles.title}>{from.title}</span>
                            </Tooltip>
                            {/* What the queue is, not the autoplay state (B-251): the switch
                                beside it says on / off, so toggling it never adds this line. */}
                            {sentence && (
                                <span className={clsx(styles.caption, styles.sentence)}>
                                    {sentence}
                                </span>
                            )}
                        </>
                    )}
                </div>
                <Switch
                    checked={autoplayOn}
                    classNames={{
                        label: styles.switchLabel,
                        thumb: styles.switchThumb,
                        track: styles.switchTrack,
                    }}
                    label={t('naviConnect.queue.autoplay')}
                    labelPosition="left"
                    onChange={(e) => toggleStationAutoplay(e.currentTarget.checked)}
                    size="sm"
                />
                <ActionIcon
                    aria-label={t('naviConnect.queue.hide')}
                    className={styles.hide}
                    icon="panelRightClose"
                    iconProps={{ size: 'lg' }}
                    onClick={toggleQueue}
                    size="compact-md"
                    tooltip={{ label: t('naviConnect.queue.hide'), position: 'left' }}
                    variant="subtle"
                />
            </div>
            {statusLine && (
                <Tooltip label={statusLine} multiline openDelay={300} w={320}>
                    <span className={styles.status}>{statusLine}</span>
                </Tooltip>
            )}
            {characters.length > 0 && (
                <SegmentedControl
                    className={clsx(styles.segments, styles.characters, {
                        [styles.dimmed]: !autoplayOn,
                    })}
                    classNames={{ label: styles.segmentLabel }}
                    data={characters.map((chip) => {
                        const description = words.characters.find(
                            (row) => row.id === chip,
                        )?.description;
                        const label = words.characterLabel(chip);
                        return {
                            label: description ? (
                                <Tooltip label={description} multiline openDelay={500} w={260}>
                                    <span>{label}</span>
                                </Tooltip>
                            ) : (
                                label
                            ),
                            value: chip,
                        };
                    })}
                    fullWidth
                    onChange={(chip) => {
                        if (chip !== selected) tapStationChip(chip as StationCharacterId);
                    }}
                    value={autoplayOn ? selected : ''}
                    withItemsBorders={false}
                />
            )}
            {/* One row in a short window (R6), two rows otherwise: `display: contents` until then. */}
            <div className={styles.tabsRow}>
                <SegmentedControl
                    className={clsx(styles.segments, styles.tabs)}
                    classNames={{ label: styles.segmentLabel }}
                    data={[
                        { label: t('page.fullscreenPlayer.upNext'), value: 'queue' },
                        { label: t('page.fullscreenPlayer.related'), value: 'related' },
                    ]}
                    fullWidth
                    onChange={(tab) => onTabChange(tab as QueueSheetTab)}
                    value={activeTab}
                    withItemsBorders={false}
                />
                {activeTab === 'queue' && (
                    <div className={styles.countLine}>
                        <span className={styles.count}>
                            {t('naviConnect.queue.songs', { count: size.count })}
                            <span className={styles.length}>, {length}</span>
                        </span>
                        <SearchInput
                            enableHotkey={false}
                            fillContainer
                            onChange={(e) => onSearch(e.target.value)}
                            value={searchTerm}
                        />
                        <QueueActionsMenu
                            actions={actions}
                            listKey={listKey}
                            sections={MENU_SECTIONS}
                        />
                        <Button
                            className={styles.clear}
                            onClick={actions.clearQueue}
                            size="compact-sm"
                            variant="subtle"
                        >
                            {t('common.clear')}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
