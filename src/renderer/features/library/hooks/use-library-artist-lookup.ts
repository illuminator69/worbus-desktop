import type { LbBotArtistCandidate } from '/@/shared/types/lbbot-types';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { LbBotReadError, useLbBotArtistSearch } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { externalLookupWanted, type Lookup } from '/@/renderer/features/library/library-model';
import { mbFuzzyQuery } from '/@/shared/utils/mb-fuzzy-query';

const SETTLE_MS = 300;

/**
 * F6: the Library field's MusicBrainz half (Call 5), through lb-bot's result-shaped artist search
 * (never the fail-soft `artistLookup`, whose failure reads as "nothing"). One lookup per settled text:
 * 300 ms after the last keystroke, 3 characters or more (2 with CJK), never for a link, only while
 * `available` (the hub configured, lb-bot up, the route advertised). The query key is the term, so an
 * answer for older text never renders under newer text. lb-bot or the hub older than this route (404,
 * 405) is `older`; any other failure is `failed`, which the page draws with Retry.
 */
export const useLibraryArtistLookup = (
    raw: string,
    available: boolean,
): { lookup: Lookup<LbBotArtistCandidate>; retry: () => void; term: string } => {
    const [settled, setSettled] = useState(raw.trim());
    useEffect(() => {
        const id = window.setTimeout(() => setSettled(raw.trim()), SETTLE_MS);
        return () => window.clearTimeout(id);
    }, [raw]);

    const wanted = available && externalLookupWanted(settled);
    const query = useLbBotArtistSearch(wanted ? mbFuzzyQuery(settled) : '');
    const { refetch } = query;

    let kind: Lookup<LbBotArtistCandidate>['kind'];
    if (!wanted || raw.trim() !== settled) kind = 'idle';
    else if (query.isSuccess) kind = 'done';
    else if (query.isError) {
        const status = query.error instanceof LbBotReadError ? query.error.status : 0;
        kind = status === 404 || status === 405 ? 'older' : 'failed';
    } else kind = 'looking';

    // Stable while nothing changed, so the list does not re-render on every keystroke. A failure keeps
    // the sentence the main process wrote for it (lb-bot's own for a MusicBrainz outage).
    const { data } = query;
    const message = query.error instanceof Error ? query.error.message : '';
    const lookup = useMemo((): Lookup<LbBotArtistCandidate> => {
        if (kind === 'done') return { items: data ?? [], kind };
        if (kind === 'failed') return { kind, message };
        return { kind };
    }, [data, kind, message]);
    const retry = useCallback(() => void refetch(), [refetch]);

    return { lookup, retry, term: settled };
};
