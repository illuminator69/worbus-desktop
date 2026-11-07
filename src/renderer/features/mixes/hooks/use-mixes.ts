import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { sendHubAct } from '/@/renderer/features/hub/utils/remote-queue';
import { MixEngineDeps, MixRun, regenerateMix } from '/@/renderer/features/mixes/mix-engine';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { playStationQueue } from '/@/renderer/features/player/station/station-client';
import { beginQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import {
    isKnownMixKind,
    Mix,
    MixKind,
    useAudioMuseSettings,
    useCurrentServer,
    useCurrentServerId,
    useHubConnected,
} from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { Play } from '/@/shared/types/types';

/**
 * The four writes, and the one read that matters.
 *
 * Every write goes to the hub and **only** to the hub. There is deliberately no
 * local-first path here, unlike saved-queue rename: a saved queue can exist
 * locally before the hub has ever heard of it (it is captured automatically,
 * including offline), so a hub-only rename would silently drop the edit. A mix
 * is born on the hub — `saveMix` without an id is what mints it — so there is
 * nothing to apply locally, and the broadcast that comes back is the update.
 *
 * `sendHubAct` answers false when there is no connection, which is the whole
 * error handling this needs: there is nowhere else for the recipe to live.
 */
export const useMixActions = () => {
    const connected = useHubConnected();

    const notConnected = () => {
        toast.error({
            message: 'Not connected to your hub — mixes are stored there, so this cannot be saved.',
        });
        return false;
    };

    const saveMix = useCallback(
        (mix: {
            /** The station character (I-040); `moodCharacter` carries its legacy name. */
            character?: string;
            count?: number;
            /** A Navidrome cover-art id, stamped from the recipe's SEED. The hub
             *  has always accepted it (`_sanitize_mix`) and neither client ever
             *  wrote it, which is the whole of "mixes are just plain text". */
            coverArtId?: string;
            id?: string;
            kind: MixKind;
            moodCharacter?: string;
            name: string;
            seedId?: string;
            /** A custom radio's artists (P5); sent only when there are some. */
            seedIds?: string[];
            seedName?: string;
            /** Artist variety (P5); sent only when set. */
            variety?: string;
        }): boolean => sendHubAct('saveMix', mix) || notConnected(),
        [],
    );

    const renameMix = useCallback(
        (id: string, name: string): boolean =>
            sendHubAct('renameMix', { id, name }) || notConnected(),
        [],
    );

    const deleteMix = useCallback(
        (id: string): boolean => sendHubAct('deleteMix', { id }) || notConnected(),
        [],
    );

    return { connected, deleteMix, renameMix, saveMix };
};

/**
 * Running a mix, in two halves.
 *
 * **A mix has no fixed contents - that is the whole feature - so "what is in
 * this" had no answer until the engine had been run, and the only way to run it
 * was to tap the mix, which replaces whatever is playing.** That is a lot of
 * commitment for something whose contents cannot be seen, so `generate` is
 * split out: it runs the recipe and hands back the tracks without touching
 * playback, and `playGenerated` plays a list a preview already built.
 *
 * `playGenerated` deliberately does **not** regenerate. A second run would
 * produce a different tracklist and make the preview a lie about what it was
 * previewing.
 *
 * `generate` deliberately does **not** `touchMix` either: previewing is not
 * playing, and `lastPlayedAt` is a record of what was listened to.
 *
 * The order in `play` matters for the same kind of reason. `touchMix` fires only
 * after a regeneration produced something - a mix whose source has gone cold (an
 * unbuilt AudioMuse index, a deleted seed) must not climb the list for having
 * failed.
 *
 * A new listening session is announced, so the saved-queue history gets its own
 * card. The kind is `radio` rather than a new `mix` value: `SavedQueueKind` is
 * shared with Worbus for Android, whose own enum would not recognise a new member, and
 * `radio` already means exactly this - a generated, non-library session.
 */
export const useMixRunner = () => {
    const player = usePlayer();
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    const server = useCurrentServer();
    const audioMuse = useAudioMuseSettings();
    const [busyId, setBusyId] = useState('');

    /**
     * Run the recipe and answer with tracks. Null means it was refused or it
     * failed - both already reported - and an empty array means the recipe ran
     * and produced nothing, which is a different thing the caller words
     * differently.
     */
    const generate = useCallback(
        async (mix: Mix): Promise<MixRun | null> => {
            if (!serverId) return null;
            // A recipe this build cannot run. Refused with a reason rather than
            // approximated: regenerating the wrong kind plays something
            // plausible and wrong, which is harder to notice than nothing
            // happening. The row stays - it can still be renamed and deleted.
            if (!isKnownMixKind(mix.kind)) {
                toast.error({
                    message: `"${mix.name}" was made with a newer version of navi-connect - this build does not know how to build a "${mix.kind}" mix.`,
                });
                return null;
            }
            setBusyId(mix.id);
            try {
                const deps: MixEngineDeps = { audioMuse, queryClient, server, serverId };
                return await regenerateMix(mix, deps);
            } catch (error) {
                toast.error({
                    message: (error as Error).message,
                    title: `Could not build "${mix.name}"`,
                });
                return null;
            } finally {
                setBusyId('');
            }
        },
        [audioMuse, queryClient, server, serverId],
    );

    /** Play a list the caller already has - a preview's own tracks, never a
     *  second regeneration of them. A run that came from a station plays as that
     *  station's queue, so autoplay continues it. */
    const playGenerated = useCallback(
        (mix: Mix, run: MixRun) => {
            if (run.songs.length === 0) return;
            if (run.station) {
                playStationQueue({ binding: run.station, songs: run.songs }, mix.name, player);
            } else {
                beginQueueSession('radio', mix.name);
                player.addToQueueByData(run.songs, Play.NOW);
            }
            sendHubAct('touchMix', { id: mix.id });
        },
        [player],
    );

    const play = useCallback(
        async (mix: Mix) => {
            const run = await generate(mix);
            if (run === null) return;
            if (run.songs.length === 0) {
                toast.error({
                    message: `"${mix.name}" produced nothing this time - its source may be empty or still indexing.`,
                });
                return;
            }
            playGenerated(mix, run);
        },
        [generate, playGenerated],
    );

    return { busyId, generate, play, playGenerated };
};

/**
 * The play-only view of {@link useMixRunner}, kept because most callers want
 * exactly this and `playingId` reads better than `busyId` at a tile that is
 * about to start music.
 */
export const usePlayMix = () => {
    const { busyId, play } = useMixRunner();
    return { play, playingId: busyId };
};
