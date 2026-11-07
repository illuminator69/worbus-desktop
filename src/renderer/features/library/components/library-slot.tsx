import type { ReactNode } from 'react';

import { createPortal } from 'react-dom';

import { useLibraryFrame } from '/@/renderer/features/library/hooks/use-library-frame';

/**
 * A page's header controls, drawn at the right of the Library frame's title row. Outside the frame it
 * renders nothing: the page's own header row is used there.
 */
export const LibraryFrameActions = ({ children }: { children: ReactNode }) => {
    const { inFrame, slot } = useLibraryFrame();
    if (!inFrame || !slot) return null;
    return createPortal(children, slot);
};
