import type { LbBotActivityRequest } from '../../../../shared/utils/lbbot-activity.ts';

import { needsYou } from '../../sidebar/utils/sidebar-groups.ts';

/**
 * Activity's Need you: one set, one number, for the chip and the sidebar badge (the owner,
 * 2026-11-13: "no separation for requests between clients"). Every request lb-bot's `/lb/activity`
 * lists as failed or waiting on a pick, whichever client made it, plus this device's ledger rows
 * that need you and that lb-bot does not list (its ledger forgets a failure after 24 h; the
 * device's outlives it). A ledger row lb-bot lists in another state is not counted: lb-bot's row
 * wins the state (PROTOCOL §15.6) - a failure retried from another client and landed is done.
 *
 * Joined as §15.6 says: by `releaseMbid`, else by `groupId` (a gap's ledger row is its group).
 * With no answer from lb-bot (an older one, a non-admin, not read yet) it is the ledger's set.
 */

/** lb-bot's server states that need someone: failed, or a gap waiting on a pick. */
export const serverNeedsYou = (state: string): boolean => state === 'failed' || state === 'picking';

export interface NeedYouItem<R extends JoinRow> {
    /** This device's row, the one with buttons; null for a request only lb-bot knows. */
    ledger: null | R;
    /** lb-bot's row; null when lb-bot does not list it (or did not answer). */
    server: LbBotActivityRequest | null;
}

interface JoinRow {
    groupId: string;
    outcome: string;
    releaseMbid: string;
    settled: boolean;
}

const joins = (row: JoinRow, req: LbBotActivityRequest): boolean =>
    (!!row.releaseMbid && row.releaseMbid === req.releaseMbid) ||
    (!!row.groupId && row.groupId === req.groupId);

export const needYouItems = <R extends JoinRow>(
    ledger: readonly R[],
    requests: null | readonly LbBotActivityRequest[],
): NeedYouItem<R>[] => {
    if (!requests) return ledger.filter(needsYou).map((row) => ({ ledger: row, server: null }));
    const fromServer = requests
        .filter((req) => serverNeedsYou(req.state))
        .map((req) => ({ ledger: ledger.find((row) => joins(row, req)) ?? null, server: req }));
    const onlyHere = ledger
        .filter((row) => needsYou(row) && !requests.some((req) => joins(row, req)))
        .map((row) => ({ ledger: row, server: null }));
    return [...fromServer, ...onlyHere];
};

export const needYouCount = (
    ledger: readonly JoinRow[],
    requests: null | readonly LbBotActivityRequest[],
): number => needYouItems(ledger, requests).length;
