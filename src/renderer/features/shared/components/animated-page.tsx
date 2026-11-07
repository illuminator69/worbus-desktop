import type { ReactNode, Ref } from 'react';

import { forwardRef, useState } from 'react';
import { useLocation } from 'react-router';

import styles from './animated-page.module.css';

import {
    cameFromFrame,
    useLibraryFrame,
} from '/@/renderer/features/library/hooks/use-library-frame';
import { useNavDirection } from '/@/renderer/features/motion/use-nav-direction';

interface AnimatedPageProps {
    children: ReactNode;
}

/**
 * A route's page. It arrives with the grammar's push or pop (design brief 8): 18 px from the right on a
 * push, from the left on a back, a fade otherwise, 220 ms, and no exit (the old page leaves at once).
 * Inside the Library frame, coming from another of its pages (a chip change), it is the section switch
 * instead: it rises 8 px in 200 ms and fades in 180 ms, under the title and chips that stay still.
 */
export const AnimatedPage = forwardRef(
    ({ children }: AnimatedPageProps, ref: Ref<HTMLDivElement>) => {
        // Unconditional: it records the history index on every location change.
        const direction = useNavDirection();
        const { inFrame } = useLibraryFrame();
        const { key } = useLocation();
        const [tab] = useState(() => inFrame && cameFromFrame(key));

        return (
            <main className={styles.animatedPage} data-nav={tab ? 'tab' : direction} ref={ref}>
                {children}
            </main>
        );
    },
);
