import { ReactNode, useState } from 'react';

/**
 * R13 (B-244): keeps drawing the children it last had while `hold` is set, so a box folding away
 * folds with its last view in it rather than emptying at the first frame. The children it shows are
 * the latest whenever `hold` is off.
 */
export const HoldWhile = ({ children, hold }: { children: ReactNode; hold: boolean }) => {
    const [kept, setKept] = useState(children);
    // The props of the render before (React's "storing information from previous renders").
    if (!hold && kept !== children) setKept(children);
    return hold ? kept : children;
};
