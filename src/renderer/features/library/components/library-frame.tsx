import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';

import styles from './library-frame.module.css';

import { LibraryChips } from '/@/renderer/features/library/components/library-chips';
import {
    clearFrameLocation,
    LibraryFrameContext,
    recordFrameLocation,
} from '/@/renderer/features/library/hooks/use-library-frame';
import { Spinner } from '/@/shared/components/spinner/spinner';

/**
 * F6: Library as one place (design brief 7.2). A layout route around the library's list pages: the
 * title "Library", the chips, and the page below. Each page's header controls are portalled into the
 * title row's slot, so no page draws a second title. The title and the chips belong to the frame, not
 * to the page: a chip change re-renders neither, and the page's own Suspense boundary keeps them on
 * screen while a page's code loads for the first time.
 */
export const LibraryFrame = () => {
    const { t } = useTranslation();
    const { key } = useLocation();
    // Created once, before the first child renders, so a page can portal into it on its first render;
    // attached without ever being moved again (a move would blur a focused search input in it).
    const [slot] = useState(() => {
        const el = document.createElement('div');
        el.className = styles.slot;
        el.setAttribute('data-library-slot', '');
        return el;
    });
    const attachSlot = useCallback(
        (node: HTMLDivElement | null) => {
            if (node && slot.parentNode !== node) node.appendChild(slot);
        },
        [slot],
    );

    useEffect(() => {
        recordFrameLocation(key);
    }, [key]);
    useEffect(() => clearFrameLocation, []);

    const value = useMemo(() => ({ inFrame: true, slot }), [slot]);

    return (
        <LibraryFrameContext.Provider value={value}>
            <div className={styles.frame} data-library-frame>
                <div className={styles.head}>
                    <div className={styles.titleRow}>
                        <h1 className={styles.title} data-library-title>
                            {t('page.library.title')}
                        </h1>
                        <div className={styles.slotHost} ref={attachSlot} />
                    </div>
                    <LibraryChips />
                </div>
                <div className={styles.body}>
                    <Suspense fallback={<Spinner container />}>
                        <Outlet />
                    </Suspense>
                </div>
            </div>
        </LibraryFrameContext.Provider>
    );
};

export default LibraryFrame;
