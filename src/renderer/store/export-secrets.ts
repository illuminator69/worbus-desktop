/**
 * Secrets that an exported settings file must never carry (F1, Worbus settings cleanup).
 * Dotted paths into the settings state (the five secrets, plus `hub.enabled`). One list: `useSettingsForExport` strips it, and the import
 * modal fills the same paths back from the current state, so importing a file without them keeps
 * what is set now. `export-secrets.harness.ts` reads the settings schema and fails when a new
 * token, password or API key is not listed here.
 */
export const EXPORT_SECRET_PATHS: readonly string[] = [
    'hub.token',
    // Not a secret: connection state. A file that carried it would switch Connect on in a fresh
    // profile that has no token ("refused"); the address, name and public URL still travel.
    'hub.enabled',
    'audioMuse.token',
    'remote.password',
    'general.lastfmApiKey',
    'lyrics.translationApiKey',
];

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** A copy of `settings` with every secret path removed. Only the objects on the way are copied. */
export const omitExportSecrets = <T extends object>(settings: T): T => {
    const out: Bag = { ...(settings as Bag) };
    for (const path of EXPORT_SECRET_PATHS) {
        const keys = path.split('.');
        let source: Bag = settings as Bag;
        let target: Bag = out;
        for (const key of keys.slice(0, -1)) {
            const next = source[key];
            if (!isBag(next)) {
                target = {};
                break;
            }
            const copy: Bag = target[key] === next ? { ...next } : (target[key] as Bag);
            target[key] = copy;
            source = next;
            target = copy;
        }
        delete target[keys[keys.length - 1]];
    }
    return out as T;
};

/**
 * An imported file with the current value filled in at every secret path the file does not carry.
 * A path whose parent object is missing from the file is left alone (no parent is invented), and a
 * secret the file does carry (an export from before F1) is applied as written.
 */
export const keepCurrentSecrets = <T extends object>(imported: T, current: object): T => {
    if (!isBag(imported)) return imported;
    const out: Bag = { ...(imported as Bag) };
    for (const path of EXPORT_SECRET_PATHS) {
        const keys = path.split('.');
        let source: unknown = current;
        for (const key of keys) source = isBag(source) ? source[key] : undefined;
        if (source === undefined) continue;

        let node: Bag = out;
        let ok = true;
        for (const key of keys.slice(0, -1)) {
            const next = node[key];
            if (!isBag(next)) {
                ok = false;
                break;
            }
            const copy: Bag = { ...next };
            node[key] = copy;
            node = copy;
        }
        const last = keys[keys.length - 1];
        if (ok && node[last] === undefined) node[last] = source;
    }
    return out as T;
};
