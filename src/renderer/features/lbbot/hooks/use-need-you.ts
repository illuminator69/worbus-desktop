import { useEffect, useMemo } from 'react';

import { useLbBotActivity, useLbBotAttention } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    LedgerRow,
    useActiveFillsActions,
    useDismissedRequests,
    useFillLedger,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import {
    dismissalsStillListed,
    NeedYouItem,
    needYouItems,
} from '/@/renderer/features/lbbot/utils/need-you';

/**
 * Activity's Need you, the one set behind the sidebar badge and the chip (the owner, 2026-11-13):
 * this device's ledger, every client's requests (`/lb/activity`) and lb-bot's failed gaps and picks
 * (`/lb/attention`'s albums, the same read the sidebar's To fix count makes). See `need-you.ts`.
 * Also forgets a dismissal once lb-bot lists nothing for it (review M1).
 */
export const useNeedYou = (): NeedYouItem<LedgerRow>[] => {
    const ledger = useFillLedger();
    const activity = useLbBotActivity().data ?? null;
    const attention = useLbBotAttention().data?.albums ?? null;
    const dismissed = useDismissedRequests();
    const { keepDismissed } = useActiveFillsActions();

    useEffect(() => {
        const keep = dismissalsStillListed(dismissed, activity, attention);
        if (keep.length !== dismissed.length) keepDismissed(keep);
    }, [activity, attention, dismissed, keepDismissed]);

    return useMemo(
        () => needYouItems({ activity, attention, dismissed, ledger }),
        [activity, attention, dismissed, ledger],
    );
};
