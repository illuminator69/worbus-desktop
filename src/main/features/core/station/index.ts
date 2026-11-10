import type {
    StationAnswer,
    StationCatalog,
    StationCharacter,
    StationCharacterId,
    StationCount,
    StationCountBody,
    StationEngine,
    StationNextBody,
    StationResult,
    StationSeed,
    StationSignalAnswer,
    StationSignalBody,
    StationStartBody,
    StationTrack,
    StationVariety,
} from '/@/shared/types/station-types';

import { ipcMain } from 'electron';

import { getHubConfig, hubAuth } from '../hub';

import log from '/@/main/logger';

/**
 * navi-connect stations (PROTOCOL §18): the hub's `/sonic/station/*` routes.
 *
 * The hub computes radio and autoplay itself, from AudioMuse (or Navidrome when AudioMuse is
 * down), and keeps each station's seed, what it served and what was skipped and liked. This
 * client only asks it for the next tracks.
 *
 * HUB ONLY, unlike the AudioMuse client next door: a station's state lives on the hub, so there
 * is no direct-to-AudioMuse route to fall back to. With no hub, or a hub without stations, the
 * renderer runs upstream's own Auto DJ instead (PROTOCOL §18 "Without the engine").
 *
 * The base and the bearer are the hub's, reached the way `audiomuse/index.ts`'s `endpoint()`
 * reaches it. Every call has 15 s: the hub answers by 12 s with whatever it found (`partial`),
 * so a call still open at 15 s is a hub that is not answering, not a slow batch.
 */

const STATION_TIMEOUT_MS = 15_000;

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

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

const CHARACTERS: readonly StationCharacterId[] = ['close', 'balanced', 'explore'];

const toCharacterId = (value: unknown): null | StationCharacterId =>
    CHARACTERS.includes(value as StationCharacterId) ? (value as StationCharacterId) : null;

const toEngine = (value: unknown): null | StationEngine =>
    value === 'tier1' || value === 'tier2' ? value : null;

const toSeed = (value: unknown): null | StationSeed => {
    if (!value || typeof value !== 'object') return null;
    const seed = value as Json;
    const name = str(seed.name) || undefined;
    if (seed.kind === 'yourMix') return { kind: 'yourMix', name };
    const ids = Array.isArray(seed.ids)
        ? seed.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
    if (ids.length === 0) return null;
    if (seed.kind === 'track') return { ids: ids.slice(0, 1), kind: 'track', name };
    if (seed.kind === 'tracks') return { ids: ids.slice(0, 5), kind: 'tracks', name };
    return null;
};

const toTracks = (value: unknown): StationTrack[] =>
    Array.isArray(value)
        ? value.flatMap((row): StationTrack[] => {
              if (!row || typeof row !== 'object') return [];
              const r = row as Json;
              const id = str(r.id);
              if (!id) return [];
              return [
                  {
                      album: str(r.album),
                      artist: str(r.artist),
                      id,
                      rank: typeof r.rank === 'number' ? r.rank : undefined,
                      title: str(r.title),
                      why: str(r.why) || undefined,
                  },
              ];
          })
        : [];

const toAnswer = (body: Json): null | StationAnswer => {
    const stationId = str(body.stationId);
    if (!stationId) return null;
    return {
        bound: typeof body.bound === 'boolean' ? body.bound : null,
        character: toCharacterId(body.character) ?? 'balanced',
        engine: toEngine(body.engine),
        exhausted: body.exhausted === true,
        name: str(body.name),
        origin: body.origin === 'radio' || body.origin === 'continue' ? body.origin : null,
        partial: body.partial === true,
        rev: num(body.rev),
        seed: toSeed(body.seed),
        seq: num(body.seq),
        servedElsewhere: body.servedElsewhere === true,
        stationId,
        stopped: typeof body.stopped === 'boolean' ? body.stopped : null,
        tracks: toTracks(body.tracks),
    };
};

const toCatalog = (body: Json): StationCatalog => {
    const characters = Array.isArray(body.characters)
        ? body.characters.flatMap((row): StationCharacter[] => {
              if (!row || typeof row !== 'object') return [];
              const r = row as Json;
              const id = toCharacterId(r.id);
              if (!id) return [];
              return [
                  {
                      description: str(r.description),
                      id,
                      label: str(r.label) || id,
                      legacy: str(r.legacy),
                  },
              ];
          })
        : [];
    const strs = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return {
        available: body.available === true,
        characters,
        configured: body.configured === true,
        count: body.count === true,
        default: toCharacterId(body.default) ?? 'balanced',
        engine: toEngine(body.engine),
        filters: strs(body.filters),
        varieties: strs(body.varieties).filter(
            (v): v is StationVariety => v === 'low' || v === 'medium' || v === 'high',
        ),
    };
};

