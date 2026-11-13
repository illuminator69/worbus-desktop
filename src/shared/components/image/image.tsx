import clsx from 'clsx';
import {
    CSSProperties,
    ForwardedRef,
    forwardRef,
    HTMLAttributes,
    type ImgHTMLAttributes,
    memo,
    ReactNode,
    SyntheticEvent,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { imageMemoryCache } from './image-memory-cache';
import styles from './image.module.css';
import { dropUnder, imageGone, markLoaded, nextShown, type ShownEntry } from './shown-stack';
import { useNativeImage } from './use-native-image';

import { tintHues } from '/@/shared/components/animations/tint-hues';
import { AppIcon, Icon } from '/@/shared/components/icon/icon';
import { useDebouncedValue } from '/@/shared/hooks/use-debounced-value';
import { useInViewport } from '/@/shared/hooks/use-in-viewport';
import { ImageRequest } from '/@/shared/types/domain-types';

const loadedImageCacheKeys = new Set<string>();

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
    containerClassName?: string;
    enableAnimation?: boolean;
    enableDebounce?: boolean;
    enableViewport?: boolean;
    fetchPriority?: 'auto' | 'high' | 'low';
    hashUrl?: null | string;
    imageContainerProps?: Omit<ImageContainerProps, 'children'>;
    imageRequest?: ImageRequest;
    includeLoader?: boolean;
    includeUnloader?: boolean;
    isExplicit?: boolean;
    src: string | undefined;
    unloaderIcon?: keyof typeof AppIcon;
}

interface ImageContainerProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    hashUrl?: null | string;
    isExplicit?: boolean;
}

interface ImageUnloaderProps {
    className?: string;
    icon?: keyof typeof AppIcon;
}

export const FALLBACK_SVG =
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iLjc1IiBzdGl0Y2hUaWxlcz0ic3RpdGNoIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGZpbHRlcj0idXJsKCNhKSIgb3BhY2l0eT0iLjA1IiBkPSJNMCAwaDMwMHYzMDBIMHoiLz48L3N2Zz4=';

