import type { LbBotMergeRow, LbBotSiblingGroup } from '/@/shared/types/lbbot-types';

import type { PollSpec } from './album-override';

/**
 * I-023 "Merge into one name": the logic that has no React in it. Worbus for Android mirrors it
 * by hand (PROTOCOL §15.5).
 */

type Sibling = LbBotSiblingGroup['artists'][number];

/** The group holding this artist, if lb-bot sent groups at all. null = no merge block. */
export const siblingGroupFor = (
    siblings: LbBotSiblingGroup[] | null | undefined,
    ndId: string,
): LbBotSiblingGroup | null =>
    ndId
        ? (siblings?.find((group) => group.artists.some((a) => a.ndArtistId === ndId)) ?? null)
        : null;

/**
 * The spellings this artist can be merged with (X5): the group's other entries that
 * are not collaboration credits. Empty when this artist's own entry is a credit
 * ("A & B" is not a spelling of A) or when only credits remain - then the block is
 * hidden. `collab` absent reads as false.
 */
export const mergeableOthers = (group: LbBotSiblingGroup | null, ndId: string): Sibling[] => {
    const self = group?.artists.find((a) => a.ndArtistId === ndId);
    if (!group || !self || self.collab === true) return [];
    return group.artists.filter((a) => a.ndArtistId !== ndId && a.collab !== true);
};

/** The name to keep unless the user says otherwise: the spelling with the most albums, first on a tie. */
export const defaultKeep = (artists: readonly Sibling[]): string => {
    let best: Sibling | undefined;
    for (const artist of artists) {
        if (!best || artist.albums > best.albums) best = artist;
    }
    return best?.ndArtistId ?? '';
};

/** `nd_id` is the entry whose name is kept; `from_nd_id` the spelling that is rewritten. */
export const planMerge = (
    thisId: string,
    otherId: string,
    keepId: string,
): null | { fromNdId: string; ndId: string } => {
    if (!thisId || !otherId || thisId === otherId) return null;
    if (keepId === thisId) return { fromNdId: otherId, ndId: thisId };
    if (keepId === otherId) return { fromNdId: thisId, ndId: otherId };
    return null;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const previewSentence = (files: number, albums: number): string =>
    `${plural(files, 'file', 'files')} in ${plural(albums, 'album', 'albums')}`;

/** Merge: `merging` -> `merged` | `failed`. */
export const MERGE_SPEC: PollSpec = {
    active: ['merging'],
    failed: ['failed'],
    failedNeedsActive: false,
    goneCode: 'no_merge',
    goneIsDone: false,
    settled: ['merged'],
};

/** Undo: `undoing`, then the row is deleted - 404 `no_merge` is the finish. */
export const UNDO_SPEC: PollSpec = {
    active: ['undoing'],
    failed: ['merged', 'failed'],
    failedNeedsActive: true,
    goneCode: 'no_merge',
    goneIsDone: true,
    settled: [],
};

/**
 * After a merge the rewritten spelling's Navidrome id is dead. Only when the user
 * is on that artist's own page does the app move, to the kept artist.
 */
export const decideMergeLeave = (input: {
    fromNdId: string;
    intoNdId: string;
    pathname: string;
}): { id: string; kind: 'artist' } | { kind: 'stay' } =>
    input.fromNdId && input.intoNdId && input.pathname.split('/').includes(input.fromNdId)
        ? { id: input.intoNdId, kind: 'artist' }
        : { kind: 'stay' };

export interface MergeFailure {
    code: string;
    kind: 'answer' | 'older' | 'retry';
    message: string;
    status: number;
}

/** Older = 405 or a code-less 404; everything else relays lb-bot's `error` (`different_artists`,
 *  `unknown_artist`, `busy`, `in_progress`, 400s). */
export const describeMergeFailure = (result: {
    code?: string;
    error?: string;
    retryable?: boolean;
    status: number;
}): MergeFailure => {
    const base = { code: result.code ?? '', status: result.status };
    const text = (result.error ?? '').trim();
    if (result.status === 405 || (result.status === 404 && !result.code)) {
        return {
            ...base,
            kind: 'older',
            message: 'This lb-bot is older and cannot merge artist names yet.',
        };
    }
    if (
        result.status === 0 ||
        result.status === 502 ||
        result.status === 503 ||
        result.status === 504
    ) {
        return {
            ...base,
            kind: 'retry',
            message: text || 'lb-bot did not answer. Nothing was changed.',
        };
    }
    return { ...base, kind: 'answer', message: text || 'lb-bot did not accept that.' };
};

export const mergeOutcomeSentence = (
    kind: 'merge' | 'undo',
    row: null | Pick<LbBotMergeRow, 'done' | 'failures' | 'state' | 'total'>,
): string => {
    if (kind === 'undo') {
        return row && (row.state === 'failed' || row.state === 'merged')
            ? 'lb-bot could not put all the previous names back.'
            : 'lb-bot put the previous names back.';
    }
    if (!row) return 'lb-bot retagged the files.';
    if (row.state === 'failed') {
        return `lb-bot did not finish retagging (${row.done} of ${plural(row.total, 'file', 'files')} written).`;
    }
    return `lb-bot retagged ${plural(row.done, 'file', 'files')}.`;
};

export type MergeBlockView =
    | { from: string; into: string; kind: 'job' }
    | { kind: 'form' }
    | { kind: 'hidden' };

/**
 * What the merge block shows. A job in flight or finished stays on screen for as
 * long as the dialog is open - once Navidrome re-indexes a merge lb-bot drops the
 * now-same-name group from `siblings`, and the result, its failures and Undo must
 * not vanish with it - so its names come from the poll's row, never from `siblings`.
 * Otherwise the form, when the hub advertises merging (`controls`) and the artist's
 * group has another spelling (`hasOthers`).
 */
export const mergeBlockView = (input: {
    controls: boolean;
    hasOthers: boolean;
    poll: null | { kind: 'merge' | 'undo'; row: null | Pick<LbBotMergeRow, 'from' | 'into'> };
}): MergeBlockView => {
    if (input.poll) {
        return {
            from: input.poll.row?.from.name ?? '',
            into: input.poll.row?.into.name ?? '',
            kind: 'job',
        };
    }
    return input.controls && input.hasOthers ? { kind: 'form' } : { kind: 'hidden' };
};
