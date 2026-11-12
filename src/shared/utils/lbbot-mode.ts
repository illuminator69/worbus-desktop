/**
 * lb-bot's downloads mode and index progress, as the hub relays them (Worbus P1).
 *
 * Pure and import-free (tested by `lbbot-mode.harness.ts`). The rules are Worbus for Android's (lane N
 * ruling 3), adopted for Worbus for desktop:
 *
 * - `welcome.lb.downloads` is `"on"` or `"off"`; absent means an older hub or lb-bot, read as
 *   `unknown`, which behaves exactly as today (downloads shown, no P1-only offers).
 * - Every `welcome` restates the mode. An `lb` frame or a `/lb/status` read without the key
 *   keeps the current one, so an "off" a 409 taught holds until the hub says otherwise.
 * - A 409 `downloads_off` from any route sets off.
 * - The last known `on`/`off` per hub URL is remembered (at most four hubs; unknown never) and
 *   is the cold start's mode until the first welcome.
 */

export type LbDownloads = 'off' | 'on';

/** The index build's countdown (`welcome.lbIndex.progress`, `t:"index"`.progress). */
export interface LbIndexProgress {
    /** The artist lb-bot is reading now, "" when it says none. At most 200 code points. */
    current: string;
    /**
     * B-332: artists whose MusicBrainz lookup failed (never counted in `unindexed`). Absent from an
     * older lb-bot, or when the hub does not pass it on.
     */
    failed?: number;
    total: number;
    /** Artists lb-bot will still attempt that have no index row yet. */
    unindexed: number;
}

/** `unknown` = an older peer that does not report the mode: behave as today. */
export type LbMode = 'unknown' | LbDownloads;

const asRecord = (value: unknown): null | Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const downloadsOf = (value: unknown): LbDownloads | null => {
    const downloads = asRecord(value)?.downloads;
    return downloads === 'on' || downloads === 'off' ? downloads : null;
};

/** A welcome states the whole mode: no (valid) key is an older peer. */
export const modeFromWelcome = (lb: unknown): LbMode => downloadsOf(lb) ?? 'unknown';

/** An `lb` frame or a `/lb/status` read: only a valid key moves the mode. */
export const modeFromFrame = (current: LbMode, frame: unknown): LbMode =>
    downloadsOf(frame) ?? current;

/** A refusal from any route: `downloads_off` means off, whatever was believed. */
export const modeAfterRefusal = (current: LbMode, code: string | undefined): LbMode =>
    code === 'downloads_off' ? 'off' : current;

/**
 * What this connection believes about lb-bot after a refusal or a welcome: the downloads mode,
 * and whether lb-bot refused this hub (B-263, a 401 `signin_required`; lb-bot then reads as
 * unavailable).
 */
export interface LbRefusalState {
    mode: LbMode;
    refused: boolean;
}

/**
 * A refusal from any route: `downloads_off` turns the mode off, `signin_required` marks lb-bot
 * refused; anything else changes nothing. Idempotent, so the `lbbot-refusal` event and the
 * renderer's own reading of the same answer can both apply it, in either order.
 */
export const stateAfterRefusal = (
    state: LbRefusalState,
    code: string | undefined,
): LbRefusalState => ({
    mode: modeAfterRefusal(state.mode, code),
    // Worbus P2: `lbbot_too_old` is not this: it has its own flag (`tooOldAfterRefusal`).
    refused: state.refused || code === 'signin_required',
});

/** A welcome restates the mode (absent = an older peer) and ends any refusal. */
export const stateAfterWelcome = (lb: unknown): LbRefusalState => ({
    mode: modeFromWelcome(lb),
    refused: false,
});

/** Whether download actions are offered: everywhere except a known "off". */
export const downloadsShown = (mode: LbMode): boolean => mode !== 'off';

/** A peer that reported the mode at all, i.e. lb-bot and hub from Worbus P1 on. */
export const isP1Peer = (mode: LbMode): boolean => mode !== 'unknown';

/** How many hubs' last mode is remembered. */
export const REMEMBERED_HUBS = 4;

/**
 * Remember `mode` as the last word of the hub at `hubUrl`. Unknown is never stored (it would
 * overwrite a real answer with "don't know"); the oldest hub is dropped past four.
 */
