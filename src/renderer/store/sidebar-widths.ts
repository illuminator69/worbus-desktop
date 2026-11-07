/**
 * The store_app step to version 6: the old default widths (400px sidebar, 600px queue panel) move to
 * the slim ones; any other width is the user's and stays. Pure, for the harness.
 */
export const migrateSidebarWidths = (sidebar: {
    leftWidth: string;
    rightWidth: string;
}): { leftWidth: string; rightWidth: string } => ({
    leftWidth: sidebar.leftWidth === '400px' ? '232px' : sidebar.leftWidth,
    rightWidth: sidebar.rightWidth === '600px' ? '360px' : sidebar.rightWidth,
});
