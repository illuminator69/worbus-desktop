import type { LbBotGapSource } from '/@/shared/types/lbbot-types';

/**
 * navi-connect R11 (B-222): what a source card says and which card the box may choose on the user's
 * behalf, shared by the missing album's box and the album page's gaps box. Pure, so
 * `source-cards-model.harness.ts` runs it; Worbus for Android's copy is `preselectedSource` (RequestStage.kt) and
 * `coverageText` (SourceCards.kt), written by hand (no shared build).
 */

/** B-019 (ruling R4): a missing `artistVerified` is the server's own `True` default. */
export const isSourceVerified = (source: Pick<LbBotGapSource, 'artistVerified'>): boolean =>
    source.artistVerified !== false;

/**
 * A source the box may select without being asked: lb-bot's recommendation, with the artist found
 * in the folder, the folder read as this album, and every track of the release in it (the same bar
 * the one-tap acquire posts on). Anything less is a choice the user makes: a tap is consent, a
 * default is not.
 */
export const isSafeSource = (
    source: Pick<
        LbBotGapSource,
        'albumMatchOk' | 'artistVerified' | 'coverageFull' | 'recommended'
    >,
): boolean =>
    source.recommended && isSourceVerified(source) && source.albumMatchOk && source.coverageFull;

/**
 * The card selected when the sources arrive: the id of the source lb-bot marks safe, else none,
 * and then there is no Download button until a card is chosen.
 */
export const initialSelection = (
    sources: Pick<
        LbBotGapSource,
        'albumMatchOk' | 'artistVerified' | 'coverageFull' | 'id' | 'recommended'
    >[],
): null | number => sources.find(isSafeSource)?.id ?? null;

/**
 * A gap's source the box may select without being asked: Worbus for Android's three terms (`preselectedSource`),
 * no coverage term. lb-bot's gap sources (`_source_view`) carry no `coverageFull`, so the album's
 * rule never fired for a gap (review minor 4); a gap's folder is judged against the missing tracks
 * only, which the card's coverage line shows.
 */
export const isSafeGapSource = (
    source: Pick<LbBotGapSource, 'albumMatchOk' | 'artistVerified' | 'recommended'>,
): boolean => source.recommended && isSourceVerified(source) && source.albumMatchOk;

/** The gap's card selected when its sources arrive: the safe one by `isSafeGapSource`, else none. */
export const initialGapSelection = (
    sources: Pick<LbBotGapSource, 'albumMatchOk' | 'artistVerified' | 'id' | 'recommended'>[],
): null | number => sources.find(isSafeGapSource)?.id ?? null;

/**
 * The selection a box shows: the user's pick while it is still on the list, else the preselected
 * one (the album's rule unless the caller passes the gap's).
 */
export const shownSelection = (
    sources: Pick<
        LbBotGapSource,
        'albumMatchOk' | 'artistVerified' | 'coverageFull' | 'id' | 'recommended'
    >[],
    picked: null | number,
    preselected: null | number = initialSelection(sources),
): null | number =>
    picked !== null && sources.some((source) => source.id === picked) ? picked : preselected;

/**
 * A source's identity across searches: its peer and folder. lb-bot numbers sources by their place
 * in the current list, so after Search again an index names another folder (review minor 11).
 */
export const sourceKey = (source: Pick<LbBotGapSource, 'folder' | 'peer'>): string =>
    `${source.peer}\n${source.folder}`;

/** The rank lb-bot gave the folder, 1 first; the list position when it sent none. */
export const sourceRank = (source: Pick<LbBotGapSource, 'id' | 'rank'>): number =>
    source.rank || source.id + 1;

/**
 * Which coverage line a card shows, "All 12 tracks" / "9 of 12 tracks", paired against the
 * canonical tracklist and never a file count; lb-bot's own coverage word when it sent no counts.
 * The words are en.json's (`naviConnect.sourceCard.*`), so this says which and with what.
 */
export type CoverageText =
    | { have: number; kind: 'some'; total: number }
    | { kind: 'all'; total: number }
    | { kind: 'unknown' }
    | { kind: 'word'; word: string };