export function BaseImage({
    className,
    containerClassName,
    enableAnimation = false,
    enableDebounce = false,
    enableViewport = true,
    fetchPriority = 'low',
    hashUrl,
    imageContainerProps,
    imageRequest,
    includeLoader = true,
    includeUnloader = true,
    isExplicit = false,
    onError,
    onLoad,
    src,
    unloaderIcon = 'emptyImage',
    ...props
}: ImageProps) {
    const viewport = useInViewport();
    const { inViewport, ref } = enableViewport ? viewport : { inViewport: true, ref: undefined };
    const { className: containerPropsClassName, ...restContainerProps } = imageContainerProps || {};

    const rawImageRequest = useMemo(
        () => imageRequest ?? (src ? { cacheKey: src, url: src } : undefined),
        [imageRequest, src],
    );
    const isInSessionCache = Boolean(
        rawImageRequest?.cacheKey && loadedImageCacheKeys.has(rawImageRequest.cacheKey),
    );
    const [debouncedImageRequest] = useDebouncedValue(rawImageRequest, 100, {
        waitForInitial: true,
    });
    const effectiveImageRequest =
        isInSessionCache || !enableDebounce ? rawImageRequest : debouncedImageRequest;

    const [hasLoadedInInstance, setHasLoadedInInstance] = useState(false);

    useEffect(() => {
        setHasLoadedInInstance(false);
    }, [effectiveImageRequest?.cacheKey]);

    const shouldLoadImage = Boolean(
        effectiveImageRequest &&
        (!enableViewport || isInSessionCache || inViewport || hasLoadedInInstance),
    );

    const nativeImage = useNativeImage({
        enabled: shouldLoadImage,
        fetchPriority,
        onFetchError: src
            ? () => {
                  (onError as ((event: undefined) => void) | undefined)?.(undefined);
              }
            : undefined,
        request: effectiveImageRequest,
    });

    useEffect(() => {
        if (!nativeImage.isLoaded || !effectiveImageRequest?.cacheKey) {
            return;
        }

        loadedImageCacheKeys.add(effectiveImageRequest.cacheKey);
        setHasLoadedInInstance(true);
    }, [effectiveImageRequest?.cacheKey, nativeImage.isLoaded]);

    // Fade or not is decided once per displayed image, when its request starts: `isInSessionCache`
    // turns true right after the load and would otherwise drop the class mid-fade. An image the
    // session already loaded (a recycled grid cell, a page seen before) shows at once.
    const requestKey = rawImageRequest?.cacheKey;
    const fadeDecision = useRef<{ fade: boolean; key?: string }>({ fade: false });

    if (fadeDecision.current.key !== requestKey) {
        fadeDecision.current = { fade: !isInSessionCache, key: requestKey };
    }

    const fade = enableAnimation || Boolean(hashUrl) || fadeDecision.current.fade;

    // The images on screen, the newest last, each with its own fade decision. A changed request
    // keeps the last image that loaded mounted underneath (its blob URL is already revoked, so only
    // the loaded element can still show it) until the new one has loaded and faded in over it.
    const [shown, setShown] = useState<ShownEntry[]>([]);
    const displaySrc = nativeImage.displaySrc;
    // B-412: the blob the top <img> could not decode. Gone, like a failed fetch: the previous
    // item's cover is not kept under it.
    const [undecodable, setUndecodable] = useState<null | string>(null);
    const gone = imageGone(src, nativeImage.isError, displaySrc, undecodable);
    const nextList = nextShown(shown, displaySrc, gone, fade);
    if (nextList !== shown) setShown(nextList);
    const settle = () => setShown(dropUnder);
    const handleLoad = (event: SyntheticEvent<HTMLImageElement>, loadedSrc: string) => {
        const animating = event.currentTarget.getAnimations().length > 0;
        setShown((list) => {
            const marked = markLoaded(list, loadedSrc);
            return animating ? marked : dropUnder(marked);
        });
        onLoad?.(event);
    };

    const seed = props.id || rawImageRequest?.cacheKey || src || '';
    const [tintA, tintB] = useMemo(() => tintHues(seed), [seed]);
    const showTint = includeLoader && !gone && !hashUrl;

    return (
        <ImageContainer
            className={clsx(containerClassName, containerPropsClassName)}
            {...restContainerProps}
            hashUrl={hashUrl}
            isExplicit={isExplicit}
            ref={ref}
        >
            {showTint && (
                <div
                    aria-hidden
                    className={clsx(styles.hash, styles.tint, {
                        [styles.tintDone]: shown.length > 0,
                    })}
                    style={{ '--tint-a': tintA, '--tint-b': tintB } as CSSProperties}
                />
            )}
            {shown.length > 0 ? (
                shown.map((entry, index) => {
                    const top = index === shown.length - 1;
                    return (
                        <img
                            className={clsx(styles.image, className, {
                                [styles.animated]: top && entry.fade,
                                [styles.under]: !top,
                            })}
                            decoding="async"
                            fetchPriority={fetchPriority}
                            key={entry.src}
                            onAnimationEnd={top ? settle : undefined}
                            onError={
                                top
                                    ? (event) => {
                                          // Not kept for the next mount either (B-412 follow-up).
                                          imageMemoryCache.forget(entry.src);
                                          setUndecodable(entry.src);
                                          onError?.(event);
                                      }
                                    : onError
                            }
                            onLoad={top ? (event) => handleLoad(event, entry.src) : undefined}
                            src={entry.src}
                            {...props}
                            id={top ? props.id : undefined}
                        />
                    );
                })
            ) : gone && (!src || includeUnloader) ? (
                <ImageUnloader className={className} icon={unloaderIcon} />
            ) : null}
        </ImageContainer>
    );
}

export const Image = memo(BaseImage);

const ImageContainer = forwardRef(
    (
        { children, className, hashUrl, isExplicit, ...props }: ImageContainerProps,
        ref: ForwardedRef<HTMLDivElement>,
    ) => {
        return (
            <div
                className={clsx(styles.imageContainer, className, {
                    [styles.censored]: isExplicit,
                })}
                ref={ref}
                {...props}
            >
                {hashUrl && (
                    <div
                        aria-hidden
                        className={styles.hash}
                        style={{ backgroundImage: `url(${hashUrl})` }}
                    />
                )}
                {children}
            </div>
        );
    },
);

export function ImageUnloader({ className, icon = 'emptyImage' }: ImageUnloaderProps) {
    return (
        <div className={clsx(styles.unloader, className)}>
            <Icon color="default" icon={icon} size="25%" />
        </div>
    );
}
