import type { RefObject } from 'react';
import type ReactPlayer from 'react-player';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

// navi-connect (B-138): what a media error does is decided in retry-decision.ts.
import {
    afterFailedTrack,
    atItsTurn,
    retryDecision,
    retryStillApplies,
    whenToActOnError,
} from '/@/renderer/features/player/audio-player/engine/retry-decision';
import { AudioPlayer, PlayerOnProgressProps } from '/@/renderer/features/player/audio-player/types';
import { convertToLogVolume } from '/@/renderer/features/player/audio-player/utils/player-utils';
import { setEngineSeekProbe } from '/@/renderer/features/player/hooks/startup-seek';
import { logger } from '/@/renderer/utils/logger';
import { PlayerStatus } from '/@/shared/types/types';

export interface WebPlayerEngineHandle extends AudioPlayer {
    player1(): {
        ref: null | ReactPlayer;
        setVolume: (volume: number) => void;
    };
    player2(): {
        ref: null | ReactPlayer;
        setVolume: (volume: number) => void;
    };
}

interface WebPlayerEngineProps {
    isMuted: boolean;
    isTransitioning: boolean;
    loopPlayer1: boolean;
    loopPlayer2: boolean;
    /**
     * B-349: the current song's element is ready. Only the queue's player passes it (the startup
     * seek is the queue's); the radio player renders this engine too and passes nothing.
     */
    onCurrentReady?: () => void;
    onEndedPlayer1: () => void;
    onEndedPlayer2: () => void;
    onErrorPause: () => void;
    onProgressPlayer1: (e: PlayerOnProgressProps) => void;
    onProgressPlayer2: (e: PlayerOnProgressProps) => void;
    onStartedPlayer1: (player: ReactPlayer) => void;
    onStartedPlayer2: (player: ReactPlayer) => void;
    playerNum: number;
    playerRef: RefObject<null | WebPlayerEngineHandle>;
    playerStatus: PlayerStatus;
    preservesPitch: boolean;
    speed?: number;
    src1: string | undefined;
    src2: string | undefined;
    volume: number;
    // navi-connect (B-138): the queue's next automatic track is the current one (repeat-one, or a
    // one-track repeat-all).
    wouldReplaySameTrack?: () => boolean;
}

// navi-connect (B-138): MAX_NETWORK_RETRIES moved to retry-decision.ts.
const NETWORK_RETRY_DELAY_MS = 2000;

// Store volume is 0-100; clamp the normalized result so HTMLMediaElement.volume
// never receives a value outside [0, 1] (throws IndexSizeError in some engines)
const normalizeVolume = (volume: number) => {
    return Math.min(1, Math.max(0, volume / 100 || 0));
};

// Credits: https://gist.github.com/novwhisky/8a1a0168b94f3b6abfaa?permalink_comment_id=1551393#gistcomment-1551393
// This is used so that the player will always have an <audio> element. This means that
// player1Source and player2Source are connected BEFORE the user presses play for
// the first time. This workaround is important for Safari, which seems to require the
// source to be connected PRIOR to resuming audio context
const EMPTY_SOURCE =
    'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV';

