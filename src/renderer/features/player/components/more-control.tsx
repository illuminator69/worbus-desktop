import clsx from 'clsx';
import isElectron from 'is-electron';
import { MouseEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import styles from './more-control.module.css';

import { AutoDjPanel } from '/@/renderer/features/player/components/auto-dj-panel';
import { DlnaCastPanel } from '/@/renderer/features/player/components/dlna-cast-panel';
import { PlaybackOptionsPanel } from '/@/renderer/features/player/components/playback-options-panel';
import { openShuffleAllModal } from '/@/renderer/features/player/components/shuffle-all-modal';
import {
    SleepTimerPanel,
    useSleepTimerValue,
} from '/@/renderer/features/player/components/sleep-timer-panel';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useDlnaCast } from '/@/renderer/features/player/hooks/use-dlna-cast';
import { MoreItemId, moreMenuItems } from '/@/renderer/features/player/utils/more-menu-items';
import { toggleLyrics } from '/@/renderer/features/player/utils/toggle-lyrics';
import {
    useIsRadioActive,
    useRadioControls,
} from '/@/renderer/features/radio/hooks/use-radio-player';
import { AppRoute } from '/@/renderer/router/routes';
import { useSettingsStoreActions } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { AppIconSelection, Icon } from '/@/shared/components/icon/icon';
import { Popover } from '/@/shared/components/popover/popover';

type PanelId = Extract<MoreItemId, 'autoDj' | 'dlna' | 'playbackOptions' | 'sleepTimer'>;
type View = 'list' | PanelId;

const ICONS: Record<MoreItemId, AppIconSelection> = {
    autoDj: 'listInfinite',
    dlna: 'cast',
    equaliser: 'audioLines',
    lyrics: 'microphone',
    playbackOptions: 'mediaSettings',
    playRandom: 'mediaRandom',
    sleepTimer: 'sleepTimer',
    stop: 'mediaStop',
};

// Remix icons are drawn by their fill, which an Icon without one leaves transparent: Play random's
// is one (the transport drew it with `fill="default"`), the rest are stroked.
const FILLED: ReadonlySet<MoreItemId> = new Set(['playRandom']);

// The panels keep the sizes they had in their own popovers.
const WIDTHS: Record<View, { maw?: number; miw: number }> = {
    autoDj: { maw: 480, miw: 320 },
    dlna: { miw: 340 },
    list: { miw: 240 },
    playbackOptions: { maw: 720, miw: 540 },
    sleepTimer: { maw: 480, miw: 320 },
};

const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * The player bar's More button: the controls used too rarely to sit on the bar (F1). A list of
 * rows; a panel row turns the same popover into that control's panel, with a way back. Escape
 * goes back to the list first, then closes.
 */
export const MoreControl = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { setSettings } = useSettingsStoreActions();
    const { mediaStop } = usePlayer();
    const isRadioActive = useIsRadioActive();
    const { stop: stopRadio } = useRadioControls();
    const [opened, setOpened] = useState(false);
    const [view, setViewState] = useState<View>('list');
    // Which way the last move between the list and a panel went, so the new view slides in from
    // that side. Null when More has just opened: the popover's own transition covers that.
    const [direction, setDirection] = useState<'back' | 'forward' | null>(null);
    const setView = useCallback((next: View) => {
        setDirection(next === 'list' ? 'back' : 'forward');
        setViewState(next);
    }, []);

    const close = useCallback(() => {
        setOpened(false);
        setViewState('list');
        setDirection(null);
    }, []);

    // Mounted whether or not More is open: DLNA discovery and group events keep arriving.
    const dlna = useDlnaCast(opened && view === 'dlna', close);
    const sleepTimerValue = useSleepTimerValue();

    const values: Partial<Record<MoreItemId, null | string>> = {
        dlna: dlna.isConnected ? dlna.connectedDeviceName : null,
        sleepTimer: sleepTimerValue,
    };

    const openPanel = (panel: PanelId) => {
        if (panel === 'dlna') dlna.onOpen();
        setView(panel);
    };

    useEffect(() => {
        if (!opened) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (view === 'list') {
                setOpened(false);
            } else {
                e.stopPropagation();
                setView('list');
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [opened, setView, view]);

    const labels: Record<MoreItemId, string> = {
        autoDj: t('setting.autoDJ'),
        dlna: t('player.castToTv'),
        equaliser: t('setting.equalizer'),
        lyrics: t('player.lyrics'),
        playbackOptions: t('player.playbackOptions'),
        playRandom: t('form.shuffleAll.title'),
        sleepTimer: t('player.sleepTimer'),
        stop: t('player.stopPlayback'),
    };

    const act = (id: MoreItemId) => {
        switch (id) {
            case 'equaliser':
                setSettings({ tab: 'playback' });
                navigate(AppRoute.SETTINGS);
                break;
            case 'lyrics':
                toggleLyrics();
                break;
            case 'playRandom':
                openShuffleAllModal();
                break;
            case 'stop':
                if (isRadioActive) stopRadio();
                else mediaStop();
                break;
        }
        close();
    };

    const items = moreMenuItems({ isElectron: isElectron(), isRadioActive });

    const renderPanel = (panel: PanelId): ReactNode => {
        switch (panel) {
            case 'autoDj':
                return <AutoDjPanel />;
            case 'dlna':
                return <DlnaCastPanel {...dlna} />;
            case 'playbackOptions':
                return <PlaybackOptionsPanel />;
            case 'sleepTimer':
                return <SleepTimerPanel onClose={close} />;
        }
    };

    return (
        <Popover
            closeOnEscape={false}
            onChange={(next) => (next ? setOpened(true) : close())}
            opened={opened}
            position="top-end"
            trapFocus
        >
            <Popover.Target>
                <ActionIcon
                    aria-label={t('player.moreControls')}
                    icon="ellipsisHorizontal"
                    iconProps={{ size: 'lg' }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (opened) close();
                        else setOpened(true);
                    }}
                    size="sm"
                    tooltip={{ disabled: opened, label: t('player.moreControls'), openDelay: 0 }}
                    variant="subtle"
                />
            </Popover.Target>
            <Popover.Dropdown maw={WIDTHS[view].maw} miw={WIDTHS[view].miw} onClick={stop} p="xs">
                <div
                    className={clsx(
                        direction === 'forward' && styles.enterForward,
                        direction === 'back' && styles.enterBack,
                    )}
                    key={view}
                >
                    {view === 'list' ? (
                        <div className={styles.list} role="menu">
                            {items.map((item) => (
                                <div key={item.id}>
                                    {item.separatorBefore && <div className={styles.separator} />}
                                    <button
                                        className={styles.row}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (item.kind === 'panel')
                                                openPanel(item.id as PanelId);
                                            else act(item.id);
                                        }}
                                        role="menuitem"
                                        type="button"
                                    >
                                        <Icon
                                            fill={FILLED.has(item.id) ? 'default' : undefined}
                                            icon={ICONS[item.id]}
                                        />
                                        <span className={styles.label}>{labels[item.id]}</span>
                                        {values[item.id] && (
                                            <span className={styles.value}>{values[item.id]}</span>
                                        )}
                                        {item.kind === 'panel' && (
                                            <Icon className={styles.chevron} icon="arrowRightS" />
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                            <button
                                className={clsx(styles.row, styles.back)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setView('list');
                                }}
                                type="button"
                            >
                                <Icon icon="arrowLeftS" />
                                <span>{t('common.back')}</span>
                            </button>
                            {renderPanel(view)}
                        </>
                    )}
                </div>
            </Popover.Dropdown>
        </Popover>
    );
};