/** A count's answer; null when the body is not one. */
const toCount = (body: Json): null | StationCount => {
    if (typeof body.count !== 'number' || !Number.isFinite(body.count)) return null;
    return {
        anchors: num(body.anchors),
        character: toCharacterId(body.character) ?? 'balanced',
        count: Math.max(0, Math.trunc(body.count)),
        engine: toEngine(body.engine),
        partial: body.partial === true,
        // B-178: how far the ladder reaches (PROTOCOL §18.1); absent from an older hub.
        reach:
            typeof body.reach === 'number' && Number.isFinite(body.reach)
                ? Math.max(0, Math.trunc(body.reach))
                : undefined,
        unknown: Array.isArray(body.unknown)
            ? body.unknown.filter((x): x is string => typeof x === 'string')
            : [],
    };
};

const failed = <T>(status: number, error: string, extra: Partial<StationResult<T>> = {}) =>
    ({ data: null, error, ok: false, status, ...extra }) as StationResult<T>;

/**
 * The one place a station request is made. Returns a result rather than throwing, so the
 * renderer can tell "the hub has no engine" (503 fallback) from "the hub is not there" (0)
 * from "this station expired" (404 station_unknown).
 */
const request = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body: Json | undefined,
    parse: (json: Json) => null | T,
): Promise<StationResult<T>> => {
    const base = hubBase();
    if (!base) return failed(0, 'No navi-connect hub is configured.');
    let res: Response;
    try {
        res = await fetch(`${base}${path}`, {
            ...(body ? { body: JSON.stringify(body) } : {}),
            headers: {
                Authorization: `Bearer ${hubAuth.bearer() ?? ''}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            method,
            signal: AbortSignal.timeout(STATION_TIMEOUT_MS),
        });
    } catch (error) {
        const cause = (error as { cause?: unknown }).cause;
        log.warn(
            `[station] ${method} ${path}: ${String(error)}${cause ? ` (${String(cause)})` : ''}`,
        );
        return failed(0, 'Could not reach the hub.');
    }

    let json: Json | null = null;
    try {
        json = (await res.json()) as Json;
    } catch {
        json = null;
    }

    if (!res.ok) {
        // Path and status only: a seed or a track id is listening data, not a diagnostic.
        log.warn(`[station] ${method} ${path} -> ${res.status}`);
        return failed(res.status, str(json?.error) || `Request failed (${res.status})`, {
            busy: json?.busy === true || undefined,
            code: str(json?.code) || undefined,
            fallback: json?.fallback === true || undefined,
            stationId: str(json?.stationId) || undefined,
        });
    }

    const data = json ? parse(json) : null;
    if (data === null) {
        log.warn(`[station] ${method} ${path} -> ${res.status} with an unreadable body`);
        return failed(res.status, 'The hub answered with something this app cannot read.');
    }
    return { data, error: '', ok: true, status: res.status };
};

ipcMain.handle(
    'station-characters',
    async (): Promise<StationResult<StationCatalog>> =>
        request('GET', '/sonic/station/characters', undefined, toCatalog),
);

ipcMain.handle(
    'station-start',
    async (_event, body: StationStartBody): Promise<StationResult<StationAnswer>> =>
        request('POST', '/sonic/station/start', body as unknown as Json, toAnswer),
);

// P5: read-only, creates no station; a hub without the route answers 404 with no `code`.
ipcMain.handle(
    'station-count',
    async (_event, body: StationCountBody): Promise<StationResult<StationCount>> =>
        request('POST', '/sonic/station/count', body as unknown as Json, toCount),
);

ipcMain.handle(
    'station-next',
    async (_event, body: StationNextBody): Promise<StationResult<StationAnswer>> =>
        request('POST', '/sonic/station/next', body as unknown as Json, toAnswer),
);

ipcMain.handle(
    'station-signal',
    async (_event, body: StationSignalBody): Promise<StationResult<StationSignalAnswer>> =>
        request('POST', '/sonic/station/signal', body as unknown as Json, (json) => {
            const edited = json.edited;
            return {
                applied: json.applied === true,
                edited:
                    edited === false
                        ? false
                        : edited && typeof edited === 'object'
                          ? {
                                added: num((edited as Json).added),
                                from: num((edited as Json).from),
                                removed: num((edited as Json).removed),
                            }
                          : null,
                ignored: str(json.ignored) || undefined,
                reason: str(json.reason) || undefined,
                rev: num(json.rev),
            };
        }),
);
