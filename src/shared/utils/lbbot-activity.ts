/**
 * One request in lb-bot's fill ledger, as `GET /lb/activity` lists it (PROTOCOL §15.6): every
 * client's, live or terminal (lb-bot keeps a failed row 24 h). `state` is the §15.2 server state.
 * Allowlisted: nothing else of lb-bot's row reaches the renderer.
 */
export interface LbBotActivityRequest {
    album: string;
    /** The Navidrome album id, when lb-bot knows it; "" otherwise. */
    albumId: string;
    artist: string;
    failureKind: string;
    gapFill: boolean;
    groupId: string;
    reason: string;
    releaseMbid: string;
    retryable: boolean;
    rgid: string;
    state: string;
    /** Epoch seconds, lb-bot's clock. */
    updatedAt: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The `requests` of a `/lb/activity` answer, allowlisted. null when the answer has no list (a
 * failed read, an older lb-bot): "nothing to say", never "no requests". A row with no state, or
 * with neither a release nor a group to join it by, is dropped.
 */
export const activityRequests = (answer: unknown): LbBotActivityRequest[] | null => {
    const rows =
        answer && typeof answer === 'object' ? (answer as Record<string, unknown>).requests : null;
    if (!Array.isArray(rows)) return null;
    return rows.flatMap((row): LbBotActivityRequest[] => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        const state = str(r.state);
        const releaseMbid = str(r.releaseMbid);
        const groupId = str(r.groupId);
        if (!state || (!releaseMbid && !groupId)) return [];
        return [
            {
                album: str(r.album),
                albumId: str(r.albumId),
                artist: str(r.artist),
                failureKind: str(r.failureKind),
                gapFill: r.gapFill === true,
                groupId,
                reason: str(r.reason),
                releaseMbid,
                retryable: r.retryable === true,
                rgid: str(r.rgid),
                state,
                updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
            },
        ];
    });
};

/** What main's request helper answers (`LbBotResult`), as far as a screen read needs it. */
export interface ScreenReadResult {
    code?: string;
    data: unknown;
    ok: boolean;
    status: number;
}

/**
 * A screen read (`/lb/activity`, `/lb/attention`) as the renderer's query takes it (review L2):
 * the parsed answer; `null` only when the route is not there to ask - a 404 with no `code` (an
 * hub or lb-bot older than the route) or `lbbot_too_old` (this hub will not use that lb-bot);
 * and a THROW for anything else that failed (a hub 502/504, lb-bot's 500, a timeout, no hub),
 * so the query keeps its last good answer instead of taking a failure for "nothing listed"
 * (§15.2: a failed poll is not an answer).
 */
export const screenRead = <T>(
    result: ScreenReadResult,
    parse: (data: unknown) => null | T,
): null | T => {
    if (result.ok) return parse(result.data);
    if ((result.status === 404 && !result.code) || result.code === 'lbbot_too_old') return null;
    throw new Error(`lb-bot read failed (${result.status}${result.code ? ` ${result.code}` : ''})`);
};
