import type { MoodCatalogue, MoodListData, MoodResult } from '/@/shared/types/mood-types';

import { ipcMain } from 'electron';

import { getHubConfig, hubAuth } from '../hub';

import log from '/@/main/logger';
import { moodOutcome, parseMoodCatalogue, parseMoodList } from '/@/shared/utils/mood-parse';

/**
 * The hub's mood routes (spec/mood-contract.md, the hub's P7 A1): the catalogue of Home's mood
 * chips and tiles, and one tile's list of Navidrome song ids. Reached with the hub's base and
 * bearer the way `station/index.ts` reaches `/sonic/station/*`; every call has 15 s and answers
 * a result, never a throw. A hub older than the routes answers 404 with no code: `absent`.
 */

const MOOD_TIMEOUT_MS = 15_000;

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

const request = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body: Json | undefined,
    parse: (json: unknown) => null | T,
): Promise<MoodResult<T>> => {
    const base = hubBase();
    if (!base) {
        return {
            error: 'No navi-connect hub is configured.',
            kind: 'unavailable',
            ok: false,
            status: 0,
        };
    }
    let res: Response;
    try {
        res = await fetch(`${base}${path}`, {
            ...(body ? { body: JSON.stringify(body) } : {}),
            headers: {
                Authorization: `Bearer ${hubAuth.bearer() ?? ''}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            method,
            signal: AbortSignal.timeout(MOOD_TIMEOUT_MS),
        });
    } catch (error) {
        const cause = (error as { cause?: unknown }).cause;
        log.warn(`[mood] ${method} ${path}: ${String(error)}${cause ? ` (${String(cause)})` : ''}`);
        return { error: 'Could not reach the hub.', kind: 'unavailable', ok: false, status: 0 };
    }

    let json: unknown = null;
    try {
        json = await res.json();
    } catch {
        json = null;
    }

    if (!res.ok) {
        const code = json && typeof json === 'object' ? (json as Json).code : undefined;
        const outcome = moodOutcome(res.status, typeof code === 'string' ? code : undefined);
        // Path and status only: a mood and a variant are listening data, not a diagnostic.
        log.warn(`[mood] ${method} ${path} -> ${res.status}`);
        return {
            error: `Request failed (${res.status})`,
            kind: outcome === 'ok' ? 'unavailable' : outcome,
            ok: false,
            status: res.status,
        };
    }

    const data = parse(json);
    if (data === null) {
        log.warn(`[mood] ${method} ${path} -> ${res.status} with an unreadable body`);
        return {
            error: 'The hub answered with something this app cannot read.',
            kind: 'unavailable',
            ok: false,
            status: res.status,
        };
    }
    return { data, ok: true, status: res.status };
};

ipcMain.handle(
    'mood-catalogue',
    async (): Promise<MoodResult<MoodCatalogue>> =>
        request('GET', '/sonic/mood/catalogue', undefined, parseMoodCatalogue),
);

ipcMain.handle(
    'mood-list',
    async (_event, body: { mood: string; variant: string }): Promise<MoodResult<MoodListData>> =>
        request(
            'POST',
            '/sonic/mood/list',
            { mood: String(body?.mood ?? ''), variant: String(body?.variant ?? '') },
            parseMoodList,
        ),
);
