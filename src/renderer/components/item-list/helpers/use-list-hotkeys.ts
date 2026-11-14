import { type RefObject, useRef } from 'react';
import { useNavigate } from 'react-router';

import { getTitlePath } from '/@/renderer/components/item-list/helpers/get-title-path';
import {
    ItemListStateActions,
    ItemListStateItemWithRequiredProperties,
} from '/@/renderer/components/item-list/helpers/item-list-state';
import { listHotkey, listTakesKey } from '/@/renderer/components/item-list/helpers/list-hotkey';
import { ItemControls } from '/@/renderer/components/item-list/types';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import { useHotkeySettings, usePlayButtonBehavior } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

export const useListHotkeys = ({
    controls,
    focusContainerRef,
    focused,
    internalState,
    itemType,
    onShowPlayingSong,
}: {
    controls: ItemControls;
    focusContainerRef?: RefObject<HTMLElement | null>;
    focused: boolean;
    internalState: ItemListStateActions;
    itemType: LibraryItem;
    onShowPlayingSong?: () => void;
}) => {
    const { bindings } = useHotkeySettings();
    const playButtonBehavior = usePlayButtonBehavior();
    const navigate = useNavigate();
    const focusedRef = useRef(focused);
    focusedRef.current = focused;
    const internalStateRef = useRef(internalState);
    internalStateRef.current = internalState;

    // m3, n3: a focused control inside a row keeps Enter (and the other play/open keys); only a
    // text field keeps select-all.
    const listTakes = (keepFor: 'control' | 'text') => () => {
        const container = focusContainerRef?.current;
        if (container) {
            return listTakesKey(container, document.activeElement, keepFor);
        }

        return focusedRef.current;
    };
    const isListFocused = listTakes('control');

    // Helper to check if item has required properties
    const hasRequiredStateItemProperties = (
        item: unknown,
    ): item is ItemListStateItemWithRequiredProperties => {
        return (
            typeof item === 'object' &&
            item !== null &&
            'id' in item &&
            typeof (item as any).id === 'string' &&
            '_serverId' in item &&
            typeof (item as any)._serverId === 'string' &&
            '_itemType' in item &&
            typeof (item as any)._itemType === 'string'
        );
    };

    const playSelected = (playType: Play) => {
        const selected = internalStateRef.current.getSelected();
        const validSelected = selected.filter(hasRequiredStateItemProperties);
        if (validSelected.length === 0) return;
        controls.onPlay?.({ item: validSelected[0], itemType, playType } as any);
    };

    useHotkeys([
        listHotkey('mod+a', listTakes('text'), () => {
            const state = internalStateRef.current;
            if (state.isAllSelected()) {
                state.deselectAll();
            } else {
                state.selectAll();
            }
        }),
        listHotkey(bindings.listPlayDefault.hotkey, isListFocused, () =>
            playSelected(playButtonBehavior),
        ),
        listHotkey(bindings.listPlayNow.hotkey, isListFocused, () => playSelected(Play.NOW)),
        listHotkey(bindings.listPlayNext.hotkey, isListFocused, () => playSelected(Play.NEXT)),
        listHotkey(bindings.listPlayLast.hotkey, isListFocused, () => playSelected(Play.LAST)),
        listHotkey(bindings.listNavigateToPage.hotkey, isListFocused, () => {
            const selected = internalStateRef.current.getSelected();
            const validSelected = selected.filter(hasRequiredStateItemProperties);
            if (validSelected.length === 0) return;

            const item = validSelected[0];
            const path = getTitlePath(itemType, item.id);
            if (path) {
                navigate(path, { state: { item } });
            }
        }),
        [
            bindings.listShowPlayingSong.hotkey,
            () => {
                onShowPlayingSong?.();
            },
        ],
    ]);
};
