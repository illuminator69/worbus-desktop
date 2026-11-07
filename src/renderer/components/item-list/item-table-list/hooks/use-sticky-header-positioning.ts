import { usePinnedRowPlacement } from '/@/renderer/components/item-list/item-table-list/hooks/use-pinned-row-placement';

interface UseStickyHeaderPositioningProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    shouldShowStickyHeader: boolean;
    stickyHeaderRef: React.RefObject<HTMLDivElement | null>;
    /** The viewport line the row pins under. */
    top: number;
}

/**
 * Keeps the pinned table header at `top` across the table (`usePinnedRowPlacement`).
 * Scroll synchronization is handled separately in useStickyTableHeader.
 */
export const useStickyHeaderPositioning = ({
    containerRef,
    shouldShowStickyHeader,
    stickyHeaderRef,
    top,
}: UseStickyHeaderPositioningProps) =>
    usePinnedRowPlacement({
        active: shouldShowStickyHeader,
        containerRef,
        rowRef: stickyHeaderRef,
        top,
    });
