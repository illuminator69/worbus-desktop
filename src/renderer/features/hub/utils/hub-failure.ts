/**
 * What to tell the user about a Worbus Server failure: an `error` frame, or the `ack` of an act of
 * ours that the server refused (`ok:false` - against a server that acknowledges acts the refusal
 * comes there, to the sender only, instead of as a broadcast). Pure and import-free so
 * `server-status.harness.ts` can run it.
 *
 * The Worbus P2 refusals use design §6.2's sentences verbatim; a refusal must never read as a
 * network problem. An unknown code says what it can without the internal word "hub" (B-321).
 */
export const SIGN_IN_REFUSAL_TEXT = {
    navidromeRefused:
        "This Worbus Server's Navidrome doesn't know this account. It may use a different Navidrome server.",
    navidromeUnreachable: "The Worbus Server can't reach its Navidrome right now.",
    signedOut: 'Signed out of the Worbus Server',
    tooManyAttempts: 'Too many attempts. Try again in a few minutes.',
} as const;

export const hubFailureMessage = (msg: { code?: unknown; message?: unknown }): string => {
    const message = typeof msg.message === 'string' && msg.message ? msg.message : null;
    switch (msg.code) {
        case 'auth':
            return 'The Worbus Server refused the access token - check it in Settings, Server.';
        case 'lbbot_too_old':
            return "This Worbus Server's library tools are too old for signed-in users.";
        case 'load_failed':
            return message ?? 'That device could not start playback.';
        case 'navidrome_refused':
            return SIGN_IN_REFUSAL_TEXT.navidromeRefused;
        case 'navidrome_unreachable':
            return SIGN_IN_REFUSAL_TEXT.navidromeUnreachable;
        case 'not_supported':
            return message ?? "That device can't do that while it isn't playing.";
        case 'primary_only':
            return "That is the server owner's listening, shown to them only.";
        case 'signed_out':
            return SIGN_IN_REFUSAL_TEXT.signedOut;
        case 'target_offline':
            return 'That device is offline.';
        case 'target_unreachable':
            return message ?? "That device isn't responding.";
        case 'too_many_attempts':
            return SIGN_IN_REFUSAL_TEXT.tooManyAttempts;
        default:
            return message ?? 'The Worbus Server could not do that.';
    }
};
