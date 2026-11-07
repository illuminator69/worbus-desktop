import { useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { type DiscographyView } from '/@/renderer/features/discography/discography-model';
import { parseView, writeView } from '/@/renderer/features/discography/discography-view';

/**
 * The discography's view, read from and written to the page's URL (Call 1). Several keys change in
 * ONE update (react-router keeps only the last of several in one tick), with `replace`, so a filter
 * is never a history entry of its own and Back leaves the page with its filter as it was.
 */
export const useDiscographyView = () => {
    const [params, setParams] = useSearchParams();
    const location = useLocation();
    const state = location.state;
    const view = useMemo(() => parseView(params), [params]);
    const setView = useCallback(
        (patch: Partial<DiscographyView>) => {
            setParams((prev) => writeView({ ...parseView(prev), ...patch }, prev), {
                preventScrollReset: true,
                replace: true,
                state,
            });
        },
        [setParams, state],
    );
    return { setView, view };
};
