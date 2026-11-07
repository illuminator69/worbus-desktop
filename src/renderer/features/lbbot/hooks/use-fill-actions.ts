import { useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import { FillButton } from '/@/renderer/features/lbbot/fill-vocabulary';
import {
    allowMp3AndRetry,
    cancelFill,
    downloadsShownNow,
    retryFill,
    useLbBotDownloadsShown,
    useWishlistActions,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    LedgerRow,
    useActiveFillsActions,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import { AppRoute } from '/@/renderer/router/routes';
import { toast } from '/@/shared/components/toast/toast';

/** The words on each button, the same on the Downloads page and in the album page's request box. */
export const FILL_BUTTON_LABEL: Record<FillButton, string> = {
    allowMp3: 'Allow MP3 and retry',
    cancel: 'Cancel',
    dismiss: 'Dismiss',
    openAlbum: 'Open album',
    retry: 'Retry',
    tryAnother: 'Try another source',
    wishlist: 'Add to wishlist',
};

/** The buttons that ask lb-bot to fetch something: none is offered while downloading is off. */
const FETCHING_BUTTONS = new Set<FillButton>(['allowMp3', 'cancel', 'retry', 'tryAnother']);

/**
 * What each of `describeFill`'s buttons does for one ledger row (F7 Task 7): one set of actions for
 * the Downloads page and the request box, so one row offers the same buttons doing the same thing in
 * both. Delegation only: every decision about which buttons exist is `describeFill`'s.
 */
export const useFillActions = (row: LedgerRow) => {
    const { dismiss } = useActiveFillsActions();
    const { add: addToWishlist } = useWishlistActions();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    // Worbus P1: while downloading is off a ledger row is read-only history - no Retry, Cancel or
    // MP3 opt-in (Open album, Add to wishlist and Dismiss stay).
    const downloadsShown = useLbBotDownloadsShown();

    const call = async (action: () => Promise<boolean>) => {
        setBusy(true);
        const ok = await action();
        setBusy(false);
        // A refusal because downloading turned out to be off is not an error: the buttons go.
        // Every action here applies its answer's refusal itself before resolving
        // (`applyLbBotRefusal`), so the mode is already off when this reads it, whether or not the
        // `lbbot-refusal` event has arrived yet.
        // Worbus P2: the same for a role the user turned out not to have (admin_only lowers the
        // flag before this reads it): the buttons go, without an error.
        if (!ok && downloadsShownNow()) {
            toast.error({ message: 'lb-bot would not take that request.' });
        }
    };

    const actions: Record<FillButton, () => void> = {
        allowMp3: () =>
            void call(() =>
                allowMp3AndRetry({ groupId: row.groupId, isGap: row.isGap, key: row.key }),
            ),
        cancel: () => void call(() => cancelFill(row)),
        dismiss: () => dismiss(row.key),
        openAlbum: () => {
            if (row.rgid)
                navigate(generatePath(AppRoute.EXTERNAL_ALBUM_DETAIL, { rgid: row.rgid }));
        },
        retry: () => void call(() => retryFill({ isGap: row.isGap, key: row.key })),
        tryAnother: () => void call(() => retryFill(row, { anotherSource: true })),
        // Dismissed once it is on the list: the wishlist is where it lives from here.
        wishlist: () =>
            void call(async () => {
                const ok = await addToWishlist({
                    artist: row.artist,
                    rgid: row.rgid,
                    title: row.album,
                });
                if (ok) dismiss(row.key);
                return ok;
            }),
    };

    return {
        busy,
        label: (button: FillButton) => FILL_BUTTON_LABEL[button],
        run: (button: FillButton) => actions[button](),
        /** `describeFill`'s buttons as offered now (the fetching ones dropped while off). */
        shown: (buttons: FillButton[]): FillButton[] =>
            downloadsShown ? buttons : buttons.filter((button) => !FETCHING_BUTTONS.has(button)),
    };
};
