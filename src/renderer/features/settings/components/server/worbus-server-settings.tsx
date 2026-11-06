import { useQuery } from '@tanstack/react-query';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DEFAULT_DEVICE_NAME,
    hostOf,
    resolveDeviceName,
    resolvePublicServerUrl,
} from './hub-fields';
import {
    addressFieldValue,
    capabilityLines,
    CONNECT_GRACE_MS,
    Copy,
    hubLink,
    isHubConfigured,
    normaliseHubAddress,
    notSetView,
    serverStatus,
    serverStatusSentence,
    serverVersionCopy,
    setView,
    showTokenField,
    statusRoute,
    titlesToArrive,
} from './server-status';

import { clapAvailableKey } from '/@/renderer/features/discover/use-discover-capabilities';
import {
    editServer,
    lookIfNotSet,
    lookOnNetwork,
    removeServerAddress,
    stopLooking,
} from '/@/renderer/features/hub/utils/hub-finder-actions';
import {
    signInToFound,
    signInWithCurrentServer,
    signOutOfServer,
} from '/@/renderer/features/hub/utils/hub-signin-actions';
import { useLbBotAvailable } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Fold } from '/@/renderer/features/motion/fold';
import { GrowBox } from '/@/renderer/features/motion/grow-box';
import { useStationMode } from '/@/renderer/features/player/station/station-store';
import { KEYWORDS } from '/@/renderer/features/settings/components/settings-keywords';
import { SettingsSection } from '/@/renderer/features/settings/components/settings-section';
import { useSettingSearchStore } from '/@/renderer/features/settings/store/search.store';
import {
    useAudioMuseSettings,
    useAuthStore,
    useHubSettings,
    useHubStore,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { PasswordInput } from '/@/shared/components/password-input/password-input';
import { Stack } from '/@/shared/components/stack/stack';
import { Switch } from '/@/shared/components/switch/switch';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { displayAddress } from '/@/shared/utils/hub-addresses';
import { parseSubsonicPair } from '/@/shared/utils/hub-signin';

/** A sentence from en.json `setting.worbus.*` (Worbus P3). */
const useSay = () => {
    const { t } = useTranslation();
    return (copy: Copy | null): string =>
        copy ? t(`setting.worbus.${copy.key}`, copy.values ?? {}) : '';
};

/** The current music server's account name, or null when there is no pair to sign in with. */
const useSignInUsername = (): null | string =>
    useAuthStore((s) => parseSubsonicPair(s.currentServer?.credential)?.username ?? null);

/** A clock that ticks once when the "connecting" window ends, so the line can change by itself. */
const useNowAfter = (attemptAt: number, running: boolean): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        setNow(Date.now());
        if (!running) return undefined;
        const wait = attemptAt + CONNECT_GRACE_MS - Date.now() + 50;
        if (wait <= 0) return undefined;
        const timer = setTimeout(() => setNow(Date.now()), wait);
        return () => clearTimeout(timer);
    }, [attemptAt, running]);
    return now;
};

/**
 * The status line and, once connected, one line for each thing the connection offers. Read from
 * state the app already holds; nothing here asks the server anything.
 */
