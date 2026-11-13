import { isAxiosError } from 'axios';
import isElectron from 'is-electron';
import debounce from 'lodash/debounce';
import isEqual from 'lodash/isEqual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from '/@/renderer/api';
import { controller } from '/@/renderer/api/controller';
import { probeNativeSession } from '/@/renderer/api/navidrome/navidrome-api';
import { askForPasswordAgain } from '/@/renderer/api/utils';
import { AppRoute } from '/@/renderer/router/routes';
import {
    getServerById,
    useAuthStore,
    useAuthStoreActions,
    useCurrentServerId,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import { toast } from '/@/shared/components/toast/toast';
import { ServerType } from '/@/shared/types/domain-types';
import { AuthState } from '/@/shared/types/types';
import { nativeProbeVerdict, signInKey, whenSessionRefused } from '/@/shared/utils/saved-password';

const localSettings = isElectron() ? window.api.localSettings : null;

const MIN_AUTH_DELAY_MS = 1000;
const MAX_NETWORK_RETRIES = 1;
const NETWORK_RETRY_DELAY_MS = 500;

const isNetworkError = (error: any): boolean => {
    const message =
        error.message && typeof error.message === 'string' ? (error.message as string) : null;
    const messageLower = message?.toLowerCase();

    if (messageLower?.includes('network') || messageLower?.includes('timeout')) {
        return true;
    }

    return (
        isAxiosError(error) &&
        (error.code === 'ERR_NETWORK' ||
            error.code === 'ECONNABORTED' ||
            error.code === 'ETIMEDOUT' ||
            !navigator.onLine)
    );
};

export const useServerAuthenticated = () => {
    const priorServerId = useRef<string | undefined>(undefined);
    const serverId = useCurrentServerId();
    const [ready, setReady] = useState(AuthState.LOADING);
    const navigate = useNavigate();
    const navigateRef = useRef(navigate);
    const retryCountRef = useRef<number>(0);
    // B-400: the server and sign-in the password was asked for; a different sign-in of that
    // server (the form signed in) is checked again. Another server is the effect below's.
    const askedSignIn = useRef<null | { id: string; signIn: string }>(null);
    const currentSignIn = useAuthStore((state) =>
        state.currentServer ? signInKey(state.currentServer) : null,
    );

    const { setCurrentServer, updateServer } = useAuthStoreActions();

    useEffect(() => {
        navigateRef.current = navigate;
    }, [navigate]);

    const authenticateServer = useCallback(
        async (serverWithAuth: NonNullable<ReturnType<typeof getServerById>>, retryAttempt = 0) => {
            const authStartTime = Date.now();

            try {
                setReady(AuthState.LOADING);

                // Use userId if available, otherwise fall back to username (for Subsonic/Navidrome)
                const userId = serverWithAuth.userId || serverWithAuth.username;

                if (!userId) {
                    throw new Error('No user ID or username available');
                }

                // First, try getUserInfo to check if current credentials are still valid
                logger.info('Authenticating server', {
                    method: 'getUserInfo',
                    serverId: serverWithAuth.id,
                    serverName: serverWithAuth.name,
                    serverType: serverWithAuth.type,
                });

                try {
                    const userInfo = await api.controller.getUserInfo({
                        apiClientProps: {
                            serverId: serverWithAuth.id,
                        },
                        query: {
                            id: userId,
                            username: serverWithAuth.username,
                        },
                    });

                    if (!userInfo) {
                        throw new Error('Failed to get user info');
                    }

                    // B-400: getUserInfo asks the Subsonic API, whose token outlives Navidrome's own
                    // session; the library pages use the latter. Ask it once (review M3: not the
                    // token's expiry against this clock); a refusal is handled below like a 401,
                    // before anything is mounted.
                    if (
                        serverWithAuth.type === ServerType.NAVIDROME &&
                        nativeProbeVerdict(await probeNativeSession(serverWithAuth)) === 'refused'
                    ) {
                        throw Object.assign(
                            new Error('Unauthorized: Navidrome refused the session'),
                            { response: { status: 401 } },
                        );
                    }

                    // Update server with user info (in case isAdmin changed)
                    updateServer(serverWithAuth.id, {
                        isAdmin: userInfo.isAdmin,
                    });

                    // Fetch and update server version and features
                    try {
                        const serverInfo = await controller.getServerInfo({
                            apiClientProps: {
                                serverId: serverWithAuth.id,
                            },
                        });

                        if (serverInfo && serverInfo.id === serverWithAuth.id) {
                            const { features, version } = serverInfo;
                            const currentServer = getServerById(serverWithAuth.id);

                            if (
                                currentServer &&
                                (version !== currentServer.version ||
                                    !isEqual(features, currentServer.features))
                            ) {
                                updateServer(serverWithAuth.id, {
                                    features,
                                    version,
                                });
                            }
                        }
                    } catch (serverInfoError) {
                        // Log but don't fail authentication if server info fetch fails
                        logger.warn('Server info fetch failed after auth', {
                            action: 'server_info_fetch_failed',
                            error: (serverInfoError as Error).message,
                            serverId: serverWithAuth.id,
                            serverName: serverWithAuth.name,
                        });
                    }

                    logger.info('Server authentication successful', {
                        isAdmin: userInfo.isAdmin,
                        method: 'getUserInfo',
                        serverId: serverWithAuth.id,
                        serverName: serverWithAuth.name,
                        serverType: serverWithAuth.type,
                        userId: userInfo.id,
                    });

                    const elapsedTime = Date.now() - authStartTime;
                    const remainingDelay = Math.max(0, MIN_AUTH_DELAY_MS - elapsedTime);

                    if (remainingDelay > 0) {
                        await new Promise((resolve) => setTimeout(resolve, remainingDelay));
                    }

                    setReady(AuthState.VALID);
                    return;
                } catch (getUserInfoError: any) {
                    // Check if it's a forbidden/authentication error (401 or 403)
                    const isForbiddenError =
                        getUserInfoError?.response?.status === 401 ||
                        getUserInfoError?.response?.status === 403 ||
                        getUserInfoError?.message?.toLowerCase().includes('forbidden') ||
                        getUserInfoError?.message?.toLowerCase().includes('unauthorized');

                    // Only reauthenticate if it's a forbidden error AND password is saved
                    if (isForbiddenError && serverWithAuth.savePassword && localSettings) {
                        const saved = await localSettings.passwordRead(serverWithAuth.id);
                        const step = whenSessionRefused(saved);

                        if (step === 'askAgain') {
                            // B-338: a password this computer cannot read is not a refused one.
                            // Ask for it; the server stays current (no logout, no Worbus Server
                            // sign-out) and the saved password is kept.
                            logger.warn('Server authentication needs the password again', {
                                reason: 'saved password unreadable',
                                serverId: serverWithAuth.id,
                            });
                            askForPasswordAgain(serverWithAuth);
                            // B-400: not INVALID, which mounts the library under the refused
                            // session; the sign-in the form writes is checked again (below).
                            askedSignIn.current = {
                                id: serverWithAuth.id,
                                signIn: signInKey(serverWithAuth),
                            };
                            setReady(AuthState.PASSWORD_NEEDED);
                            return;
                        }

                        if (saved.kind === 'ok') {
                            const { password } = saved;
                            logger.info('Authenticating server', {
                                method: 'authenticate',
                                reason: 'getUserInfo failed with forbidden error',
                                serverId: serverWithAuth.id,
                                serverName: serverWithAuth.name,
                                serverType: serverWithAuth.type,
                                url: serverWithAuth.url,
                            });

                            // Authenticate using the API controller
                            const authData = await api.controller.authenticate(
                                serverWithAuth.url,
                                {
                                    legacy: false,
                                    password,
                                    username: serverWithAuth.username,
                                },
                                serverWithAuth.type,
                            );

                            if (!authData) {
                                throw new Error('Authentication failed: No data returned');
                            }

                            // Update server with new credentials
                            const updatedServer = {
                                credential: authData.credential,
                                isAdmin: authData.isAdmin,
                                userId: authData.userId,
                                username: authData.username,
                                ...(authData.ndCredential !== undefined && {
                                    ndCredential: authData.ndCredential,
                                }),
                            };

                            updateServer(serverWithAuth.id, updatedServer);

                            // Fetch and update server version and features
                            try {
                                const serverInfo = await controller.getServerInfo({
                                    apiClientProps: {
                                        serverId: serverWithAuth.id,
                                    },
                                });

                                if (serverInfo && serverInfo.id === serverWithAuth.id) {
                                    const { features, version } = serverInfo;
                                    const currentServer = getServerById(serverWithAuth.id);

                                    if (
                                        currentServer &&
                                        (version !== currentServer.version ||
                                            !isEqual(features, currentServer.features))
                                    ) {
                                        updateServer(serverWithAuth.id, {
                                            features,
                                            version,
                                        });
                                    }
                                }
                            } catch (serverInfoError) {
                                // Log but don't fail authentication if server info fetch fails
                                logger.warn('Server info fetch failed after auth', {
                                    action: 'server_info_fetch_failed',
                                    error: (serverInfoError as Error).message,
                                    serverId: serverWithAuth.id,
                                    serverName: serverWithAuth.name,
                                });
                            }

                            logger.info('Server authentication successful', {
                                isAdmin: authData.isAdmin,
                                method: 'authenticate',
                                serverId: serverWithAuth.id,
                                serverName: serverWithAuth.name,
                                serverType: serverWithAuth.type,
                                userId: authData.userId,
                                username: authData.username,
                            });

                            // Ensure minimum delay before completing authentication
                            const elapsedTime = Date.now() - authStartTime;
                            const remainingDelay = Math.max(0, MIN_AUTH_DELAY_MS - elapsedTime);

                            if (remainingDelay > 0) {
                                await new Promise((resolve) => setTimeout(resolve, remainingDelay));
                            }

                            setReady(AuthState.VALID);
                            return;
                        }
                    }

                    // If not a forbidden error, or no password saved, rethrow the error
                    throw getUserInfoError;
                }
            } catch (error) {
                const errorMessage = (error as Error).message || 'Authentication failed';
                const isNetwork = isNetworkError(error);

                // If it's a network error and we haven't exhausted retries, retry
                if (isNetwork && retryAttempt < MAX_NETWORK_RETRIES) {
                    const nextRetry = retryAttempt + 1;

                    logger.warn('Server authentication failed', {
                        action: 'network_error_retry',
                        attempt: nextRetry,
                        error: errorMessage,
                        maxRetries: MAX_NETWORK_RETRIES,
                        retryDelayMs: NETWORK_RETRY_DELAY_MS,
                        serverId: serverWithAuth.id,
                        serverName: serverWithAuth.name,
                        serverType: serverWithAuth.type,
                    });

                    // Wait before retrying
                    await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS));

                    // Retry authentication
                    // eslint-disable-next-line react-hooks/immutability
                    return authenticateServer(serverWithAuth, nextRetry);
                }

                // If network error and retries exhausted, redirect to no-network page
                if (isNetwork && retryAttempt >= MAX_NETWORK_RETRIES) {
                    logger.error('Server authentication failed', {
                        action: 'network_error_max_retries_exceeded',
                        attempts: retryAttempt + 1,
                        error: errorMessage,
                        serverId: serverWithAuth.id,
                        serverName: serverWithAuth.name,
                        serverType: serverWithAuth.type,
                    });

                    // Don't clear credentials on network failure - preserve them for when network returns
                    setReady(AuthState.INVALID);
                    navigateRef.current(AppRoute.NO_NETWORK, { replace: true });
                    return;
                }

                // For non-network errors, handle normally
                logger.error('Server authentication failed', {
                    error: errorMessage,
                    serverId: serverWithAuth.id,
                    serverName: serverWithAuth.name,
                    serverType: serverWithAuth.type,
                });

                // Clear server credentials and saved password on failure
                if (serverWithAuth.savePassword && localSettings) {
                    localSettings.passwordRemove(serverWithAuth.id);
                }

                toast.error({
                    message: errorMessage,
                });

                // Log the user out by setting current server to null
                setCurrentServer(null);
                setReady(AuthState.INVALID);
            }
        },
        [updateServer, setCurrentServer],
    );

    const debouncedAuth = useMemo(
        () =>
            debounce((serverWithAuth: NonNullable<ReturnType<typeof getServerById>>) => {
                authenticateServer(serverWithAuth).catch(console.error);
            }, 300),
        [authenticateServer],
    );

    useEffect(() => {
        if (!serverId) {
            logger.info('Server authentication invalid', {
                reason: 'No server selected',
            });
            setReady(AuthState.INVALID);
            return;
        }

        if (priorServerId.current !== serverId) {
            const serverWithAuth = getServerById(serverId);
            priorServerId.current = serverId;
            retryCountRef.current = 0; // Reset retry count when server changes

            if (!serverWithAuth) {
                logger.error('Server authentication error', {
                    reason: 'Server not found in store',
                    serverId,
                });
                setReady(AuthState.INVALID);
                return;
            }

            setReady(AuthState.LOADING);
            debouncedAuth(serverWithAuth);
        }
        return () => {
            debouncedAuth.cancel();
        };
    }, [debouncedAuth, serverId]);

    // B-400: the password was asked for and that server's sign-in has changed since (the form
    // signed in): check it, as at start.
    useEffect(() => {
        const asked = askedSignIn.current;
        if (ready !== AuthState.PASSWORD_NEEDED || !asked || !currentSignIn) return;
        if (asked.id !== serverId || currentSignIn === asked.signIn) return;
        const serverWithAuth = getServerById(serverId);
        if (!serverWithAuth) return;
        askedSignIn.current = null;
        authenticateServer(serverWithAuth).catch(console.error);
    }, [authenticateServer, currentSignIn, ready, serverId]);

    return ready;
};