export const coverageText = (
    source: Pick<LbBotGapSource, 'coverage' | 'coverageDetail'>,
): CoverageText => {
    const { haveTracks, totalTracks } = source.coverageDetail;
    if (totalTracks > 0 && haveTracks >= totalTracks) return { kind: 'all', total: totalTracks };
    if (totalTracks > 0) return { have: haveTracks, kind: 'some', total: totalTracks };
    return source.coverage ? { kind: 'word', word: source.coverage } : { kind: 'unknown' };
};

/** Format, bitrate and size: the quality actually on offer (lb-bot's own strings). */
export const qualityLine = (source: Pick<LbBotGapSource, 'bitrate' | 'format' | 'size'>): string =>
    [source.format, source.bitrate, source.size].filter(Boolean).join(' · ');

/** The folder's own name, the last path segment (Soulseek paths use either slash). */
export const folderName = (source: Pick<LbBotGapSource, 'folder' | 'peer'>): string =>
    source.folder.split(/[\\/]/).filter(Boolean).pop() || source.peer;

/**
 * B-418: what a card names a folder by: its last two path segments ("Debut Live / CD1"), since on
 * Soulseek the last one is often a disc or format folder and its parent carries the words that tell
 * folders apart. A share root (`@@…`) is not a name. The card's hover shows the full path. lb-bot
 * sends a non-admin the last segment alone, which is shown as it is.
 */
export const folderLabel = (source: Pick<LbBotGapSource, 'folder' | 'peer'>): string => {
    const parts = source.folder.split(/[\\/]/).filter((part) => part && !part.startsWith('@@'));
    return parts.slice(-2).join(' / ') || source.peer;
};

/**
 * lb-bot's machine-readable reasons for refusing a Request because the card's list is gone (its
 * `/api/gaps/<id>/fetch`): `stale_source` (409), the card's folder is not in the list lb-bot holds
 * now (a newer search replaced it; B-360, source ids are folder identities); `no_sources`, there is
 * no kept list at all; and `bad_source`, which an lb-bot from before B-360 sent for an index past
 * the end of the list (a newer one sends it only for an id that is not a number).
 */
const STALE_LIST_CODES = new Set(['bad_source', 'no_sources', 'stale_source']);

/**
 * R12 (B-238): whether a refused Request says the cards on screen are stale, so Search again sits
 * beside lb-bot's sentence. Read from the response's fields: its `code` when it has one, else the HTTP
 * status (only 410 Gone says so). Never from the sentence, which is lb-bot's English for people.
 */
export const refusalSaysListIsStale = ({
    code,
    status,
}: {
    code?: string;
    status: number;
}): boolean => (code ? STALE_LIST_CODES.has(code) : status === 410);

/**
 * R12 (review F3): the refusal a card shows under its button, matched by the folder it was asked for
 * (`sourceKey`), never by the card's index: lb-bot numbers cards by their place in the current list,
 * so after a search started elsewhere index 0 can be another folder, and lb-bot's "no longer in the
 * list" must not land under a valid one.
 */
export const refusalUnder = <R extends { sourceKey: string }>(
    refusal: null | R,
    source: Pick<LbBotGapSource, 'folder' | 'peer'>,
): null | R => (refusal && refusal.sourceKey === sourceKey(source) ? refusal : null);

/**
 * A folder's listing as `useGapSourceFiles` keeps it: lb-bot's answer, and the source list
 * (`sourcesFoundAt`) the card was read from when it was asked.
 */
export interface KeptListing<R extends { ok: boolean }> {
    listAt: number;
    result: R;
}

/**
 * Whether a chosen card's listing is asked of lb-bot: when it never was, or when what is kept is
 * a refusal about an earlier list. A listing describes the folder and is kept (cards are keyed by
 * folder). A refusal describes the list the card came from: `stale_source` (B-360) says lb-bot's
 * list no longer holds the folder, and the folder can come back in a later search under the same
 * id, where asking again is the only way to see its files.
 */
export const listingNeedsAsking = (
    kept: KeptListing<{ ok: boolean }> | undefined,
    listAt: number,
): boolean => !kept || (!kept.result.ok && kept.listAt !== listAt);
