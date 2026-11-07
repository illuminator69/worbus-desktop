import { generateColors } from '@mantine/colors-generator';
import clsx from 'clsx';
import { useEffect, useState } from 'react';

import styles from './library-background-overlay.module.css';

import { bandBox } from '/@/renderer/features/shared/components/band-box';
import { useAppThemeColors } from '/@/renderer/themes/use-app-theme';

interface LibraryBackgroundOverlayProps {
    /** A full CSS `background` (a colour or a gradient), drawn under the theme's subheader shade. */
    background?: string;
    headerRef: React.RefObject<HTMLDivElement | null>;
    opacity?: number;
    /**
     * How far the band runs past the header, its last 64 px fading out. A page hero's band ends with
     * the hero (0, R13 B-237: it used to run 64 px on under the first row of content, and that row sat
     * on its edge); the bar's own band runs 64 px under the bar.
     */
    tail?: number;
}

export const LibraryBackgroundOverlay = ({
    background,
    headerRef,
    opacity = 0.7,
    tail = 0,
}: LibraryBackgroundOverlayProps) => {
    const height = useHeaderHeight(headerRef);
    const isGradient = background?.includes('gradient(');

    return (
        <div
            className={styles.overlay}
            style={{
                // A colour stays a background colour under the class's subheader image, as before; a
                // gradient (the cover header wash) joins the image list under the subheader shade.
                backgroundColor: isGradient ? undefined : background,
                backgroundImage: isGradient
                    ? `var(--theme-overlay-subheader), ${background}`
                    : undefined,
                ...bandBox({ height, tail }),
                opacity,
            }}
        />
    );
};

interface BackgroundOverlayProps {
    backgroundColor?: string;
    direction?: string;
    height?: number | string;
    opacity?: number;
}

export const BackgroundOverlay = ({
    backgroundColor,
    direction = 'to bottom',
    height = '100%',
    opacity,
}: BackgroundOverlayProps) => {
    const theme = useAppThemeColors();

    const colors = generateColors(backgroundColor || theme.color['--theme-colors-background']);

    return (
        <div
            className={clsx(styles.backgroundOverlay)}
            style={
                {
                    '--color-from': colors[6],
                    '--color-to': colors[9],
                    '--direction-and-possibly-color-interpolation': direction,
                    '--dither': 'none',
                    backgroundColor: backgroundColor,
                    height,
                    opacity,
                } as React.CSSProperties
            }
        />
    );
};

interface LibraryBackgroundProps {
    blur?: number;
    headerRef: React.RefObject<HTMLDivElement | null>;
    imageUrl: null | string;
}

export const LibraryBackgroundImage = ({ blur, headerRef, imageUrl }: LibraryBackgroundProps) => {
    const url = imageUrl ? `url(${imageUrl})` : undefined;
    const height = useHeaderHeight(headerRef);
    // R13 (B-237): the image and its shade end with the hero and fade out over its last 64 px, as the
    // wash band does; the shade used to run 64 px on and end in an edge across the first row.
    const bandHeight = height ? `${height}px` : undefined;
    return (
        <div className={styles.backgroundImageStack} style={{ height: bandHeight }}>
            <div
                className={styles.backgroundImage}
                style={{
                    background: url,
                    filter: `blur(${blur ?? 0}rem)`,
                    height: bandHeight,
                }}
            />
            <div className={styles.backgroundImageOverlay} style={{ height: bandHeight }} />
        </div>
    );
};

const useHeaderHeight = (headerRef: React.RefObject<HTMLDivElement | null>) => {
    const [headerHeight, setHeaderHeight] = useState<number>(0);

    useEffect(() => {
        if (!headerRef?.current) return;

        const updateHeight = () => {
            if (headerRef?.current) {
                setHeaderHeight(headerRef.current.offsetHeight);
            }
        };

        updateHeight();

        const resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(headerRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, [headerRef]);

    return headerHeight;
};
