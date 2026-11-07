import styles from './wash-underlay.module.css';

import { WindowWash } from '/@/renderer/layouts/default-layout/window-wash';
import { useCoverWashOn } from '/@/renderer/themes/cover/cover-wash.store';

/**
 * What the page card shows at an element's spot, as an opaque underlay: the window's cover wash, drawn
 * again and shifted so it lines up with the one behind the window, under the card's own translucent
 * surface. For something that covers the page while it scrolls (the album and artist bar, the pinned
 * table rows): opaque so nothing reads through, and the colour the page has there, not a slab of
 * `--theme-colors-background` (B-216). The element sets `--wash-x` / `--wash-y`, its viewport corner,
 * and clips nothing itself: the underlay fills it and clips the copy. Nothing while the wash is off
 * (the element's own background is then the page's).
 */
export const WashUnderlay = () => {
    const on = useCoverWashOn();
    if (!on) return null;
    return (
        <div aria-hidden className={styles.underlay}>
            <div className={styles.window}>
                <WindowWash />
            </div>
        </div>
    );
};

const px = (value: number) => `${Math.round(value * 100) / 100}px`;

/** Write an element's viewport corner for its `WashUnderlay`, only when it moved. */
export const setWashOrigin = (el: HTMLElement, x: number, y: number) => {
    const wx = px(x);
    const wy = px(y);
    if (el.style.getPropertyValue('--wash-x') !== wx) el.style.setProperty('--wash-x', wx);
    if (el.style.getPropertyValue('--wash-y') !== wy) el.style.setProperty('--wash-y', wy);
};
