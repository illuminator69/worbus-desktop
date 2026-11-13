import { generatePath } from 'react-router';

import type { PollState } from './album-override';

import { decideLeaveAfterJob } from './album-override';
import { forgetAlbumCovers } from './forget-album-covers';
import { currentRoutePath, leaveTo } from './leave-page';

import { AppRoute } from '/@/renderer/router/routes';

/**
 * Leave the album page a finished apply / remove left dead, from whichever surface
 * started the job (the dialog, or Undo in the data panel) and whether or not it is
 * still open. The decision is {@link decideLeaveAfterJob}; this only goes where it
 * says. `startRow` is the override row the caller held BEFORE starting the job: an
 * undo can end before any row was polled, and the decision must not depend on the
 * last row the poll saw. Not harnessed: it needs the router's routes.
 */
export const leaveAfterAlbumJob = (input: {
    artistId: string;
    deadAlbumId: string;
    ended: PollState;
    kind: 'apply' | 'remove';
    startRow: null | { prevReleaseMbid: string; releaseMbid: string };
}): void => {
    // Review M2: an override can change the album's cover (and an undo puts the old one back);
    // the covers kept in memory for the album, under its old and new ids, are dropped.
    forgetAlbumCovers([input.deadAlbumId, input.ended.row?.albumId]);
    const decision = decideLeaveAfterJob({
        artistId: input.artistId,
        deadAlbumId: input.deadAlbumId,
        ended: input.ended,
        kind: input.kind,
        pathname: currentRoutePath(),
        startRow: input.startRow,
    });
    if (decision.kind === 'album') {
        leaveTo(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: decision.id }));
    } else if (decision.kind === 'artist') {
        leaveTo(
            generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: decision.id }),
        );
    } else if (decision.kind === 'albums') {
        leaveTo(AppRoute.LIBRARY_ALBUMS);
    }
};