const ServerStatus = memo(() => {
    const settings = useHubSettings();
    const audioMuse = useAudioMuseSettings();
    const connected = useHubStore((s) => s.connected);
    const authRefused = useHubStore((s) => s.authRefused);
    const attemptAt = useHubStore((s) => s.attemptAt);
    const libraryRefused = useHubStore((s) => s.lbRefused);
    const libraryTooOld = useHubStore((s) => s.lbTooOld);
    const speakers = useHubStore((s) => s.devices.filter((d) => d.bridgedBy).length);
    const libraryTools = useLbBotAvailable();
    const stations = useStationMode();
    // Reads the probe's cached answer only (enabled: false): no request is made here. Another
    // screen (Library chips, Discover) runs the probe; until it has, `clap.data` is undefined and
    // the AudioMuse line is left out.
    const clap = useQuery<boolean>({
        enabled: false,
        queryFn: () => Promise.resolve(false),
        queryKey: clapAvailableKey(audioMuse),
    });

    const signedIn = useHubStore((s) => s.authSignedIn);
    const authKnown = useHubStore((s) => s.authKnown);
    const signedOut = useHubStore((s) => s.signedOut);
    const signingIn = useHubStore((s) => s.signingIn);
    const signInResult = useHubStore((s) => s.signInResult);
    const user = useHubStore((s) => s.user);
    const username = useSignInUsername();

    const now = useNowAfter(attemptAt, settings.enabled && !connected);
    const activeAddress = useHubStore((s) => s.server?.activeAddress ?? null);
    const versionSaid = useHubStore((s) => s.serverVersion);
    const link = hubLink({
        attemptAt,
        authRefused,
        connected,
        enabled: settings.enabled,
        now,
        opening: activeAddress !== null,
        signedIn,
        token: settings.token,
        url: settings.url,
    });
    // Worbus P2: what the last sign-in said, and who the connection acts for (design §6.2, §6.5).
    const sign = {
        authKnown,
        hasToken: settings.token.trim() !== '',
        result: signInResult,
        signedIn,
        signedOut,
        signingIn,
        user,
        username,
    };
    const status = serverStatus(link, sign);
    const say = useSay();
    // Worbus P3 (design §6.6): the route the signed-in line names; and, while no server is set or
    // while a set server looks for its home address, what looking says.
    const finder = useHubStore((s) => s.finder);
    const route = statusRoute(activeAddress).filter(
        (part) => status === 'signedIn' || (status === 'connected' && part.key === 'notEncrypted'),
    );
    // M10: "Connected to" names the address the socket is on, not the typed one.
    const sentence = [
        serverStatusSentence(status, activeAddress ?? settings.url, sign),
        ...route.map(say),
    ].join(' · ');
    const configured = isHubConfigured({ ...settings, signedIn });
    const looking =
        !configured || finder.scope === 'home' ? say(notSetView(finder, username).sentence) : '';

    // Worbus P4: the server's own version line first (`welcome.server.version`), when it sent one.
    const serverVersion = say(serverVersionCopy(versionSaid));
    const current = [
        ...(link === 'connected' && serverVersion ? [{ id: 'version', text: serverVersion }] : []),
        ...(link === 'connected'
            ? capabilityLines({
                  clap: clap.data,
                  libraryTools,
                  libraryToolsRefused: libraryRefused,
                  libraryToolsTooOld: libraryTooOld,
                  speakers,
                  stations,
              })
            : []),
    ];

    // R30: the lines fold in and out with the connection; while they fold closed the last ones
    // stay drawn, so the fold has something to close over.
    const lastLines = useRef(current);
    if (current.length > 0) lastLines.current = current;
    const lines = current;
    const drawn = current.length > 0 ? current : lastLines.current;

    return (
        // R30: the sentence growing to two lines, and the lines folding, move what is below with
        // the app's own grow tween instead of jumping it.
        <GrowBox name="server-status">
            <Stack aria-live="polite" gap={0}>
                <Text size="sm">{sentence}</Text>
                {looking && (
                    <Text isMuted size="sm">
                        {looking}
                    </Text>
                )}
                <Fold name="server-capabilities" open={lines.length > 0}>
                    <Stack gap="xs" pt="xs">
                        {drawn.map((line) => (
                            <Text isMuted key={line.id} size="sm">
                                {line.text}
                            </Text>
                        ))}
                    </Stack>
                </Fold>
            </Stack>
        </GrowBox>
    );
});

/**
 * Settings, Server: the connection to a Worbus Server. Only writes to the store; use-hub.tsx
 * watches these values and pushes them to the main-process transport.
 */
