// navi-connect (B-227): what plays after the current song in a hub session. Pure, so the rule can be
// tested without React or the hub store (remote-next.harness.ts).
//
// The session's `index` is a queue index; when it shuffles, `order` lists queue indexes in play
// order (PROTOCOL section 4.2). Reading `index + 1` showed a song that would not play next under
// shuffle, and nothing at the last song under repeat-all while playback wrapped. This answers the
// way the local player answers for its own queue (player.store): repeat-one gives the same song,
// repeat-all wraps to the first in play order, and the end without repeat gives null. An `order`
// that does not cover the queue is ignored, as remainingRemote ignores it: the hub rebuilds it on
// the next frame.

export interface RemoteNextInput {
    index: number;
    length: number;
    order: null | readonly number[] | undefined;
    repeat: 'all' | 'none' | 'one';
}

export const remoteNextIndex = ({
    index,
    length,
    order,
    repeat,
}: RemoteNextInput): null | number => {
    if (length <= 0 || index < 0 || index >= length) return null;
    if (repeat === 'one') return index;
    const position = order && order.length === length ? order.indexOf(index) : -1;
    const playOrder =
        position >= 0 && order ? order : Array.from({ length }, (_, queueIndex) => queueIndex);
    const at = position >= 0 ? position : index;
    if (at + 1 < length) return playOrder[at + 1];
    return repeat === 'all' ? playOrder[0] : null;
};
