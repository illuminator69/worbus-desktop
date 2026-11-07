import { usePreviewStatus } from '/@/renderer/features/preview/hooks/use-preview';
import { hasPreviewTrack } from '/@/renderer/features/preview/preview-track';
import { useHubStore, usePlayerQueue } from '/@/renderer/store';

/**
 * Why a preview queue must not be handed to a Chromecast — decided here, rather
 * than discovered at the speaker.
 *
 * A Cast receiver fetches `streamUrl` itself, from its own position on the
 * network, and sends no headers. When the hub has no `PREVIEW_PUBLIC_URL` the
 * URL it signs is a LAN address: the speaker cannot fetch it, and the failure is
 * not an error anyone sees — the transfer commits, every device shows a playing
 * bar, and nothing comes out. That is the exact class of bug the `reachable`
 * three-state was added for (PROTOCOL §3.2), and the answer is the same one:
 * refuse the transfer, and say why.
 *
 * Only Cast targets are blocked. Another Worbus for desktop or Worbus for Android fetches the same URL
 * from the same network as this client, so a LAN address is fine for them.
 *
 * Both queues are checked because either can be the live one: the local player
 * store is frozen while a remote session is active, so reading only it would
 * miss a preview queue that is already playing elsewhere.
 */
export const usePreviewCastBlocked = (): null | string => {
    const { previewCastable } = usePreviewStatus();
    const localQueue = usePlayerQueue();
    const remoteQueue = useHubStore((state) => state.remoteQueue);

    if (previewCastable) return null;
    if (!hasPreviewTrack(localQueue) && !hasPreviewTrack(remoteQueue)) return null;
    return 'Previews cannot be cast — your hub has no public preview URL, so the speaker could not fetch them.';
};