export const WorbusServerSettings = memo(() => {
    const settings = useHubSettings();
    const { setSettings } = useSettingsStoreActions();

    const signedIn = useHubStore((s) => s.authSignedIn);
    const signingIn = useHubStore((s) => s.signingIn);
    const signInResult = useHubStore((s) => s.signInResult);
    const username = useSignInUsername();
    // The token field exists only after a sign-in found an older server (R6).
    const showToken = showTokenField(signInResult);

    const configured = isHubConfigured({ ...settings, signedIn });
    // Walk B6: what the Address field shows. With none, there is nowhere to sign in to.
    const hasAddress = addressFieldValue(settings.url, configured) !== '';

    // Worbus P3 (design §6.4, §6.6): not set - what looking found, Look on this network, Type an
    // address; set - the address in use, the others, the list, Find home address.
    const say = useSay();
    const { t } = useTranslation();
    const server = useHubStore((s) => s.server);
    const finder = useHubStore((s) => s.finder);
    const [typing, setTyping] = useState(false);
    const [listOpen, setListOpen] = useState(false);
    const [newAddress, setNewAddress] = useState('');
    // Each time the tab opens while no server is set: look beside Navidrome (never the sweep).
    useEffect(() => {
        lookIfNotSet();
        // M4: a finished "Find home address" answer is said while the tab is open, not on every
        // later visit.
        return () => {
            const { finder: last } = useHubStore.getState();
            if (last.scope === 'home' && last.kind !== 'looking') stopLooking();
        };
    }, []);
    const notSet = notSetView(
        finder.scope === 'home' ? { ...finder, kind: 'idle', results: [] } : finder,
        username,
    );
    // W-4: a found row arrives folded and opens on the next frame (the Fold eases it in).
    const foundTitles = notSet.rows.map((row) => say(row.title));
    const [drawnFound, setDrawnFound] = useState<ReadonlySet<string>>(() => new Set());
    const arriving = titlesToArrive(drawnFound, foundTitles).join('\n');
    useEffect(() => {
        if (!arriving) return undefined;
        const frame = requestAnimationFrame(() =>
            setDrawnFound((drawn) => new Set([...arriving.split('\n'), ...drawn])),
        );
        return () => cancelAnimationFrame(frame);
    }, [arriving]);
    const set = server ? setView(server.record, server.activeAddress, settings.url) : null;
    const sweeping = finder.kind === 'looking' && finder.scope !== 'beside';
    const foundWhere = say({ key: finder.scope === 'network' ? 'foundOnNetwork' : 'foundBeside' });
    const [address, setAddress] = useState(addressFieldValue(settings.url, configured));
    const [name, setName] = useState(settings.name);

    // Reset to default (or anything else that writes these) must show in the fields.
    useEffect(() => {
        setAddress(addressFieldValue(settings.url, configured));
    }, [settings.url, configured]);
    useEffect(() => setName(settings.name), [settings.name]);

    const options = [
        {
            control: (
                <Switch
                    aria-label="Connect to a Worbus Server"
                    checked={settings.enabled}
                    onChange={(e) => setSettings({ hub: { enabled: e.currentTarget.checked } })}
                />
            ),
            description:
                'Control playback on other devices and move the queue between them, ' +
                'continuing from the same spot.',
            keywords: KEYWORDS.serverConnect,
            title: 'Connect to a Worbus Server',
        },
        {
            control: <></>,
            description: <ServerStatus />,
            keywords: KEYWORDS.serverStatus,
            title: 'Status',
        },
        ...notSet.rows
            .map((row, i) => ({ row, title: foundTitles[i] }))
            .map(({ row, title }) => ({
                control: row.action ? (
                    <Button
                        aria-label={say(row.action)}
                        loading={signingIn && row.kind === 'server'}
                        onClick={() => void signInToFound(row.found, row.address)}
                        variant={row.kind === 'server' ? 'filled' : 'default'}
                    >
                        {say(row.action)}
                    </Button>
                ) : (
                    <></>
                ),
                description: row.kind === 'server' ? foundWhere : '',
                fold: true,
                isHidden: configured || !drawnFound.has(title),
                keywords: KEYWORDS.serverAddress,
                title,
            })),
        {
            control: (
                <Button
                    loading={sweeping && finder.scope === 'network'}
                    onClick={() => void lookOnNetwork('network')}
                    variant="default"
                >
                    {t('setting.worbus.lookOnNetwork')}
                </Button>
            ),
            description: t('setting.worbus.lookOnNetworkDescription'),
            fold: true,
            isHidden: configured,
            keywords: KEYWORDS.serverAddress,
            title: t('setting.worbus.lookOnNetwork'),
        },
        {
            control: (
                <Button onClick={() => setTyping(true)} variant="default">
                    {t('setting.worbus.typeAddress')}
                </Button>
            ),
            description: t('setting.worbus.typeAddressDescription'),
            fold: true,
            isHidden: configured || typing,
            keywords: KEYWORDS.serverAddress,
            title: t('setting.worbus.typeAddress'),
        },
        {
            control: (
                <TextInput
                    aria-label="Server address"
                    onBlur={() => {
                        const url = normaliseHubAddress(address);
                        if (url !== settings.url) setSettings({ hub: { url } });
                        setAddress(
                            addressFieldValue(url, isHubConfigured({ ...settings, signedIn, url })),
                        );
                    }}
                    onChange={(e) => setAddress(e.currentTarget.value)}
                    placeholder="ws://192.168.1.10:4790"
                    value={address}
                />
            ),
            description: 'The address of your Worbus Server, for example ws://192.168.1.10:4790.',
            fold: true,
            // P3: typed only after "Type an address"; once a server is set, the list below.
            isHidden: configured || !typing,
            keywords: KEYWORDS.serverAddress,
            title: 'Server address',
        },
        {
            control: (
                <Button
                    aria-expanded={listOpen}
                    onClick={() => setListOpen((open) => !open)}
                    variant="default"
                >
                    {t('setting.worbus.addresses')}
                </Button>
            ),
            description: (
                <Stack gap={0}>
                    <Text size="sm">{set?.primary ?? settings.url}</Text>
                    {set?.others.map((line) => (
                        <Text isMuted key={line.key} size="sm">
                            {say(line)}
                        </Text>
                    ))}
                </Stack>
            ),
            fold: true,
            isHidden: !configured,
            keywords: KEYWORDS.serverAddress,
            // Its own title: rows are keyed by title, and the typed field above is "Server address".
            title: t('setting.worbus.address'),
        },
        ...(set?.rows ?? []).map((row) => ({
            control: (
                <Button
                    aria-label={`${t('setting.worbus.remove')} ${row.display}`}
                    disabled={!row.removable}
                    onClick={() => void removeServerAddress(row.url)}
                    variant="default"
                >
                    {t('setting.worbus.remove')}
                </Button>
            ),
            description: say(row.source),
            fold: true,
            indent: true,
            isHidden: !configured || !listOpen,
            keywords: KEYWORDS.serverAddress,
            title: row.display,
        })),
        {
            control: (
                <Switch
                    aria-label={t('setting.worbus.useAwayFromHome')}
                    checked={set?.learned?.on ?? false}
                    onChange={(e) =>
                        void editServer({ op: 'learnedOff', value: !e.currentTarget.checked })
                    }
                />
            ),
            description: set?.learned
                ? say({ key: 'learnedRow', values: { address: displayAddress(set.learned.url) } })
                : '',
            fold: true,
            indent: true,
            isHidden: !configured || !listOpen || !set?.learned,
            keywords: KEYWORDS.serverAddress,
            title: t('setting.worbus.useAwayFromHome'),
        },
        {
            control: (
                <TextInput
                    aria-label={t('setting.worbus.addAddress')}
                    onChange={(e) => setNewAddress(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key !== 'Enter' || !newAddress.trim()) return;
                        void editServer({ op: 'add', url: newAddress });
                        setNewAddress('');
                    }}
                    placeholder="ws://192.168.1.10:4790"
                    rightSection={
                        <Button
                            disabled={!newAddress.trim()}
                            onClick={() => {
                                void editServer({ op: 'add', url: newAddress });
                                setNewAddress('');
                            }}
                            size="compact-xs"
                            variant="subtle"
                        >
                            {t('setting.worbus.add')}
                        </Button>
                    }
                    rightSectionWidth={56}
                    value={newAddress}
                />
            ),
            description: t('setting.worbus.addressesDescription'),
            fold: true,
            indent: true,
            isHidden: !configured || !listOpen,
            keywords: KEYWORDS.serverAddress,
            title: t('setting.worbus.addAddress'),
        },
        {
            control: (
                <Button
                    loading={sweeping && finder.scope === 'home'}
                    onClick={() => void lookOnNetwork('home')}
                    variant="default"
                >
                    {t('setting.worbus.findHomeAddress')}
                </Button>
            ),
            description: t('setting.worbus.findHomeAddressDescription'),
            fold: true,
            isHidden: !configured || !set?.findHome,
            keywords: KEYWORDS.serverAddress,
            title: t('setting.worbus.findHomeAddress'),
        },
        {
            control: (
                <Button
                    aria-label={`Sign in as ${username}`}
                    loading={signingIn}
                    onClick={() => void signInWithCurrentServer()}
                    variant="filled"
                >
                    Sign in
                </Button>
            ),
            description:
                'Uses the account this app is signed in to your music server with. Nothing to type.',
            // R30: folds in and out.
            fold: true,
            // Absent once signed in, with no music server account to sign in with, and with no
            // address to sign in to (walk B6).
            isHidden: signedIn || !username || !hasAddress,
            keywords: KEYWORDS.serverSignIn,
            title: `Sign in as ${username}`,
        },
        {
            control: (
                <Button
                    aria-label="Sign out of this server"
                    onClick={() => void signOutOfServer({ reconnect: true })}
                    variant="default"
                >
                    Sign out
                </Button>
            ),
            description:
                'This computer forgets its sign-in to the Worbus Server. Your music server stays signed in.',
            fold: true,
            isHidden: !signedIn,
            keywords: KEYWORDS.serverSignOut,
            title: 'Sign out of this server',
        },
        {
            control: (
                <TextInput
                    aria-label="This device's name"
                    onBlur={() => {
                        const result = resolveDeviceName(name, settings.name);
                        setName(result.draft);
                        if (result.changed) setSettings({ hub: { name: result.name } });
                    }}
                    onChange={(e) => setName(e.currentTarget.value)}
                    placeholder={DEFAULT_DEVICE_NAME}
                    value={name}
                />
            ),
            description: 'Shown in the device list on your other devices.',
            keywords: KEYWORDS.serverDeviceName,
            title: "This device's name",
        },
    ];

    const tokenOptions = [
        {
            control: (
                <PasswordInput
                    aria-label="Server token, for older servers"
                    defaultValue={settings.token}
                    onBlur={(e) => {
                        const token = e.currentTarget.value.trim();
                        if (token !== settings.token) setSettings({ hub: { token } });
                    }}
                />
            ),
            description:
                'This Worbus Server is older and has no sign-in. Enter the access token its owner gave you.',
            keywords: KEYWORDS.serverToken,
            title: 'Server token, for older servers',
        },
    ];

    const keyword = useSettingSearchStore((state) => state.search);

    return (
        <Stack gap={0}>
            <SettingsSection options={options} title="Worbus Server" />
            {keyword === '' ? (
                // R30: the Advanced section folds in when an older server is found and out at a
                // sign-in; its gap is inside the fold, so a closed one leaves none.
                <Fold name="server-advanced" open={showToken}>
                    <Stack pt="md">
                        <SettingsSection options={tokenOptions} title="Advanced" />
                    </Stack>
                </Fold>
            ) : (
                showToken && (
                    <Stack pt="md">
                        <SettingsSection options={tokenOptions} title="Advanced" />
                    </Stack>
                )
            )}
        </Stack>
    );
});

