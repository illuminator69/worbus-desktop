import { useFastAverageColor } from '/@/renderer/hooks';
import { rolesFor } from '/@/renderer/themes/cover/cover-roles';
import { seedKey } from '/@/renderer/themes/cover/cover-seed-cache';
import { useCoverWashStore } from '/@/renderer/themes/cover/cover-wash.store';
import { oklchCss } from '/@/renderer/themes/cover/oklch';
import { useCoverSeed } from '/@/renderer/themes/cover/use-cover-seed';

/**
 * A detail page's header band from the page's own cover, in the window's mode (an album with a pale
 * cover on a dark window gets a dark band in the pale cover's hue). `background` is a full CSS
 * `background`, or `undefined` while the cover is unresolved, absent or failed, so the header shows
 * the window wash and never a guessed hue. With `Cover colours` off it is `useFastAverageColor`'s
 * colour, as before.
 */
export const useCoverHeaderWash = ({
    id,
    serverId,
    src,
    srcLoaded = true,
}: {
    id?: string;
    serverId?: string;
    src?: null | string;
    srcLoaded?: boolean;
}): { background: string | undefined; isLoading: boolean } => {
    const on = useCoverWashStore((state) => state.on);
    const windowLight = useCoverWashStore((state) => state.light);

    // Both always called (hooks); only the one in use gets a source, so the other does no work.
    const average = useFastAverageColor({
        id,
        src: on ? undefined : src,
        srcLoaded: !on && srcLoaded,
    });
    const key = on && serverId && id && src && srcLoaded ? seedKey(serverId, id) : undefined;
    const cover = useCoverSeed({ key, src: key ? src : undefined });

    if (!on) return { background: average.background, isLoading: average.isLoading };
    if (!key || !cover.resolved) return { background: undefined, isLoading: Boolean(key) };

    const roles = rolesFor(cover.seed, windowLight);
    return {
        background: `linear-gradient(180deg, ${oklchCss(roles.top)} 0, ${oklchCss(roles.mid)} 100%)`,
        isLoading: false,
    };
};
