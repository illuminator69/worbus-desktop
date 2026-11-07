import clsx from 'clsx';
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';

import styles from './window-wash.module.css';

import {
    COLOUR_FADE_MS,
    flipLayers,
    type LayerPair,
    toneVars,
} from '/@/renderer/themes/cover/colour-change';
import { artCache } from '/@/renderer/themes/cover/cover-art';
import { useCoverWashOn, useCoverWashStore } from '/@/renderer/themes/cover/cover-wash.store';

interface ArtLayers {
    front: 0 | 1;
    /** Nothing shown: set when nothing plays, cleared once the next cover is on a layer. */
    neutral: boolean;
    srcs: [null | string, null | string];
}

/** One backdrop layer's fixed colours, keyed by their values. */
interface Tone {
    key: string;
    vars: Record<string, string>;
}

const sameTone = (a: Tone, b: Tone) => a.key === b.key;

/** `artSrc` on the other art layer, made the front; out of nothing playing the old cover is dropped. */
const showArt = (current: ArtLayers, artSrc: string): ArtLayers => {
    if (current.srcs[current.front] === artSrc) {
        return current.neutral ? { ...current, neutral: false } : current;
    }
    const front = current.front === 0 ? 1 : 0;
    const srcs: ArtLayers['srcs'] = current.neutral ? [null, null] : [...current.srcs];
    srcs[front] = artSrc;
    return { front, neutral: false, srcs };
};

const FOLD_EASE = 'cubic-bezier(0.3, 0.7, 0.2, 1)';

/**
 * Brings the front layer in over the back one, which stays fully shown underneath until the new one
 * is in. Both are opacity animations, which the compositor runs with no style work per frame. A
 * change in the middle of a fade restarts from the layer that was coming in, now held under the new
 * one, so an older colour never shows again.
 */
const fade = (front: HTMLElement | null, back: HTMLElement | null) => {
    if (!front || !back) return;
    for (const animation of [...front.getAnimations(), ...back.getAnimations()]) animation.cancel();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const easing =
        getComputedStyle(document.documentElement).getPropertyValue('--fold-ease').trim() ||
        FOLD_EASE;
    for (const el of [front, back]) el.setAttribute('data-moving', '');
    back.animate([{ opacity: 1 }, { opacity: 1 }], { duration: COLOUR_FADE_MS });
    const fadeIn = front.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: COLOUR_FADE_MS,
        easing,
    });
    // A cancelled fade's event arrives after the next fade has started: only a layer at rest is cleared.
    fadeIn.onfinish = () => {
        for (const el of [front, back]) {
            if (el.getAnimations().every((a) => a.playState !== 'running')) {
                el.removeAttribute('data-moving');
            }
        }
    };
    fadeIn.oncancel = fadeIn.onfinish;
};

/**
 * The cover wash behind the whole window: tone gradient, blurred artwork, veil (with the player
 * bar's band). Rendered only while `Cover colours` is on, and then always the same elements whatever
 * the state (only values change). The tone and the veil are each a pair of layers carrying fixed
 * colours: a change paints the new colours on the other layer and fades it in (the page's own
 * colours switch once, at the midpoint: use-cover-wash.ts). A new cover is decoded first, then fades
 * in on the other art layer over the old one. After nothing playing, the artwork stays hidden until
 * the new cover is on its layer (not the old one again).
 */
export const WindowWash = () => {
    const on = useCoverWashOn();
    const artSrc = useCoverWashStore((state) => state.artSrc);
    const backdrop = useCoverWashStore((state) => state.backdrop);
    const [art, setArt] = useState<ArtLayers>({
        front: 0,
        neutral: !artSrc,
        srcs: [artSrc, null],
    });

    const vars = toneVars(backdrop.roles, backdrop.mode);
    const tone: Tone = { key: JSON.stringify(vars), vars };
    const [tones, setTones] = useState<LayerPair<Tone>>({ front: 0, items: [tone, null] });
    const flipped = flipLayers(tones, tone, sameTone);
    if (flipped !== tones) setTones(flipped);

    const toneEls = useRef<[HTMLDivElement | null, HTMLDivElement | null]>([null, null]);
    const veilEls = useRef<[HTMLDivElement | null, HTMLDivElement | null]>([null, null]);
    // The pair as last painted; null until the layers exist, so the first frame shows the colours
    // directly (a cold start, or Cover colours turned on).
    const painted = useRef<LayerPair<Tone> | null>(null);

    useLayoutEffect(() => {
        if (!on) {
            painted.current = null;
            return;
        }
        const previous = painted.current;
        painted.current = tones;
        if (!previous || previous === tones) return;
        const back = tones.front === 0 ? 1 : 0;
        fade(toneEls.current[tones.front], toneEls.current[back]);
        fade(veilEls.current[tones.front], veilEls.current[back]);
    }, [on, tones]);

    // Before paint: the wash's store only names a cover once its artwork is decoded (use-cover-wash.ts),
    // so the artwork changes in the same frame as the colours. A cover not loaded through that path
    // (none today) is decoded first, then swapped in.
    useLayoutEffect(() => {
        if (!artSrc) {
            setArt((current) => (current.neutral ? current : { ...current, neutral: true }));
            return undefined;
        }
        if (artCache.isReady(artSrc)) {
            setArt((current) => showArt(current, artSrc));
            return undefined;
        }
        let live = true;
        // A cover that cannot decode is swapped in anyway: an empty layer, not the previous cover.
        void artCache.preload(artSrc).then(() => {
            if (live) setArt((current) => showArt(current, artSrc));
        });
        return () => {
            live = false;
        };
    }, [artSrc]);

    if (!on) return null;

    const pair = (kind: 'tone' | 'veil') =>
        tones.items.map((item, index) => (
            <div
                className={styles[kind]}
                data-front={index === tones.front ? '' : undefined}
                data-wash-tone={kind === 'tone' ? index : undefined}
                data-wash-veil={kind === 'veil' ? index : undefined}
                key={`${kind}${index}`}
                ref={(el) => {
                    (kind === 'tone' ? toneEls : veilEls).current[index] = el;
                }}
                style={(item?.vars ?? {}) as CSSProperties}
            />
        ));

    return (
        <div
            aria-hidden
            className={clsx(styles.wash, {
                [styles.light]: backdrop.mode === 'light',
                [styles.neutral]: !artSrc || art.neutral,
            })}
            // On a dark window a paler cover glows less (colour-change.ts, artOpacity); the light and
            // neutral values are the CSS classes'. The artwork's opacity transition eases the change.
            style={
                backdrop.mode === 'dark'
                    ? ({ '--wash-art-opacity': String(backdrop.artOpacity) } as CSSProperties)
                    : undefined
            }
        >
            {pair('tone')}
            <div className={styles.art}>
                {art.srcs.map((src, index) => (
                    <div
                        className={clsx(styles.layer, { [styles.front]: index === art.front })}
                        key={index}
                        style={{ backgroundImage: src ? `url(${JSON.stringify(src)})` : undefined }}
                    />
                ))}
            </div>
            {pair('veil')}
        </div>
    );
};
