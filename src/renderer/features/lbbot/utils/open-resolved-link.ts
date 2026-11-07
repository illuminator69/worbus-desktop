import type { LbBotResolvedLink, LbBotResult } from '/@/shared/types/lbbot-types';
import type { NavigateFunction } from 'react-router';

import {
    externalAlbumPathFor,
    externalArtistPath,
} from '/@/renderer/features/lbbot/utils/external-paths';

/** What opening a resolved link did: navigated (with a caution for a guess), or a sentence to show. */
export type ResolvedLinkOutcome =
    | { error: boolean; message: string; opened: false }
    | { notice?: string; opened: true };

/**
 * Opens the album or artist page lb-bot resolved a pasted link to. Shared by the Fresh page's link box
 * and the Library field. A `kind: 'unknown'` answer is not a failure (lb-bot does not parse that
 * provider), so it comes back as lb-bot's own sentence; a low-confidence hit still navigates, with a
 * caution, because the album page is where the guess can be checked.
 */
export const openResolvedLink = (
    result: LbBotResult<LbBotResolvedLink>,
    navigate: NavigateFunction,
): ResolvedLinkOutcome => {
    if (!result.ok || !result.data) {
        return {
            error: true,
            message: result.error || 'lb-bot could not read that link.',
            opened: false,
        };
    }
    const link = result.data;
    // lb-bot's own sentence wherever it wrote one. "Not a music link we recognise", "Couldn't read the
    // Tidal page" and "No MusicBrainz artist matched" are three different problems with three answers.
    if (link.kind === 'unknown') {
        return {
            error: false,
            message:
                link.reason ||
                'That looks like a link lb-bot does not recognise. Try Spotify or Deezer.',
            opened: false,
        };
    }
    const notice =
        link.confidence > 0 && link.confidence < 0.5
            ? `Best guess: "${link.title}" by ${link.artist}. Check it is the right record before fetching.`
            : undefined;
    if (link.kind === 'artist' && link.mbid) {
        navigate(externalArtistPath(link.mbid, link.artist));
        return { notice, opened: true };
    }
    if (link.rgid) {
        // A track link resolves to its release-group too: there is no per-track page in this app and
        // nothing acquires a single track, so the album is the only useful destination.
        navigate(externalAlbumPathFor({ artist: link.artist, rgid: link.rgid, title: link.title }));
        return { notice, opened: true };
    }
    return {
        error: true,
        message:
            link.reason ||
            `lb-bot read the link as a ${link.kind} but could not match it on MusicBrainz.`,
        opened: false,
    };
};
