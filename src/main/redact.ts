/**
 * Worbus P4 (design §6.8): the one redaction rule for everything that leaves through Export
 * diagnostics. A port of the controller's reference (`redact_ref.py`, ruling R2); Navic applies
 * the same rule, and `diagnostics-redaction.harness.ts` holds both apps to the same vectors.
 *
 * Applied per line, in this order:
 *   a. a quoted JSON field whose name contains password, secret, token, apikey, key or
 *      authorization (any case): its string value;
 *   b. the same names unquoted, `name=value` / `name: value` (a quoted value, or an optional
 *      Bearer/Basic scheme plus one run up to whitespace, `&`, `,`, `;` or a quote);
 *   c. a bare `bearer <credential>`, any case;
 *   d. the Subsonic `u`, `t`, `s`, `p` query parameters;
 *   e. `user:password@` in a URL.
 *
 * Feishin adds one rule of its own: every value under main-config.json's `server` record (the
 * saved passwords, keyed by server id, a name the field rule does not catch).
 *
 * Known limit: a credential split across two lines is not caught by a per-line rule.
 *
 * No Electron import: the harness runs this under `node --test`.
 */

import type { ZipEntry } from '/@/main/utils/zip';

export const REDACTED = '[removed]';

const W = '(?:password|secret|token|apikey|key|authorization)';
const NAME = `[A-Za-z0-9_.\\-]*${W}[A-Za-z0-9_.\\-]*`;
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';

const A = new RegExp(`"(${NAME})"(\\s*:\\s*)${QUOTED}`, 'gi');
const B = new RegExp(
    `(?<![A-Za-z0-9_.\\-"])(${NAME})(\\s*[:=]\\s*)(${QUOTED}|(?:(?:bearer|basic)\\s+)?[^\\s&,;"']+)`,
    'gi',
);
const C = /\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const D = /([?&])([utsp])=([^&\s"'\\#<>]+)/g;
const E = /(\b[A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s:@"]+:[^/\s@"]+@/g;

// Settings objects also drop `credential` and `cookie` fields, as the sanitizer this replaced did.
const SENSITIVE_NAME = /password|secret|token|apikey|key|authorization|credential|cookie/i;

/** One line, redacted. */
export const redact = (line: string): string =>
    line
        .replace(A, (_m, name: string, sep: string) => `"${name}"${sep}"${REDACTED}"`)
        .replace(B, (_m, name: string, sep: string, value: string) =>
            value.startsWith('"') ? `${name}${sep}"${REDACTED}"` : `${name}${sep}${REDACTED}`,
        )
        .replace(C, (_m, word: string) => `${word} ${REDACTED}`)
        .replace(D, (_m, lead: string, param: string) => `${lead}${param}=${REDACTED}`)
        .replace(E, (_m, scheme: string) => `${scheme}${REDACTED}@`);

// Feishin's log lines print objects with `util.inspect` (logger.ts): `secret: 'abc'`, the name
// bare or in single quotes and the value in single quotes, which rule b's run does not take.
const INSPECTED = new RegExp(
    `(?<![A-Za-z0-9_.\\-"'])('?)(${NAME})\\1(\\s*:\\s*)'(?:[^'\\\\]|\\\\.)*'`,
    'gi',
);

/** {@link redact}, plus the `util.inspect` form of a sensitive field (Feishin's own logs). */
export const redactLogLine = (line: string): string =>
    redact(line).replace(
        INSPECTED,
        (_m, quote: string, name: string, sep: string) =>
            `${quote}${name}${quote}${sep}'${REDACTED}'`,
    );

/** A whole text, redacted line by line (the line endings kept). */
export const redactText = (text: string): string =>
    text
        .split(/(\r?\n)/)
        .map((part, i) => (i % 2 === 0 ? redactLogLine(part) : part))
        .join('');

/**
 * A parsed settings object, redacted: a string under a sensitive name becomes the mark, every
 * other string goes through {@link redact} (a URL kept in a setting), and with `serverRecord`
 * every value under the top-level `server` record is replaced whatever it is called.
 */
export const redactSettings = (value: unknown, serverRecord = false, depth = 0): unknown => {
    if (typeof value === 'string') return redact(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth >= 20) return REDACTED;
    if (Array.isArray(value)) return value.map((item) => redactSettings(item, false, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (serverRecord && depth === 0 && key === 'server') {
            out[key] =
                nested && typeof nested === 'object' && !Array.isArray(nested)
                    ? Object.fromEntries(Object.keys(nested).map((id) => [id, REDACTED]))
                    : REDACTED;
        } else if (typeof nested === 'string' && SENSITIVE_NAME.test(key)) {
            out[key] = REDACTED;
        } else {
            out[key] = redactSettings(nested, false, depth + 1);
        }
    }
    return out;
};

const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

/** The first lines of the export (ruling R1): what was running, the server's version included. */
export const diagnosticsHeader = (h: {
    appVersion: string;
    arch: string;
    electron: string;
    exportedAt: string;
    os: string;
    serverVersion: null | string;
}): string =>
    [
        `Feishin ${h.appVersion}`,
        `${h.os} (${h.arch})`,
        `Electron ${h.electron}`,
        h.serverVersion ? `Worbus Server ${h.serverVersion}` : 'server version unknown',
        `Exported ${h.exportedAt}`,
        '',
    ].join('\n');

export interface DiagnosticsInput {
    /** main-config.json as read from disk; null when it could not be read. */
    configRaw: null | string;
    diagnostics: Record<string, unknown>;
    header: string;
    logs: { data: Buffer; name: string }[];
    rendererSettings: null | Record<string, unknown>;
}

/**
 * Every file Export diagnostics writes, each one redacted. A config that does not parse is left
 * out rather than written as it is.
 */
export const diagnosticsEntries = (input: DiagnosticsInput): ZipEntry[] => {
    const entries: ZipEntry[] = [
        { data: Buffer.from(redactText(input.header), 'utf8'), name: 'header.txt' },
        { data: json(redactSettings(input.diagnostics)), name: 'diagnostics.json' },
    ];
    if (input.configRaw !== null) {
        let parsed: undefined | unknown;
        try {
            parsed = JSON.parse(input.configRaw);
        } catch {
            parsed = undefined;
        }
        if (parsed !== undefined) {
            entries.push({ data: json(redactSettings(parsed, true)), name: 'main-config.json' });
        }
    }
    if (input.rendererSettings) {
        entries.push({
            data: json(redactSettings(input.rendererSettings)),
            name: 'renderer-settings.json',
        });
    }
    for (const log of input.logs) {
        entries.push({
            data: Buffer.from(redactText(log.data.toString('utf8')), 'utf8'),
            name: log.name,
        });
    }
    return entries;
};
