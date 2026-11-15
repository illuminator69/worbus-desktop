import type { TranscodingConfig } from '/@/renderer/store';

/**
 * The transcode profile the player engines should actually use: the stored config, except that
 * with `meteredOnly` set, transcoding only kicks in while the connection is metered (full quality
 * otherwise).
 *
 * A desktop is never metered (B-321): Electron's Network Information API reports no connection type
 * and no data saver, only Chromium's speed estimate. So on the desktop "Transcode, only when
 * metered" plays full quality, as it always did; the settings page shows the switch there only
 * while it is on, so it can be turned off.
 */
export const effectiveTranscode = (
    transcode: TranscodingConfig,
    { isDesktop, isMetered }: { isDesktop: boolean; isMetered: boolean },
): TranscodingConfig => {
    if (!transcode.meteredOnly) return transcode;
    return { ...transcode, enabled: transcode.enabled && isMetered && !isDesktop };
};
