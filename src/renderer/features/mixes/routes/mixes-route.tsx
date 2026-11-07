import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './mixes-route.module.css';

import i18n from '/@/i18n/i18n';
import { allows } from '/@/renderer/features/hub/utils/hub-roles';
import { lbModalSettings } from '/@/renderer/features/lbbot/components/lb-modal-layout';
import { GeneratedArtwork, MixArtwork } from '/@/renderer/features/mixes/components/mix-artwork';
import { MixForm } from '/@/renderer/features/mixes/components/mix-form';
import { MixPreview } from '/@/renderer/features/mixes/components/mix-preview';
import { useMixActions, usePlayMix } from '/@/renderer/features/mixes/hooks/use-mixes';
import { isPrimaryOnlyMix, mixLine, yourMixLine } from '/@/renderer/features/mixes/mix-recipe';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { playYourMix } from '/@/renderer/features/player/station/station-client';
import { characterLabel } from '/@/renderer/features/player/station/station-logic';
import {
    useStationCatalog,
    useStationMode,
} from '/@/renderer/features/player/station/station-store';
import { ForkListPage } from '/@/renderer/features/shared/components/fork-list-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import {
    isKnownMixKind,
    Mix,
    useCurrentServerId,
    useHubConnected,
    useMixes,
} from '/@/renderer/store';
import { useHubRoles } from '/@/renderer/store/hub.store';
import { useStationSettings } from '/@/renderer/store/settings.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { StationCharacterId } from '/@/shared/types/station-types';

/**
 * navi-connect: "Mixed for You" — the recipes, not the results.
 *
 * The name avoids both words this stack has already spent. "Station" is
 * Subsonic internet radio in Worbus for Android (`Screen.RadioList`) and in Worbus for desktop's
 * create/edit-station forms; "radio" is the ephemeral similarity mix
 * (`RadioManager.startRadio`, `SavedQueueSource.RADIO`); and Navidrome's own
 * "Instant Mix" is ephemeral too — which is precisely what these are not. In
 * code the noun is `mix`.
 *
 * Every card here plays something **different** each time. That is the single
 * behaviour separating this page from `/saved-queues` next door, and the one a
 * frozen tracklist would also appear to pass on first use.
 */

/** A recipe from a newer client. Named, not hidden - the row is still worth
 *  renaming and deleting, and saying which kind is what makes "update the app"
 *  actionable rather than mysterious. */
const kindLine = (mix: Mix, words: (id: StationCharacterId) => string): string =>
    mixLine(mix, words) ?? `Unknown kind · ${mix.kind}`;

const RenameMixForm = ({ mix, onSubmit }: { mix: Mix; onSubmit: (name: string) => void }) => {
    const [value, setValue] = useState(mix.name);
    return (
        <Stack gap="md">
            <TextInput
                autoFocus
                onChange={(event) => setValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    onSubmit(value);
                    closeAllModals();
                }}
                value={value}
            />
            <Group justify="flex-end">
                <Button onClick={() => closeAllModals()} variant="subtle">
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        onSubmit(value);
                        closeAllModals();
                    }}
                    variant="filled"
                >
                    Save
                </Button>
            </Group>
        </Stack>
    );
};

const MixRow = ({ mix }: { mix: Mix }) => {
    const catalog = useStationCatalog();
    const words = (id: StationCharacterId) => characterLabel(catalog, id);
    const { deleteMix, renameMix } = useMixActions();
    const { play, playingId } = usePlayMix();
    const busy = playingId === mix.id;
    const playable = isKnownMixKind(mix.kind);

    // One list for both menus: the "..." button and a right-click, as on the app's cards.
    const menu: { disabled?: boolean; label: string; onSelect: () => void }[] = [
        { disabled: !playable, label: 'Play', onSelect: () => void play(mix) },
        // Run the recipe and show the result without touching playback. Until this
        // existed the only way to find out what a mix contained was to let it
        // replace what you were listening to.
        {
            disabled: !playable,
            label: 'Preview',
            onSelect: () =>
                openModal(
                    lbModalSettings(
                        i18n.t('naviConnect.mixPreview.title', { name: mix.name }),
                        <MixPreview mix={mix} />,
                        'lg',
                    ),
                ),
        },
        {
            label: 'Rename',
            onSelect: () =>
                openModal({
                    children: (
                        <RenameMixForm mix={mix} onSubmit={(name) => renameMix(mix.id, name)} />
                    ),
                    title: 'Rename mix',
                }),
        },
        { label: 'Delete', onSelect: () => deleteMix(mix.id) },
    ];

    return (
        <ContextMenu>
            <ContextMenu.Target>
                <div className={styles.row}>
                    <button
                        className={styles.rowMain}
                        disabled={busy || !playable}
                        onClick={() => void play(mix)}
                        type="button"
                    >
                        {/* The same renderer the Discover tile uses, so the two cannot
                        come to disagree about what a mix with no cover looks like. */}
                        <MixArtwork className={styles.art} mix={mix} />
                        <div className={styles.meta}>
                            <Text lineClamp={1} size="md" weight={600}>
                                {mix.name}
                            </Text>
                            <Text isMuted lineClamp={1} size="sm">
                                {kindLine(mix, words)} · {mix.count} tracks
                            </Text>
                            {/* Said plainly on every row, because it is the property
                            that distinguishes this page from Saved Queues and it is
                            not otherwise visible until the second play. */}
                            <Text isMuted lineClamp={1} size="xs">
                                {!playable
                                    ? 'Made with a newer version of navi-connect - this build cannot build it'
                                    : busy
                                      ? 'Building…'
                                      : 'Rebuilt fresh each time you play it'}
                            </Text>
                        </div>
                    </button>
                    <DropdownMenu>
                        <DropdownMenu.Target>
                            <ActionIcon icon="ellipsisHorizontal" size="sm" variant="subtle" />
                        </DropdownMenu.Target>
                        <DropdownMenu.Dropdown>
                            {menu.map((item) => (
                                <DropdownMenu.Item
                                    disabled={item.disabled}
                                    key={item.label}
                                    onClick={item.onSelect}
                                >
                                    {item.label}
                                </DropdownMenu.Item>
                            ))}
                        </DropdownMenu.Dropdown>
                    </DropdownMenu>
                </div>
            </ContextMenu.Target>
            <ContextMenu.Content>
                {menu.map((item) => (
                    <ContextMenu.Item
                        disabled={item.disabled}
                        key={item.label}
                        onSelect={item.onSelect}
                    >
                        {item.label}
                    </ContextMenu.Item>
                ))}
            </ContextMenu.Content>
        </ContextMenu>
    );
};

