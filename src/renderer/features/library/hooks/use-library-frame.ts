import { createContext, useContext } from 'react';

/**
 * F6: the Library frame's context. A page inside the frame portals its header controls (play button,
 * count, list search) into the frame's title row, `slot`, and draws no title of its own.
 */
export type LibraryFrameValue = { inFrame: boolean; slot: HTMLElement | null };

export const LibraryFrameContext = createContext<LibraryFrameValue>({ inFrame: false, slot: null });

export const useLibraryFrame = (): LibraryFrameValue => useContext(LibraryFrameContext);

// The location keys the mounted frame has seen: the current one and the one before it. Both are
// cleared when the frame unmounts, so entering Library from elsewhere, or Back from a detail page,
// finds no previous key.
let frameLastKey: null | string = null;
let framePrevKey: null | string = null;

/** Called by the frame in an effect on every location change. */
export const recordFrameLocation = (key: string): void => {
    if (key === frameLastKey) return;
    framePrevKey = frameLastKey;
    frameLastKey = key;
};

/** Called by the frame when it unmounts. */
export const clearFrameLocation = (): void => {
    frameLastKey = null;
    framePrevKey = null;
};

/**
 * Whether the page now mounting at `key` was reached from another page inside the frame (a chip
 * change, the grammar's section switch). A lazy page mounts after the frame has recorded its key, so
 * the key before it is the one that counts then.
 */
export const cameFromFrame = (key: string): boolean =>
    (frameLastKey === key ? framePrevKey : frameLastKey) !== null;
