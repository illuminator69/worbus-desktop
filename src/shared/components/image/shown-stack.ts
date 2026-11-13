/**
 * The images an image element shows while its request changes (BaseImage): the newest last. The one
 * kept underneath a new image is the last one that loaded, so changing twice fast never leaves an
 * empty frame; it goes once the new one has loaded (and faded in). Pure, for the harness.
 */
export type ShownEntry = { fade: boolean; loaded: boolean; src: string };

export const showNext = (list: ShownEntry[], src: string, fade: boolean): ShownEntry[] => {
    if (list[list.length - 1]?.src === src) return list;
    const under = [...list].reverse().find((entry) => entry.loaded && entry.src !== src);
    return [...(under ? [under] : []), { fade, loaded: false, src }];
};

export const markLoaded = (list: ShownEntry[], src: string): ShownEntry[] =>
    list.map((entry) => (entry.src === src && !entry.loaded ? { ...entry, loaded: true } : entry));

/** Drop what is underneath once the newest has loaded. */
export const dropUnder = (list: ShownEntry[]): ShownEntry[] => {
    const top = list[list.length - 1];
    return list.length > 1 && top?.loaded ? [top] : list;
};

/**
 * What the element shows for this render: nothing once the image is gone (no source, or it failed),
 * else the native image's current blob stacked over the last one that loaded. Gone wins over a
 * `displaySrc` the native image still holds from the request that just went away; the two used to
 * take turns, clearing and re-adding the same blob until React gave up (B-229, B-210). The result is
 * a fixed point: fed back with the same inputs it returns the same list, so a render-time update
 * settles in one step.
 */
export const nextShown = (
    list: ShownEntry[],
    displaySrc: string | undefined,
    gone: boolean,
    fade: boolean,
): ShownEntry[] => {
    if (gone) return list.length ? [] : list;
    if (displaySrc) return showNext(list, displaySrc, fade);
    return list;
};

/**
 * B-412: whether the element has no image to show for this render: no source, the fetch failed, or
 * the blob it fetched could not be decoded by the <img> (`undecodableSrc`, the blob its `error` named).
 * Gone clears the stack, so the previous item's cover is not left showing under a broken one.
 */
export const imageGone = (
    src: string | undefined,
    fetchFailed: boolean,
    displaySrc: string | undefined,
    undecodableSrc: null | string,
): boolean => !src || fetchFailed || (!!displaySrc && displaySrc === undecodableSrc);

/**
 * B-412: whether a fetched body may be an image. A Subsonic server answers a cover it cannot serve
 * with an error document under HTTP 200 (XML, or JSON with `f=json`); that is no image. A body with
 * no type, or a generic one, is left to the <img> to decode (its error counts too: `imageGone`).
 */
export const isImageBody = (contentType: string): boolean => {
    const type = contentType.split(';')[0].trim().toLowerCase();
    return !(type.startsWith('text/') || type.includes('json') || type.includes('xml'));
};