/**
 * "Your mix" (I-040, B-149): the hub's seedless station, from what its Navidrome user plays most,
 * as the page's first entry whenever the station engine is there (it is what builds it). Drawn
 * like a mix but not a stored recipe, so it has no menu: there is nothing to rename or delete. A
 * tap plays it in the character autoplay uses.
 */
const YourMixRow = () => {
    const { t } = useTranslation();
    const player = usePlayer();
    const serverId = useCurrentServerId();
    const catalog = useStationCatalog();
    // The character a tap plays it in: the one autoplay uses.
    const preferred = useStationSettings()?.character ?? 'balanced';
    const [busy, setBusy] = useState(false);

    return (
        <div className={styles.row}>
            <button
                className={styles.rowMain}
                disabled={busy || !serverId}
                onClick={async () => {
                    setBusy(true);
                    try {
                        const started = await playYourMix({
                            player,
                            serverId,
                            sessionName: t('naviConnect.station.yourMix'),
                        });
                        if (!started) {
                            toast.error({ message: t('naviConnect.mixes.yourMix_failed') });
                        }
                    } finally {
                        setBusy(false);
                    }
                }}
                type="button"
            >
                <GeneratedArtwork className={styles.art} glyph="user" hueKey="your-mix" />
                <div className={styles.meta}>
                    <Text lineClamp={1} size="md" weight={600}>
                        {t('naviConnect.mixes.yourMix')}
                    </Text>
                    <Text isMuted lineClamp={1} size="sm">
                        {yourMixLine(characterLabel(catalog, preferred))}
                    </Text>
                    <Text isMuted lineClamp={1} size="xs">
                        {busy ? 'Building…' : 'Rebuilt fresh each time you play it'}
                    </Text>
                </div>
            </button>
        </div>
    );
};

const MixesRoute = () => {
    // Worbus P2: Your mix and the fingerprint read the primary user's listening, so for anyone
    // else they are neither offered nor listed.
    const yourMixAllowed = allows(useHubRoles(), 'yourMix');
    const mixes = useMixes().filter((mix) => yourMixAllowed || !isPrimaryOnlyMix(mix));
    const connected = useHubConnected();
    const stations = useStationMode() === 'stations';
    const { saveMix } = useMixActions();
    const { t } = useTranslation();

    const openCreate = () =>
        openModal({
            children: <MixForm onSubmit={saveMix} />,
            title: i18n.t('naviConnect.mixes.new'),
        });

    return (
        <ForkListPage
            actions={
                <Button disabled={!connected} onClick={openCreate} variant="filled">
                    {t('naviConnect.mixes.new')}
                </Button>
            }
            count={connected ? mixes.length : undefined}
            title={t('naviConnect.mixes.title')}
        >
            <Stack gap="sm">
                {stations && yourMixAllowed && <YourMixRow />}
                {/* Not an error, and not a retry: the recipes live on the
                    hub, so with no hub there is nothing to show and
                    nothing this page could do about it. */}
                {!connected ? (
                    <Text isMuted>{t('naviConnect.mixes.noHub')}</Text>
                ) : mixes.length === 0 ? (
                    <Text isMuted>{t('naviConnect.mixes.empty')}</Text>
                ) : (
                    mixes.map((mix) => <MixRow key={mix.id} mix={mix} />)
                )}
            </Stack>
        </ForkListPage>
    );
};

const MixesRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <MixesRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default MixesRouteWithBoundary;
