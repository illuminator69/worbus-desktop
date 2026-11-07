/**
 * The sentence a failed lb-bot request shows, and which failures are lb-bot P1's refusals.
 * Pure and import-free (tested by `lbbot-failure.harness.ts`); moved out of the main lb-bot
 * client unchanged, so its old sentences are byte-for-byte what they were.
 */

/** The two refusals the main client tells the renderer about (`lbbot-refusal`). */
export type LbRefusalCode =
    | 'admin_only'
    | 'downloads_off'
    | 'lbbot_too_old'
    | 'primary_only'
    | 'signin_required';

type Json = Record<string, unknown>;

/**
 * Whether a failure is one of lb-bot P1's refusals: 409 `downloads_off` (downloading is not set
 * up) or 401 `signin_required` (lb-bot refused this hub: an older hub sends no bearer, B-263).
 */
export const refusalCode = (status: number, body: Json | null): LbRefusalCode | null => {
    if (status === 409 && body?.code === 'downloads_off') return 'downloads_off';
    if (status === 401 && body?.code === 'signin_required') return 'signin_required';
    // Worbus P2: lb-bot's (or the hub's) answer to a role this user lacks, and the hub's answer
    // for everyone but the primary user while lb-bot predates signed-in users.
    if (status === 403 && body?.code === 'admin_only') return 'admin_only';
    if (status === 403 && body?.code === 'primary_only') return 'primary_only';
    if (status === 503 && body?.code === 'lbbot_too_old') return 'lbbot_too_old';
    return null;
};

/**
 * Whether an answer's `code` is one of the two refusals. A read refused this way says nothing the
 * app has not already shown (the mode is off, or lb-bot reads as unavailable), so its error is
 * quiet: no app-wide error toast (F7 walk, B-263).
 */
export const isLbRefusal = (code: string | undefined): boolean =>
    code === 'downloads_off' ||
    code === 'signin_required' ||
    code === 'admin_only' ||
    code === 'primary_only' ||
    code === 'lbbot_too_old';

/**
 * Turn a non-2xx into a sentence worth showing.
 *
 * Two of these are not what their status code normally means, and getting either
 * wrong wastes a debugging round:
 *
 * - **404 is not "not found".** Every route here is a hub whitelist entry, so a
 *   404 means *the hub proxies no such route* — it is older than this app and
 *   needs restarting. `hub.py` is a long-running process; editing it changes
 *   nothing until it restarts, which alone accounted for a whole round of "the
 *   button does nothing" on the Worbus for Android side.
 * - **502 is usually "busy", not "refused".** Every lb-bot route takes its
 *   process-wide `_review_lock`, and the hub's default 20s proxy timeout is the
 *   only thing separating slow from failed. The hub's own body reads
 *   `{"error": "lb-bot unreachable"}`, which taken literally is misleading while
 *   a large search holds that lock.
 *
 * Anything else prefers lb-bot's own `error`, which it writes for humans - except P1's two
 * refusals, whose sentences are the client's (Worbus for Android's words for the first).
 */
export const describeFailure = (status: number, body: Json | null): string => {
    const refusal = refusalCode(status, body);
    if (refusal === 'downloads_off') return "This server isn't set up to get albums.";
    if (refusal === 'admin_only') return 'Only an admin of this server can do that.';
    if (refusal === 'primary_only')
        return "That is the server owner's listening, shown to them only.";
    if (refusal === 'lbbot_too_old') {
        return "This Worbus Server's library tools are too old for signed-in users.";
    }
    if (refusal === 'signin_required') {
        return "lb-bot refused this hub. Update the hub, or check that its HUB_TOKEN matches lb-bot's LB_BOT_HUB_TOKEN.";
    }
    const upstream = typeof body?.error === 'string' ? body.error : '';
    // lb-bot's own 404 (I-019: `unknown_mbid`, `no_override`) carries a `code`; the
    // hub's "no such route" 404 does not. Only the first is a sentence to relay.
    if (status === 404 && typeof body?.code === 'string' && upstream) return upstream;
    // lb-bot's own 502 for a MusicBrainz outage says so and that nothing was stored.
    if (status === 502 && body?.retryable === true && upstream) return upstream;
    // An lb-bot older than the hub answers an unknown POST with 405 "The method
    // is not allowed" (its catch-all route is GET-only), where an unknown GET is
    // a 404. Same condition; never relay the raw text.
    if (status === 405) {
        return 'This lb-bot is older than the hub and does not have that route yet.';
    }
    if (status === 404) {
        return 'This hub does not know that route — restart the hub to pick up its newer lb-bot features.';
    }
    if (status === 502 || status === 504) {
        return 'lb-bot is busy or unreachable. It handles one request at a time while searching; try again in a moment.';
    }
    if (status === 0) return 'Could not reach the hub.';
    return upstream || `Request failed (${status})`;
};

/**
 * Worbus P1 (F6): Scan now without an MBID refused by an lb-bot from before P1, which answers
 * `POST /lb/artist/discography {nd_id}` 400 "mbid is required". Only that sentence reads as an older
 * lb-bot (Worbus for Android ruling 4); any other 400 is an ordinary failure.
 */
export const isOlderScanRefusal = (status: number, error: string | undefined): boolean =>
    status === 400 && error === 'mbid is required';
