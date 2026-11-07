import clsx from 'clsx';
import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';
import { shallow } from 'zustand/shallow';

import styles from './left-controls.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { JoinedArtists } from '/@/renderer/features/albums/components/joined-artists';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import {
    useRemoteAwarePlayerSong,
    useRemoteAwareStatus,
} from '/@/renderer/features/hub/hooks/use-remote-aware';
import { RadioMetadataDisplay } from '/@/renderer/features/player/components/radio-metadata-display';
import { FavoriteButton } from '/@/renderer/features/player/components/right-controls';
import {
    useIsRadioActive,
    useRadioPlayer,
} from '/@/renderer/features/radio/hooks/use-radio-player';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import { useSidebarFolded } from '/@/renderer/layouts/default-layout/use-shell-fit';
import { AppRoute } from '/@/renderer/router/routes';
import {
    useAppStore,
    useAppStoreActions,
    useFullScreenPlayerStore,
    useHotkeySettings,
    useHubActiveDeviceName,
    useHubIsRemoteActive,
    useHubStore,
    useSetFullScreenPlayerStore,
    useShowFavorites,
    useSidebarImageEnabled,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Center } from '/@/shared/components/center/center';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Text } from '/@/shared/components/text/text';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { PlaybackSelectors } from '/@/shared/constants/playback-selectors';
import { LibraryItem } from '/@/shared/types/domain-types';
import { PlayerStatus } from '/@/shared/types/types';