/**
 * The one address a cast speaker needs: it fetches the stream itself, from exactly this base,
 * so it must be a music server address the speaker can reach (never the Worbus Server's own).
 */
export const CastingSettings = memo(() => {
    const settings = useHubSettings();
    const { setSettings } = useSettingsStoreActions();
    const [publicUrl, setPublicUrl] = useState(settings.publicServerUrl);
    useEffect(() => setPublicUrl(settings.publicServerUrl), [settings.publicServerUrl]);

    // M9: every address the Worbus Server has (typed, found, learned), not only the typed one.
    const record = useHubStore((s) => s.server?.record);
    const hubUrls = [settings.url, ...(record?.addresses.map((a) => a.url) ?? [])];
    const publicHost = hostOf(settings.publicServerUrl);
    const pointsAtHub =
        Boolean(settings.publicServerUrl) &&
        publicHost !== null &&
        hubUrls.some((url) => hostOf(url) === publicHost);

    const options = [
        {
            control: (
                <TextInput
                    aria-label="Music server address for speakers"
                    onBlur={() => {
                        const result = resolvePublicServerUrl(
                            publicUrl,
                            settings.publicServerUrl,
                            hubUrls,
                        );
                        setPublicUrl(result.draft);
                        if (result.error) {
                            toast.error({
                                message:
                                    result.error === 'hub'
                                        ? "That is the Worbus Server's address, not your music " +
                                          'server. Use the address your music server can be ' +
                                          'reached at from the internet.'
                                        : 'That is not a web address. Use something like ' +
                                          'https://music.example.com.',
                                title: 'Music server address for speakers',
                            });
                            return;
                        }
                        if (result.changed) {
                            setSettings({ hub: { publicServerUrl: result.value } });
                        }
                    }}
                    onChange={(e) => setPublicUrl(e.currentTarget.value)}
                    placeholder="https://music.example.com"
                    value={publicUrl}
                />
            ),
            description: pointsAtHub ? (
                <Text c="red" isNoSelect size="sm">
                    This is the Worbus Server&apos;s address, which cannot serve audio. Casting will
                    fail until it is your music server&apos;s address.
                </Text>
            ) : (
                'Chromecasts on your network are offered to your other devices while connected. ' +
                "Set this if speakers can't play but this computer can."
            ),
            keywords: KEYWORDS.castingAddress,
            title: 'Music server address for speakers',
        },
    ];

    return <SettingsSection options={options} title="Casting" />;
});
