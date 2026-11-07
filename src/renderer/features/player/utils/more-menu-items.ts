// F1: the rows of the player bar's More menu (more-control.tsx), the controls used too rarely to
// earn a place on the bar. Pure (more-menu-items.harness.ts). Play random (upstream's Shuffle all,
// the modal) moved here from the transport (R14, B-252, the owner); it is left out while a radio
// stream plays, where the bar had it disabled.
//
// `panel` rows drill into a view inside the same popover; `action` rows act and close it.
// Cast to a TV is the DLNA feature, which exists only in Electron. A radio stream keeps the same
// rows but Play random: Stop then ends the radio (more-control.tsx decides how).

export interface MoreItem {
    id: MoreItemId;
    kind: 'action' | 'panel';
    separatorBefore?: boolean;
}

export type MoreItemId =
    | 'autoDj'
    | 'dlna'
    | 'equaliser'
    | 'lyrics'
    | 'playbackOptions'
    | 'playRandom'
    | 'sleepTimer'
    | 'stop';

export function moreMenuItems(ctx: { isElectron: boolean; isRadioActive: boolean }): MoreItem[] {
    const items: MoreItem[] = [];
    if (!ctx.isRadioActive) items.push({ id: 'playRandom', kind: 'action' });
    items.push(
        { id: 'sleepTimer', kind: 'panel' },
        { id: 'equaliser', kind: 'action' },
        { id: 'lyrics', kind: 'action' },
    );
    if (ctx.isElectron) items.push({ id: 'dlna', kind: 'panel' });
    items.push(
        { id: 'playbackOptions', kind: 'panel' },
        { id: 'autoDj', kind: 'panel' },
        { id: 'stop', kind: 'action', separatorBefore: true },
    );
    return items;
}
