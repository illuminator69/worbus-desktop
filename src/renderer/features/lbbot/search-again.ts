/**
 * navi-connect: what a source search press asks of lb-bot, out of the album page's request hook and
 * the gaps box so a harness can check it (B-256). Pure.
 *
 * Two caches stand between a press and a fresh Soulseek search: the hub keeps `/lb/album/sources`
 * answers 60 s (`refresh=1` bypasses it, B-256's hub half), and lb-bot reuses a gap's young source
 * list unless the search POST says `force`.
 */

/**
 * The album page's Find sources / Search again press, for the edition already asked (`state`: what
 * the page shows for it). `refresh`: ask lb-bot afresh (`refresh=1`); `read`: read the answer again;
 * `reshow`: show the cards already found, no request.
 */
export const albumSearchPress = (
    state: 'empty' | 'failed' | 'idle' | 'ready' | 'waiting',
): 'none' | 'read' | 'refresh' | 'reshow' => {
    if (state === 'failed' || state === 'empty') return 'read';
    if (state === 'ready') return 'reshow';
    return 'none';
};

/**
 * The gaps box's search POST: whether it says `force`. `press`: which control asked (`fillGaps`, the
 * box's first turn to its sources; `searchAgain`, a Search again button; `allowMp3`, the search
 * after allowing MP3). `sourcesShown`: the cards the box holds.
 */
export const gapSearchForce = (
    _press: 'allowMp3' | 'fillGaps' | 'searchAgain',
    sourcesShown: number,
): boolean => sourcesShown > 0;
