/**
 * The two text fields of the Server tab that used to lose their meaning (F2, audit finding 4).
 * Pure and import-free (`device-name-clear.harness.ts`). Each returns the `draft` the field must
 * show afterwards as well as the value to store, so the field and the store cannot disagree.
 */
export const DEFAULT_DEVICE_NAME = 'Feishin';

export const resolveDeviceName = (
    input: string,
    current: string,
): { changed: boolean; draft: string; name: string } => {
    const name = input.trim() || DEFAULT_DEVICE_NAME;
    return { changed: name !== current, draft: name, name };
};

/** Hostname of a web address, or null if it is not one (no scheme, no host). */
export const hostOf = (url: string): null | string => {
    try {
        const parsed = new URL(url);
        return parsed.hostname === '' ? null : parsed.hostname.toLowerCase();
    } catch {
        return null;
    }
};

/**
 * A typed Public server URL. A cast speaker fetches the stream itself from this base, so the
 * Worbus Server's own address (which cannot serve audio) and anything that is not a web address
 * are refused, and the field goes back to what is stored.
 */
export const resolvePublicServerUrl = (
    input: string,
    current: string,
    hubUrl: string | string[],
): { changed: boolean; draft: string; error: 'hub' | 'invalid' | null; value: string } => {
    const value = input.trim();
    if (value === '') return { changed: current !== '', draft: '', error: null, value: '' };

    const host = hostOf(value);
    if (host === null || !/^https?:\/\//i.test(value)) {
        return { changed: false, draft: current, error: 'invalid', value: current };
    }
    // P3 (M9): any of the Worbus Server's addresses, not only the typed one.
    const hubHosts = (Array.isArray(hubUrl) ? hubUrl : [hubUrl]).map(hostOf);
    if (hubHosts.includes(host)) {
        return { changed: false, draft: current, error: 'hub', value: current };
    }
    return { changed: value !== current, draft: value, error: null, value };
};
