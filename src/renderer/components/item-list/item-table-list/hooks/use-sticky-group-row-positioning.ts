import { usePinnedRowPlacement } from '/@/renderer/components/item-list/item-table-list/hooks/use-pinned-row-placement';

interface UseStickyGroupRowPositioningProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    shouldRenderStickyGroupRow: boolean;
    stickyGroupRowRef: React.RefObject<HTMLDivElement | null>;
    /** The viewport line the row pins under. */
    top: number;
}

/** Keeps the pinned group (disc) row at `top` across the table (`usePinnedRowPlacement`). */
export const useStickyGroupRowPositioning = ({
    containerRef,
    shouldRenderStickyGroupRow,
    stickyGroupRowRef,
    top,
}: UseStickyGroupRowPositioningProps) =>
    usePinnedRowPlacement({
        active: shouldRenderStickyGroupRow,
        containerRef,
        rowRef: stickyGroupRowRef,
        top,
    });