export const WebPlayerEngine = (props: WebPlayerEngineProps) => {
    const {
        isMuted,
        isTransitioning,
        loopPlayer1,
        loopPlayer2,
        onCurrentReady,
        onEndedPlayer1,
        onEndedPlayer2,
        onErrorPause,
        onProgressPlayer1,
        onProgressPlayer2,
        onStartedPlayer1,
        onStartedPlayer2,
        playerNum,
        playerRef,
        playerStatus,
        preservesPitch,
        speed,
        src1,
        src2,
        volume,
        wouldReplaySameTrack, // navi-connect (B-138)
    } = props;

    const player1Ref = useRef<null | ReactPlayer>(null);
    const player2Ref = useRef<null | ReactPlayer>(null);
    const networkRetryCount1 = useRef(0);
    const networkRetryCount2 = useRef(0);
    // navi-connect (B-138): failed tracks in a row; the MediaErrors already acted on (an element
    // keeps its MediaError until it loads another source, so that object IS the failure, and it
    // cannot outlive its track); which element is current and whether the player plays, read
    // by event handlers and timers; and the last (element, playing) pair a render saw.
    const failedInARow = useRef(0);
    const handledErrors = useRef(new WeakSet<MediaError>());
    const playerNumRef = useRef(playerNum);
    playerNumRef.current = playerNum;
    const isPlayingRef = useRef(playerStatus === PlayerStatus.PLAYING);
    isPlayingRef.current = playerStatus === PlayerStatus.PLAYING;
    const lastTurn = useRef('');
    const [ReactPlayerComponent, setReactPlayerComponent] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const loadReactPlayer = async () => {
            try {
                const module = await import('react-player');
                if (isMounted) {
                    setReactPlayerComponent(() => module.default);
                    setIsLoading(false);
                }
            } catch (error) {
                console.error('Failed to load react-player:', error);
                setIsLoading(false);
            }
        };

        loadReactPlayer();

        return () => {
            isMounted = false;
        };
    }, []);

    const [internalVolume1, setInternalVolume1] = useState(() => normalizeVolume(volume));
    const [internalVolume2, setInternalVolume2] = useState(() => normalizeVolume(volume));

    useImperativeHandle<WebPlayerEngineHandle, WebPlayerEngineHandle>(playerRef, () => ({
        decreaseVolume(by: number) {
            setInternalVolume1(Math.max(0, internalVolume1 - by / 100));
            setInternalVolume2(Math.max(0, internalVolume2 - by / 100));
        },
        increaseVolume(by: number) {
            setInternalVolume1(Math.min(1, internalVolume1 + by / 100));
            setInternalVolume2(Math.min(1, internalVolume2 + by / 100));
        },
        pause() {
            player1Ref.current?.getInternalPlayer()?.pause();
            player2Ref.current?.getInternalPlayer()?.pause();
        },
        play() {
            player1Ref.current?.getInternalPlayer()?.pause();
            player2Ref.current?.getInternalPlayer()?.pause();
            if (playerNum === 1) {
                player1Ref.current?.getInternalPlayer()?.play();
            } else {
                player2Ref.current?.getInternalPlayer()?.play();
            }
        },
        player1() {
            return {
                ref: player1Ref?.current,
                setVolume: (volume: number) => setInternalVolume1(normalizeVolume(volume)),
            };
        },
        player2() {
            return {
                ref: player2Ref?.current,
                setVolume: (volume: number) => setInternalVolume2(normalizeVolume(volume)),
            };
        },
        seekTo(seekTo: number) {
            let type: 'fraction' | 'seconds' | undefined = undefined;

            if (seekTo < 1) {
                type = 'seconds';
            }

            playerNum === 1
                ? player1Ref.current?.seekTo(seekTo, type)
                : player2Ref.current?.seekTo(seekTo, type);
        },
        setVolume(volume: number) {
            setInternalVolume1(normalizeVolume(volume));
            setInternalVolume2(normalizeVolume(volume));
        },
        setVolume1(volume: number) {
            setInternalVolume1(normalizeVolume(volume));
        },
        setVolume2(volume: number) {
            setInternalVolume2(normalizeVolume(volume));
        },
    }));

    const volume1 = convertToLogVolume(internalVolume1);
    const volume2 = convertToLogVolume(internalVolume2);

    const pauseBothPlayers = useCallback(() => {
        player1Ref.current?.getInternalPlayer()?.pause();
        player2Ref.current?.getInternalPlayer()?.pause();
    }, []);

    const mediaErrorLabel = (code: number | undefined) => {
        switch (code) {
            case MediaError.MEDIA_ERR_ABORTED:
                return 'ABORTED';
            case MediaError.MEDIA_ERR_DECODE:
                return 'DECODE';
            case MediaError.MEDIA_ERR_NETWORK:
                return 'NETWORK';
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                return 'SRC_NOT_SUPPORTED';
            default:
                return 'unknown';
        }
    };

    // navi-connect (B-138): upstream's handleOnError body, split out so a failure left for later
    // (it came while preloading, or while not playing) is acted on by the effect below.
    // What each error code does: see retry-decision.ts.
    const actOnError = (
        which: 1 | 2,
        audio: HTMLAudioElement,
        code: number | undefined,
        onEnded: () => void,
        networkRetryCountRef: React.RefObject<number>,
    ) => {
        const label = mediaErrorLabel(code);
        const position = audio.currentTime;
        const mediaError = audio.error;
        const decision = retryDecision(code, networkRetryCountRef.current, position);

        if (decision.action === 'ignore') {
            return;
        }

        if (decision.action === 'retry') {
            networkRetryCountRef.current += 1;
            logger.warn('Playback error, retrying', {
                code,
                label,
                resumeAt: decision.resumeAt,
                retryCount: networkRetryCountRef.current,
            });
            const failedSrc = audio.src;
            // The track changed during the wait, or this element is no longer the playing one:
            // the retry (and its seek) is not for what is playing now.
            const stillApplies = () =>
                retryStillApplies({
                    failedOn: which,
                    failedSrc,
                    playingNow: playerNumRef.current,
                    srcNow: audio.src,
                });
            setTimeout(() => {
                if (!stillApplies()) return;
                if (!isPlayingRef.current) {
                    // Paused during the wait: no play nobody asked for. A later play retries.
                    if (mediaError) handledErrors.current.delete(mediaError);
                    return;
                }
                pauseBothPlayers();
                if (decision.resumeAt > 0) {
                    audio.addEventListener(
                        'loadedmetadata',
                        () => {
                            // A listener left by a retry that failed again must not seek
                            // the next track loaded into this element.
                            if (
                                stillApplies() &&
                                Number.isFinite(audio.duration) &&
                                decision.resumeAt < audio.duration
                            ) {
                                audio.currentTime = decision.resumeAt;
                            }
                        },
                        { once: true },
                    );
                }
                audio.load();
                audio.play().catch(() => {
                    logger.error('Playback error, retries exhausted', {
                        code,
                        label,
                        retryCount: networkRetryCountRef.current,
                    });
                });
            }, NETWORK_RETRY_DELAY_MS);
            return;
        }

        pauseBothPlayers();

        if (decision.action === 'skip') {
            failedInARow.current += 1;
            const replaysSame = wouldReplaySameTrack?.() ?? false;
            const next = afterFailedTrack(failedInARow.current, replaysSame);
            if (next === 'skip') {
                logger.error('Playback error, skipping track', {
                    code,
                    failedInARow: failedInARow.current,
                    label,
                    position,
                });
                onEnded();
                return;
            }
            logger.error('Playback error, pausing instead of skipping', {
                code,
                failedInARow: failedInARow.current,
                label,
                position,
                replaysSameTrack: replaysSame,
            });
        } else {
            logger.error('Playback error, pausing', {
                code,
                label,
                retryCount: networkRetryCountRef.current,
            });
        }

        if (onErrorPause) {
            onErrorPause();
        }
    };

    // navi-connect (B-138): `which` element. A failure on the element preloading the next track,
    // or while the player is not playing, is left on the element for the effect below.
    const handleOnError = (
        which: 1 | 2,
        playerRef: React.RefObject<null | ReactPlayer>,
        onEnded: () => void,
        networkRetryCountRef: React.RefObject<number>,
    ) => {
        return ({ target }: ErrorEvent) => {
            const { current: player } = playerRef;

            if (!player || !(target instanceof Audio) || target.src === EMPTY_SOURCE) {
                return;
            }

            const code = target.error?.code;
            const when = whenToActOnError({
                isCurrent: which === playerNumRef.current,
                isPlaying: isPlayingRef.current,
            });

            if (when === 'at-its-turn') {
                logger.warn('Next track failed to load, handled at its turn', {
                    code,
                    label: mediaErrorLabel(code),
                });
                return;
            }

            if (when === 'when-played') {
                logger.warn('Playback error while not playing, handled at the next play', {
                    code,
                    label: mediaErrorLabel(code),
                });
                return;
            }

            if (target.error) handledErrors.current.add(target.error);
            actOnError(which, target, code, onEnded, networkRetryCountRef);
        };
    };

    // navi-connect (B-138): after every render, the playing element: a failure left on it (it
    // came while preloading or while not playing) is acted on once the player plays, and a
    // loaded track whose turn just started is played if react-player left it paused. See
    // atItsTurn in retry-decision.ts.
    useEffect(() => {
        const which = playerNum === 2 ? 2 : 1;
        const isPlaying = playerStatus === PlayerStatus.PLAYING;
        const turn = `${which}:${isPlaying}`;
        const turnStarted = lastTurn.current !== turn;
        lastTurn.current = turn;

        const audio = (which === 1 ? player1Ref : player2Ref).current?.getInternalPlayer();
        if (!(audio instanceof HTMLAudioElement)) return;
        const error = audio.error;
        const action = atItsTurn({
            errorCode: error?.code,
            errorHandled: error ? handledErrors.current.has(error) : false,
            hasSource: Boolean(which === 1 ? src1 : src2) && audio.src !== EMPTY_SOURCE,
            isPlaying,
            paused: audio.paused,
            readyState: audio.readyState,
            turnStarted,
        });

        if (action === 'act-on-error' && error) {
            handledErrors.current.add(error);
            actOnError(
                which,
                audio,
                error.code,
                which === 1 ? onEndedPlayer1 : onEndedPlayer2,
                which === 1 ? networkRetryCount1 : networkRetryCount2,
            );
        } else if (action === 'play') {
            logger.debug('Playing the track whose turn started paused', { which });
            audio.play().catch(() => {});
        }
    });

    // navi-connect (B-138): a track heard playing ends a run of failed tracks.
    const handleOnPlaying = useCallback(() => {
        failedInARow.current = 0;
    }, []);

    useEffect(() => {
        networkRetryCount1.current = 0;
        networkRetryCount2.current = 0;
    }, [src1, src2]);

    // When not playing, always pause both players — even during a transition
    useEffect(() => {
        if (playerStatus !== PlayerStatus.PLAYING) {
            pauseBothPlayers();
            return;
        }
        if (isTransitioning) {
            return;
        }
        if (playerNum === 1) {
            player2Ref.current?.getInternalPlayer()?.pause();
        } else {
            player1Ref.current?.getInternalPlayer()?.pause();
        }
    }, [isTransitioning, playerNum, playerStatus, pauseBothPlayers]);

    useEffect(() => {
        const player1 = player1Ref.current?.getInternalPlayer();
        if (player1 && player1 instanceof HTMLAudioElement) {
            player1.preservesPitch = preservesPitch;
        }
        const player2 = player2Ref.current?.getInternalPlayer();
        if (player2 && player2 instanceof HTMLAudioElement) {
            player2.preservesPitch = preservesPitch;
        }
    }, [preservesPitch]);

    // navi-connect (B-339): whether a seek sent now reaches the playing element. Before its
    // react-player has mounted and reported ready, `seekTo` goes to a null ref and is dropped, so
    // the hub's adopt at a fresh start leaves the startup seek to carry its position instead.
    // ready1/ready2 mean "this element reported ready at least once", not "ready for its current
    // src": like react-player 2's own isReady, they are not reset on a src change, so after a track
    // change a seek goes to the element directly, before the new source's canplay, as before.
    const ready1 = useRef(false);
    const ready2 = useRef(false);
    useEffect(() => {
        setEngineSeekProbe(() => {
            const which = playerNumRef.current === 2 ? 2 : 1;
            const ref = which === 2 ? player2Ref : player1Ref;
            return (
                (which === 2 ? ready2 : ready1).current && Boolean(ref.current?.getInternalPlayer())
            );
        });
        return () => setEngineSeekProbe(null);
    }, []);

    const handleOnReadyPlayer1 = useCallback(
        (player: ReactPlayer) => {
            ready1.current = true; // navi-connect (B-339)
            const internal = player.getInternalPlayer();
            if (internal && internal instanceof HTMLAudioElement) {
                internal.preservesPitch = preservesPitch;
            }
            onStartedPlayer1(player);
            // B-349: the current song's element is up; the startup seek lands before play().
            if (playerNumRef.current === 1) onCurrentReady?.();
        },
        [onCurrentReady, onStartedPlayer1, preservesPitch],
    );

    const handleOnReadyPlayer2 = useCallback(
        (player: ReactPlayer) => {
            ready2.current = true; // navi-connect (B-339)
            const internal = player.getInternalPlayer();
            if (internal && internal instanceof HTMLAudioElement) {
                internal.preservesPitch = preservesPitch;
            }
            onStartedPlayer2(player);
            // B-349: the current song's element is up; the startup seek lands before play().
            if (playerNumRef.current === 2) onCurrentReady?.();
        },
        [onCurrentReady, onStartedPlayer2, preservesPitch],
    );

    if (isLoading || !ReactPlayerComponent) {
        return <div id="web-player-engine" style={{ display: 'none' }} />;
    }

    return (
        <div id="web-player-engine" style={{ display: 'none' }}>
            <ReactPlayerComponent
                config={{
                    file: { attributes: { crossOrigin: 'anonymous' }, forceAudio: true },
                }}
                controls={false}
                height={0}
                id="web-player-1"
                loop={loopPlayer1}
                muted={isMuted}
                onBufferEnd={handleOnPlaying} // navi-connect (B-138)
                onEnded={src1 && !loopPlayer1 ? () => onEndedPlayer1() : undefined}
                // navi-connect (B-138)
                onError={handleOnError(1, player1Ref, () => onEndedPlayer1(), networkRetryCount1)}
                onProgress={onProgressPlayer1}
                onReady={handleOnReadyPlayer1}
                playbackRate={speed || 1}
                playing={playerNum === 1 && playerStatus === PlayerStatus.PLAYING}
                progressInterval={isTransitioning ? 10 : 250}
                ref={player1Ref}
                url={src1 || EMPTY_SOURCE}
                volume={volume1}
                width={0}
            />
            <ReactPlayerComponent
                config={{
                    file: { attributes: { crossOrigin: 'anonymous' }, forceAudio: true },
                }}
                controls={false}
                height={0}
                id="web-player-2"
                loop={loopPlayer2}
                muted={isMuted}
                onBufferEnd={handleOnPlaying} // navi-connect (B-138)
                onEnded={src2 && !loopPlayer2 ? () => onEndedPlayer2() : undefined}
                // navi-connect (B-138)
                onError={handleOnError(2, player2Ref, () => onEndedPlayer2(), networkRetryCount2)}
                onProgress={onProgressPlayer2}
                onReady={handleOnReadyPlayer2}
                playbackRate={speed || 1}
                playing={playerNum === 2 && playerStatus === PlayerStatus.PLAYING}
                progressInterval={isTransitioning ? 10 : 250}
                ref={player2Ref}
                url={src2 || EMPTY_SOURCE}
                volume={volume2}
                width={0}
            />
        </div>
    );
};

WebPlayerEngine.displayName = 'WebPlayerEngine';
