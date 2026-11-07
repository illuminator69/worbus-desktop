import { useEffect, useState } from 'react';

import { scanScannable } from '/@/renderer/features/discography/scan-phase';
import { openMbidMatchModal } from '/@/renderer/features/lbbot/components/mbid-match-modal';
import {
    refreshArtistMeta,
    useArtistOverrideKind,
    useIndexArtist,
    useIsP1Peer,
    useLbBotAvailable,
    useOverrideControls,
    useScanNeedsMbid,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { isNavidromeArtistId } from '/@/renderer/features/lbbot/utils/artist-override';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { toast } from '/@/shared/components/toast/toast';
import { LbBotDiscography } from '/@/shared/types/lbbot-types';

interface LbBotIndexButtonProps {
    artistMbid?: null | string;
    artistName: string;
    discography: LbBotDiscography | null | undefined;
    ndId: string;
    /** Navidrome's own MBID tag, which `artistMbid` (the effective one) may differ from. */
    tagMbid?: null | string;
}

/**
 * The artist's MusicBrainz menu: Wrong artist / Choose MusicBrainz artist, and
 * Refresh About. The scan moved to the Rescan control beside it (F7).
 *
 * Mounted in **every** index state, saying why where an artist genuinely cannot
 * be scanned. It used to return null without an MBID, which is the one state where
 * the user most needs to be told something: lb-bot matches artists by MusicBrainz
 * id and its index POST requires `mbid` *and* `name`, so an untagged artist can't
 * be indexed at all — a real, recorded limitation. Vanishing made that read as the
 * feature being broken or absent. Saying so is the fix.
 *
 * Still nothing at all when `discography` is undefined, which is lb-bot being
 * unconfigured or unreachable — that layer hides completely, as everywhere else.
 *
 * I-019: when the hub supports MBID overrides, "no MBID" is no longer a dead end
 * ("Choose MusicBrainz artist"), and an artist that has one can be corrected
 * ("Wrong artist?"). With a hub too old to, today's retag-in-Navidrome tooltip
 * stays and neither control exists.
 */
export const LbBotIndexButton = ({
    artistMbid,
    artistName,
    discography,
    ndId,
    tagMbid,
}: LbBotIndexButtonProps) => {
    const { error, indexArtist, note, pending } = useIndexArtist(ndId);
    const available = useLbBotAvailable();
    // The override controls belong to a NAVIDROME artist: the virtual page's
    // `mb:<uuid>` id is answered 400 by lb-bot. Hidden too once an answer said this
    // lb-bot is older.
    const overridesSupported = useOverrideControls() && isNavidromeArtistId(ndId);
    const kind = useArtistOverrideKind(ndId, tagMbid);
    const [refreshing, setRefreshing] = useState(false);
    const p1Peer = useIsP1Peer();
    const needsMbid = useScanNeedsMbid();

    // A scan's outcome, said once as it arrives: the menu that started it has closed.
    useEffect(() => {
        if (error) toast.error({ message: error });
    }, [error]);
    useEffect(() => {
        if (note) toast.info({ message: note });
    }, [note]);

    if (!discography) return null;

    const refreshAbout = async () => {
        setRefreshing(true);
        const outcome = await refreshArtistMeta(artistMbid, artistName);
        setRefreshing(false);
        if (outcome.ok) toast.success({ message: outcome.message });
        else toast.warn({ message: outcome.message });
    };

    // lb-bot's index POST requires BOTH: the MBID is what it scans, the name is what
    // it matches the library against, and it 400s without either. A virtual artist
    // page reached by a bookmarked URL has the id and not yet the name. Worbus P1: a P1
    // lb-bot scans a library artist by its Navidrome id alone, so the "no MusicBrainz
    // id" sentence is said only to an older peer.
    const scannable = scanScannable({
        mbid: artistMbid,
        name: artistName,
        ndId,
        olderLbBot: needsMbid,
        p1Peer,
    });
    const openPicker = () =>
        openMbidMatchModal({
            currentMbid: artistMbid,
            indexArtist,
            name: artistName,
            ndId,
            tagMbid,
        });

    const status =
        overridesSupported && (kind === 'override' || kind === 'override-same')
            ? 'MusicBrainz match set by you'
            : '';

    // One icon after the Rescan control (F7), opening a menu, the way upstream offers an item's
    // actions. The scan itself is the Rescan control's; this keeps the match and About.
    return (
        <DropdownMenu position="bottom-end">
            <DropdownMenu.Target>
                <ActionIcon
                    icon="brandMusicBrainz"
                    loading={refreshing}
                    tooltip={{ label: 'MusicBrainz match' }}
                    variant="subtle"
                />
            </DropdownMenu.Target>
            <DropdownMenu.Dropdown>
                {status && <DropdownMenu.Label>{status}</DropdownMenu.Label>}
                {overridesSupported && artistName && (
                    <DropdownMenu.Item
                        disabled={pending || !available}
                        leftSection={<Icon icon="edit" />}
                        onClick={openPicker}
                    >
                        {artistMbid ? 'Wrong artist?' : 'Choose MusicBrainz artist'}
                    </DropdownMenu.Item>
                )}
                {(artistMbid || artistName) && available && (
                    <DropdownMenu.Item
                        disabled={refreshing}
                        leftSection={<Icon icon="refresh" />}
                        onClick={refreshAbout}
                    >
                        Refresh About
                    </DropdownMenu.Item>
                )}
                {!scannable && (
                    <DropdownMenu.Label>
                        {!artistMbid
                            ? overridesSupported
                                ? 'No MusicBrainz id in your library: choose the artist to scan with.'
                                : 'No MusicBrainz id in your library: tag the artist in Navidrome first.'
                            : "lb-bot needs the artist's name as well as their MusicBrainz id."}
                    </DropdownMenu.Label>
                )}
            </DropdownMenu.Dropdown>
        </DropdownMenu>
    );
};
