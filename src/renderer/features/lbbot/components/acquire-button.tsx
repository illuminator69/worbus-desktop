import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    AcquireOutcome,
    useAcquireAlbum,
    useLbBotDownloadsShown,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { toast } from '/@/shared/components/toast/toast';
import { isLbRefusal } from '/@/shared/utils/lbbot-failure';

/**
 * One gesture to fetch a release the library doesn't have — and the one place
 * that decides when one gesture is honest.
 *
 * The blind version of this existed once and was removed: it fetched the wrong
 * record for a self-titled album, where every candidate folder's name looks
 * plausible, and nothing before or after the fact said so. `useAcquireAlbum`
 * keeps that review and only skips the picker when there is nothing left to
 * decide; everything else lands here as a `review` outcome and opens the picker
 * the tap would otherwise have bypassed.
 *
 * The spinner is not decoration. `/lb/album/sources` is a live slskd fan-out
 * taking 30-90s, and until the download is actually posted the fill ledger has
 * nothing to show — so without this the tile looks inert for a minute and gets
 * tapped again.
 */

/** Why the picker opened instead, in the user's terms. */
const REVIEW_MESSAGE: Record<Extract<AcquireOutcome, { kind: 'review' }>['reason'], string> = {
    incomplete: "The best source is missing tracks — here's the full list.",
    noSources: 'Nobody is sharing this one right now.',
    unavailable: 'lb-bot would not answer.',
    uncertainMatch: "lb-bot isn't sure the best source is the right record — have a look.",
    unverifiedArtist: "lb-bot couldn't verify the artist on the best source — have a look.",
    wrongFormat: "The best source isn't lossless — here's what is on offer.",
};

interface AcquireButtonProps {
    artist?: string;
    className?: string;
    /** Opened whenever one tap is not enough to answer honestly. */
    onReview: () => void;
    rgid: string;
    title?: string;
}

export const AcquireButton = ({ artist, className, onReview, rgid, title }: AcquireButtonProps) => {
    const { t } = useTranslation();
    const acquire = useAcquireAlbum();
    const [busy, setBusy] = useState(false);
    // Worbus P1: with downloading off there is nothing to get; the tile keeps its pill.
    const downloadsShown = useLbBotDownloadsShown();

    if (!downloadsShown) return null;

    return (
        <ActionIcon
            aria-label={`Get ${title || 'this album'}`}
            className={className}
            disabled={busy}
            icon="download"
            loading={busy}
            onClick={async (event) => {
                // The tile behind this is a link to the album's own page; a tap
                // on the control is not a tap on the tile.
                event.stopPropagation();
                event.preventDefault();
                setBusy(true);
                const outcome = await acquire({ artist, rgid, title });
                setBusy(false);
                // A stale "on" answered by a 409: the button goes with the mode; said once, plainly.
                if (outcome.kind === 'off') {
                    toast.show({ message: t('naviConnect.albumPage.downloadsOff') });
                    return;
                }
                if (outcome.kind === 'review') {
                    toast.show({ message: REVIEW_MESSAGE[outcome.reason] });
                    onReview();
                    return;
                }
                if (!outcome.result.ok) {
                    // Worbus P2: a refusal (admin_only, lbbot_too_old) hides the button through
                    // its gate; it is not an error to toast.
                    if (isLbRefusal(outcome.result.code)) return;
                    toast.error({
                        message: outcome.result.error || 'lb-bot would not take that request.',
                    });
                    onReview();
                    return;
                }
                // Name the format. Quality is a *ranking* term upstream, not a
                // filter, so "what am I actually getting" is a real question and
                // the source row is normally where it gets answered.
                toast.success({
                    message: `${title || 'Album'} — ${outcome.format || 'unknown format'} from ${outcome.peer}. Track it in Downloads.`,
                });
            }}
            size="compact-sm"
            stopsPropagation
            tooltip={{ label: 'Get this album' }}
            variant="subtle"
        />
    );
};
