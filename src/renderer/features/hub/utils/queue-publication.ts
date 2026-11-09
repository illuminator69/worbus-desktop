/**
 * W1 (B-305): what this device tells the hub about the queue it plays, beside the tracks, in an
 * `act:setQueue`. Kept free of imports so `node --test` can run it.
 */

/** The player store's slice a publication reads. */
export interface PublicationState {
    player: { index: number; shuffle: string };
    queue: { default: readonly string[]; shuffled: readonly number[] };
}

/**
 * The `setQueue` fields that place the playhead. `withOrder`: the hub lists `playOrder` in
 * `welcome.features`.
 */
export const publicationFields = (
    state: PublicationState,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _withOrder: boolean,
): { index: number } => ({
    index: state.player.index,
});