export const rememberMode = (
    map: Record<string, LbDownloads>,
    order: string[],
    hubUrl: string,
    mode: LbMode,
): { map: Record<string, LbDownloads>; order: string[] } => {
    if (mode === 'unknown' || !hubUrl) return { map, order };
    const nextOrder = [...order.filter((url) => url !== hubUrl), hubUrl];
    const dropped = nextOrder.splice(0, Math.max(0, nextOrder.length - REMEMBERED_HUBS));
    const nextMap: Record<string, LbDownloads> = { ...map, [hubUrl]: mode };
    for (const url of dropped) delete nextMap[url];
    return { map: nextMap, order: nextOrder };
};

/**
 * Worbus P3 (design §6.5): the first welcome carrying `server.id` copies what was remembered under
 * the address to `id:<serverId>`. The address entry is left in place (no key dropped); an id that
 * already has a mode keeps it.
 */
export const rekeyMode = (
    map: Record<string, LbDownloads>,
    order: string[],
    from: string,
    to: string,
): { map: Record<string, LbDownloads>; order: string[] } => {
    const mode = map[from];
    if (!mode || map[to] || from === to) return { map, order };
    return rememberMode(map, order, to, mode);
};

const count = (value: unknown): null | number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** `progress` off the wire, or null for anything that is not one (and for its absence). */
export const parseProgress = (raw: unknown): LbIndexProgress | null => {
    const record = asRecord(raw);
    if (!record) return null;
    const unindexed = count(record.unindexed);
    const total = count(record.total);
    if (unindexed === null || total === null) return null;
    const current = record.current;
    if (current !== undefined && current !== null && typeof current !== 'string') return null;
    // Cut by code points, not UTF-16 units: a name with an astral character at the cut must not
    // keep half a surrogate pair.
    const name = current ?? '';
    const cut = name.length > 200 ? Array.from(name).slice(0, 200).join('') : name;
    // B-332: `failed` only when it is a count; a malformed one is dropped, the rest kept.
    const failed = count(record.failed);
    return failed === null
        ? { current: cut, total, unindexed }
        : { current: cut, failed, total, unindexed };
};

/**
 * An `index` frame that moved nothing but the progress: the same epoch as the mirror's and a
 * seq it has already pulled. Such a frame updates the bar only (Worbus for Android ruling 9). Without a
 * mirror cursor every frame is a reason to pull.
 */
export const isProgressOnlyFrame = (
    frame: { epoch: string; seq: number },
    cursor: null | { epoch: string; seq: number },
): boolean => cursor !== null && frame.epoch === cursor.epoch && frame.seq <= cursor.seq;

// --- Worbus P2: lbbot_too_old ------------------------------------------------------------------

/**
 * Not a refusal code: main sends it on the `lbbot-refusal` channel when an lb-bot answer got
 * through after an `lbbot_too_old` (R17: the hub serves a non-primary user only an answer that
 * proves lb-bot's identity). It ends the too-old state.
 */
export const LB_ANSWERED = 'answered';

/**
 * 503 `lbbot_too_old` (an lb-bot older than signed-in users, for anyone but the primary user)
 * makes lb-bot unavailable to this user - on its own flag, not as "refused": the hub answers it
 * transiently too (R17, R20: lb-bot restarting before its health is read again), so it must end
 * without a new connection. It ends on an answer that got through ({@link LB_ANSWERED}) and on the
 * hub's word ({@link tooOldFromLb}).
 */
export const tooOldAfterRefusal = (current: boolean, code: string | undefined): boolean =>
    code === 'lbbot_too_old' ? true : code === LB_ANSWERED ? false : current;

/**
 * What `welcome.lb` or an `lb` frame says: lb-bot serves everyone once it reports `identity`, and
 * only the primary user before then (hub.py: `caller.primary or self.identity`). No user (an older
 * hub) and an lb-bot that is down are not "too old".
 */
export const tooOldFromLb = (lb: unknown, user: null | { primary: boolean }): boolean => {
    const record = asRecord(lb);
    if (!record || record.available !== true || !user || user.primary) return false;
    return record.identity !== true;
};
