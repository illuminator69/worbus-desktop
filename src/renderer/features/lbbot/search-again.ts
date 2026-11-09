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
 * the page shows for it). `refresh`: ask lb-bot afresh (`refresh=1`); `reshow`: show the cards
 * already found, no request. A press under an empty or failed answer is a Search again, and a plain
 * re-read within 60 s is answered from the hub's cache: the same nothing, with no search behind it.
 */
export const albumSearchPress = (
    state: 'empty' | 'failed' | 'idle' | 'ready' | 'waiting',
): 'none' | 'refresh' | 'reshow' => {
    if (state === 'failed' || state === 'empty') return 'refresh';
    if (state === 'ready') return 'reshow';
    return 'none';
};

/**
 * The gaps box's search POST: whether it says `force`. `press`: which control asked (`fillGaps`, the
 * box's first turn to its sources; `searchAgain`, a Search again button; `allowMp3`, the search
 * after allowing MP3). `sourcesShown`: the cards the box holds. A Search again always forces: the box
 * can hold no cards (a ledger summary, a failed fill's card) while lb-bot holds a young list it would
 * otherwise hand back as the "new" search. The first turn reuses a young list, as before.
 */
export const gapSearchForce = (
    press: 'allowMp3' | 'fillGaps' | 'searchAgain',
    sourcesShown: number,
): boolean => press === 'searchAgain' || sourcesShown > 0;
