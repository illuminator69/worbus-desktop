import type { PreviewStatus, PreviewTrack } from '/@/shared/types/preview-types';

import { ipcMain } from 'electron';

import { getHubConfig, hubAuth } from '../hub';

/**
 * navi-connect preview client (main process).
 *
 * Two calls and nothing else: "is there a preview of this track" and "can a
 * preview be cast". Both are ordinary buffered JSON through the hub's
 * `/preview/*` proxy.
 *
 * **This module never touches audio.** The `streamUrl` in a resolve answer is
 * absolute, signed by the hub, and fetched by the renderer's `<audio>` element
 * (or by a Chromecast) directly from the sidecar. That is the whole point of
 * putting the media origin outside the hub — see `preview-types.ts`.
 *
 * Deliberately separate from the lb-bot client next door even though the two
 * share the hub transport: they are different upstream services with different
 * failure modes, and lb-bot's `describeFailure` sentences ("lb-bot is busy…")
 * would be actively wrong here.
 *
 * Fail-soft throughout: no hub, no `PREVIEW_URL`, an unreachable sidecar and a
 * track with no match all resolve to the same "there is no preview", and the
 * surface hides its button rather than showing an error.
 */

/** `ws://host:4790` → `http://host:4790`; null when the hub isn't configured. */
const hubBase = (): null | string => {
    const { enabled, url } = getHubConfig();
    // Worbus P2: the device secret, else the typed token (hubAuth); neither means no hub.
    if (!enabled || !url || !hubAuth.bearer()) return null;
    return url
        .replace(/^ws/, 'http')
        .replace(/\/+$/, '')
        .replace(/\/connect$/, '');
};

type Json = Record<string, unknown>;

/** The sidecar can take a few seconds on a cold extractor lookup, but a resolve
 *  is something the user pressed and is waiting on — well short of the hub's own
 *  proxy timeout, so this side gives up first. */
const RESOLVE_TIMEOUT_MS = 15_000;

const get = async (path: string, params: Record<string, string> = {}): Promise<Json | null> => {
    const base = hubBase();
    if (!base) return null;
    try {
        const url = new URL(`${base}${path}`);
        for (const [key, value] of Object.entries(params)) {
            if (value) url.searchParams.set(key, value);
        }
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${hubAuth.bearer() ?? ''}` },
            signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
        });
        if (!res.ok) {
            // Logged unconditionally: a Preview button that does nothing, with
            // nothing in the console either, is the failure this whole layer is
            // most likely to produce. 404 here means the hub proxies no
            // `/preview/*` at all — it is older than this build.
            console.error(`[preview] GET ${path} → ${res.status}`);
            return null;
        }
        return (await res.json()) as Json;
    } catch (error) {
        const cause = (error as { cause?: unknown }).cause;
        console.error(
            `[preview] GET ${path} — ${String(error)}${cause ? ` (${String(cause)})` : ''}`,
        );
        return null;
    }
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => {
    const n = typeof value === 'string' ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : 0;
};

// The hub answers /preview/status even with PREVIEW_URL unset, exactly as
// /lb/status does — "not configured" must arrive as JSON rather than as the
// WebSocket upgrade's 426 text/plain.
ipcMain.handle('preview-status', async (): Promise<PreviewStatus> => {
    const data = await get('/preview/status');
    return {
        configured: data?.configured === true,
        cookies: data?.cookies === true,
        // Additive, and absent reads as "not blocked" — which is right: a hub
        // too old to send it is also one whose sidecar predates the health
        // tracking, and hiding the feature on a missing field would disable it
        // for every such setup.
        extractorBlocked: data?.extractorBlocked === true,
        // Absent is NOT castable. A hub too old to send the flag is also too old
        // to sign a public stream URL, so the permissive reading would hand a
        // Chromecast a LAN address and produce silence — the exact failure the
        // flag exists to prevent.
        previewCastable: data?.previewCastable === true,
        upstreamReachable: data?.upstreamReachable === true,
    };
});

ipcMain.handle(
    'preview-resolve',
    async (
        _event,
        args: { album?: string; artist: string; durationMs?: number; title: string },
    ): Promise<null | PreviewTrack> => {
        const artist = (args.artist ?? '').trim();
        const title = (args.title ?? '').trim();
        if (!artist || !title) return null;
        const data = await get('/preview/resolve', {
            album: (args.album ?? '').trim(),
            artist,
            durationMs: args.durationMs ? String(Math.round(args.durationMs)) : '',
            title,
        });
        // `{}` is the sidecar saying "no preview found" — a legitimate answer.
        // Both halves are load-bearing: an id with no stream URL is a track that
        // enters the queue and then plays nothing.
        const id = str(data?.id);
        const streamUrl = str(data?.streamUrl);
        if (!id || !streamUrl) return null;
        return {
            album: str(data?.album),
            artist: str(data?.artist) || artist,
            confidence: num(data?.confidence),
            durationMs: num(data?.durationMs),
            id,
            imageUrl: str(data?.imageUrl),
            mime: str(data?.mime),
            provider: str(data?.provider),
            streamUrl,
            title: str(data?.title) || title,
        };
    },
);
