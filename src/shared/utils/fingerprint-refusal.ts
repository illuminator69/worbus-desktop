/** What main answers the renderer: the ids, and the refusal when the answer was one. */
export interface FingerprintAnswer {
    ids: string[];
    refused?: FingerprintRefusal;
}

/**
 * Fix round 3 (2026-11-12): a fingerprint answer that is a refusal with a name, rather than an
 * empty "no listening" (`fingerprint-refusal.harness.ts`). Pure and import-free: main classifies
 * the HTTP answer, the renderer says it.
 *
 * - Through the hub (PROTOCOL §14): `503 {"code":"audiomuse_too_old","need":"3.7.1"}` when
 *   AudioMuse refuses the POST body; `400 {"code":"bad_request","error":…}` for a bad `n`.
 * - Direct (the desktop half of B-359): an AudioMuse older than 3.7.1 does not take the POST; it
 *   answers 405, or a 400 that is not JSON. Named the same as the hub's.
 *
 * Anything else is not a named refusal: the caller keeps today's empty answer.
 */
export type FingerprintRefusal =
    | { code: 'audiomuse_too_old'; need: string }
    | { code: 'bad_request'; error: string };

/** The AudioMuse version whose fingerprint route takes a POST body. */
export const FINGERPRINT_POST_SINCE = '3.7.1';

const json = (body: string): null | Record<string, unknown> => {
    try {
        const parsed = JSON.parse(body) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** A non-ok fingerprint answer as a named refusal, or null for today's empty answer. */
export const fingerprintRefusal = (
    viaHub: boolean,
    status: number,
    body: string,
): FingerprintRefusal | null => {
    const parsed = json(body);
    if (viaHub) {
        if (parsed?.code === 'audiomuse_too_old') {
            return { code: 'audiomuse_too_old', need: text(parsed.need) || FINGERPRINT_POST_SINCE };
        }
        if (parsed?.code === 'bad_request') {
            return { code: 'bad_request', error: text(parsed.error) };
        }
        return null;
    }
    if (status === 405 || (status === 400 && parsed === null)) {
        return { code: 'audiomuse_too_old', need: FINGERPRINT_POST_SINCE };
    }
    return null;
};

/** What the Your mix surfaces say: an en.json key and its values, or the hub's own sentence. */
export const refusalLine = (
    refused: FingerprintRefusal,
): { key: string; values: Record<string, string> } | { text: string } => {
    if (refused.code === 'audiomuse_too_old') {
        return { key: 'naviConnect.mixes.audioMuseTooOld', values: { need: refused.need } };
    }
    return refused.error
        ? { text: refused.error }
        : { key: 'naviConnect.mixes.fingerprintRefused', values: {} };
};