export const LeftControls = () => {
    const { t } = useTranslation();
    const { setSideBar } = useAppStoreActions();
    const {
        expanded: isFullScreenPlayerExpanded,
        visualizerExpanded: isFullScreenVisualizerExpanded,
    } = useFullScreenPlayerStore();
    const setFullScreenPlayerStore = useSetFullScreenPlayerStore();

    const { collapsed: sidebarCollapsed, image: sidebarImageShown } = useAppStore(
        (state) => ({
            collapsed: state.sidebar.collapsed,
            image: state.sidebar.image,
        }),
        shallow,
    );

    const currentSong = useRemoteAwarePlayerSong();
    const isRemote = useHubIsRemoteActive();
    const remoteDeviceName = useHubActiveDeviceName();
    // navi-connect: the play state the play button shows. A paused device still holds the
    // session, and the line under the cover must not call that "playing".
    const remoteIsPlaying = useRemoteAwareStatus() === PlayerStatus.PLAYING;
    const remoteIsCast = useHubStore(
        (s) => s.devices.find((d) => d.id === s.activeDeviceId)?.platform === 'chromecast',
    );
    const showFavorites = useShowFavorites();
    // Below the album, in the accent: where the music is, when it is not here.
    const remoteStatus = remoteIsCast
        ? t('player.castingTo', { device: remoteDeviceName })
        : remoteIsPlaying
          ? t('player.playingOnDevice', { device: remoteDeviceName })
          : t('player.pausedOnDevice', { device: remoteDeviceName });
    const isRadioActive = useIsRadioActive();
    const { currentStationArt } = useRadioPlayer();
    const { bindings } = useHotkeySettings();
    const sidebarImageEnabled = useSidebarImageEnabled();

    const isRadioMode = isRadioActive;
    const hasRadioStationImage = Boolean(currentStationArt?.imageId || currentStationArt?.imageUrl);
    // The sidebar shows the cover only when it is not a rail, by the user's flag or a narrow window.
    const sidebarFolded = useSidebarFolded();
    const hideImage =
        !sidebarCollapsed && !sidebarFolded && sidebarImageEnabled && sidebarImageShown;
    const isSongDefined = Boolean(currentSong?.id) && !isRadioMode;
    const title = currentSong?.name;
    const artists = currentSong?.artists;

    const handleToggleFullScreenPlayer = (e?: KeyboardEvent | MouseEvent<HTMLDivElement>) => {
        // don't toggle if right click
        if (e && 'button' in e && e.button === 2) {
            return;
        }

        e?.stopPropagation();

        const shouldClose = isFullScreenPlayerExpanded || isFullScreenVisualizerExpanded;

        if (shouldClose) {
            setFullScreenPlayerStore({
                expanded: false,
                visualizerExpanded: false,
                visualizerReturnToPlayer: false,
            });
        } else {
            setFullScreenPlayerStore({ expanded: true });
        }
    };

    const handleToggleSidebarImage = (e?: MouseEvent<HTMLButtonElement>) => {
        e?.stopPropagation();
        setSideBar({ image: true });
    };

    const handleToggleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        if (!currentSong) {
            return;
        }

        ContextMenuController.call({
            cmd: { items: [currentSong], type: LibraryItem.SONG },
            event: e,
        });
    };

    const stopPropagation = (e?: MouseEvent) => e?.stopPropagation();

    useHotkeys([
        [
            bindings.toggleFullscreenPlayer.allowGlobal
                ? ''
                : bindings.toggleFullscreenPlayer.hotkey,
            handleToggleFullScreenPlayer,
        ],
    ]);

    return (
        <div className={styles.leftControlsContainer}>
            {!hideImage && (
                <div className={styles.imageWrapper}>
                    <div
                        className={styles.image}
                        onClick={handleToggleFullScreenPlayer}
                        onContextMenu={handleToggleContextMenu}
                        role="button"
                    >
                        <Tooltip label={t('player.toggleFullscreenPlayer')}>
                            {isRadioMode && hasRadioStationImage ? (
                                <ItemImage
                                    className={clsx(
                                        styles.playerbarImage,
                                        PlaybackSelectors.playerCoverArt,
                                    )}
                                    enableDebounce={false}
                                    enableViewport={false}
                                    fetchPriority="high"
                                    id={currentStationArt?.imageId ?? undefined}
                                    itemType={LibraryItem.RADIO_STATION}
                                    serverId={currentStationArt?.serverId}
                                    src={currentStationArt?.imageUrl ?? ''}
                                    thumbHash={currentStationArt?.thumbHash ?? null}
                                    type="table"
                                />
                            ) : isRadioMode ? (
                                <Center className={clsx(styles.playerbarImage, styles.radioImage)}>
                                    <Icon color="muted" icon="radio" size="40%" />
                                </Center>
                            ) : (
                                <ItemImage
                                    blurHash={currentSong?.blurHash}
                                    className={clsx(
                                        styles.playerbarImage,
                                        PlaybackSelectors.playerCoverArt,
                                    )}
                                    enableDebounce={false}
                                    enableViewport={false}
                                    explicitStatus={currentSong?.explicitStatus}
                                    fetchPriority="high"
                                    id={currentSong?.imageId}
                                    itemType={LibraryItem.SONG}
                                    serverId={currentSong?._serverId}
                                    src={currentSong?.imageUrl ?? undefined}
                                    thumbHash={currentSong?.thumbHash}
                                    type="table"
                                />
                            )}
                        </Tooltip>
                        {!sidebarCollapsed && sidebarImageEnabled && (
                            <ActionIcon
                                className={styles.toggleButton}
                                icon="arrowUpS"
                                iconProps={{ size: 'xl' }}
                                onClick={handleToggleSidebarImage}
                                opacity={0.8}
                                radius="md"
                                size="xs"
                                tooltip={{
                                    label: t('common.expand'),
                                    openDelay: 0,
                                }}
                            />
                        )}
                    </div>
                </div>
            )}
            <div className={styles.metadataStack}>
                {isRadioMode ? (
                    <RadioMetadataDisplay
                        onStopPropagation={stopPropagation}
                        onToggleContextMenu={handleToggleContextMenu}
                    />
                ) : (
                    <>
                        <div
                            className={clsx(styles.lineItem, styles.titleLine)}
                            onClick={stopPropagation}
                        >
                            <Group align="center" gap={4} wrap="nowrap">
                                <Text
                                    className={PlaybackSelectors.songTitle}
                                    component={Link}
                                    fw={500}
                                    isLink
                                    onContextMenu={handleToggleContextMenu}
                                    overflow="hidden"
                                    title={title}
                                    to={AppRoute.NOW_PLAYING}
                                >
                                    {title || '—'}
                                    {currentSong?.trackSubtitle && (
                                        <Text component="span" isMuted size="sm">
                                            {' ('}
                                            {currentSong.trackSubtitle}
                                            {')'}
                                        </Text>
                                    )}
                                </Text>
                                {isSongDefined && (
                                    <ActionIcon
                                        className={styles.kebab}
                                        icon="ellipsisVertical"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (currentSong) {
                                                ContextMenuController.call({
                                                    cmd: {
                                                        items: [currentSong],
                                                        type: LibraryItem.SONG,
                                                    },
                                                    event: e,
                                                });
                                            }
                                        }}
                                        size="xs"
                                        styles={{
                                            root: {
                                                '--ai-size-xs': '1.15rem',
                                            },
                                        }}
                                        variant="subtle"
                                    />
                                )}
                            </Group>
                        </div>
                        <div
                            className={clsx(
                                styles.lineItem,
                                styles.artist,
                                PlaybackSelectors.songArtist,
                            )}
                            onClick={stopPropagation}
                            // Cut to one line like the title and the album (B-253): the full names.
                            title={
                                currentSong?.artistName ||
                                artists?.map((artist) => artist.name).join(', ') ||
                                undefined
                            }
                        >
                            <JoinedArtists
                                artistName={currentSong?.artistName || ''}
                                // Track artists, not album artists — the ids come
                                // from `song.artists`.
                                artistRoute="artist"
                                artists={artists || []}
                                // The artist is drawn in the accent (the owner's way into
                                // a discography).
                                linkProps={{
                                    c: 'primary',
                                    fw: 400,
                                    size: 'md',
                                }}
                                rootTextProps={{
                                    c: 'primary',
                                    className: styles.joinedArtists,
                                    fw: 400,
                                    size: 'md',
                                }}
                            />
                        </div>
                        <div
                            className={clsx(
                                styles.lineItem,
                                styles.secondary,
                                PlaybackSelectors.songAlbum,
                            )}
                            onClick={stopPropagation}
                        >
                            {/* `to=''` is a RELATIVE link, and the playerbar sits in a
                                    pathless layout route whose base is `/` — so with no
                                    album id it resolved to the home page. With no id there
                                    is nothing to navigate to: render plain text. */}
                            <Text
                                component={currentSong?.albumId ? Link : undefined}
                                fw={500}
                                isLink={Boolean(currentSong?.albumId)}
                                overflow="hidden"
                                size="md"
                                title={currentSong?.album || undefined}
                                to={
                                    currentSong?.albumId
                                        ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                                              albumId: currentSong.albumId,
                                          })
                                        : undefined
                                }
                            >
                                {currentSong?.album || '—'}
                            </Text>
                        </div>
                        {isRemote && (
                            <div
                                className={clsx(styles.lineItem, styles.status)}
                                onClick={stopPropagation}
                                title={remoteStatus}
                            >
                                <span aria-hidden className={styles.statusDot} />
                                <span className={styles.statusText}>{remoteStatus}</span>
                            </div>
                        )}
                    </>
                )}
            </div>
            {/* After the song's text, centred on it, where Spotify puts its add button. */}
            {isSongDefined && showFavorites && (
                <div className={styles.favorite} onClick={stopPropagation}>
                    <FavoriteButton />
                </div>
            )}
        </div>
    );
};
