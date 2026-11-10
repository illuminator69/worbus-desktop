import { useCallback, useMemo } from 'react';
import { useNavigationType } from 'react-router';

import { useEntryKey } from '/@/renderer/hooks/use-entry-key';
import { useScrollStore } from '/@/renderer/store/scroll.store';

interface UseItemListScrollPersistProps {
    enabled: boolean;
}

export const useItemListScrollPersist = ({ enabled }: UseItemListScrollPersistProps) => {
    // B-315: an entry the router did not key gets one of its own.
    const entryKey = useEntryKey();
    const navigationType = useNavigationType();
    const setOffset = useScrollStore((s) => s.setOffset);
    const getOffset = useScrollStore((s) => s.getOffset);

    const scrollOffset = useMemo(() => {
        if (navigationType !== 'POP') return undefined;
        return getOffset(entryKey);
    }, [getOffset, entryKey, navigationType]);

    const handleOnScrollEnd = useCallback(
        (offset: number) => {
            if (!enabled) return;
            setOffset(entryKey, offset);
        },
        [enabled, entryKey, setOffset],
    );

    return { handleOnScrollEnd, scrollOffset };
};
