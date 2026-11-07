import type { DiscographyView } from './discography-model.ts';

import { RELEASE_KINDS } from './release-kind.ts';

/**
 * navi-connect F7 (Call 1): the discography's view lives in the URL (`?type=`, `?own=`, `?sort=`,
 * `?dir=`), defaults left out, so Back restores it and nothing global is written.
 */

export const DEFAULT_VIEW: DiscographyView = { dir: 'desc', own: 'all', sort: 'year', type: 'all' };

const ALLOWED: { [K in keyof DiscographyView]: readonly string[] } = {
    dir: ['asc', 'desc'],
    own: ['all', 'missing', 'owned', 'partly', 'syncing'],
    sort: ['added', 'plays', 'title', 'year'],
    type: ['all', ...RELEASE_KINDS],
};

const KEYS = Object.keys(ALLOWED) as (keyof DiscographyView)[];

/** Never throws: an unknown or malformed value falls back to that key's default. */
export const parseView = (params: URLSearchParams): DiscographyView => {
    const view = { ...DEFAULT_VIEW };
    for (const key of KEYS) {
        const value = params.get(key);
        if (value && ALLOWED[key].includes(value)) {
            (view as Record<string, string>)[key] = value;
        }
    }
    return view;
};

/** A copy of `params` holding `view`: defaults removed, unrelated keys (`name`, `artist`) kept. */
export const writeView = (view: DiscographyView, params: URLSearchParams): URLSearchParams => {
    const next = new URLSearchParams(params);
    for (const key of KEYS) {
        if (view[key] === DEFAULT_VIEW[key]) next.delete(key);
        else next.set(key, view[key]);
    }
    return next;
};

export const viewIsDefault = (view: DiscographyView): boolean =>
    KEYS.every((key) => view[key] === DEFAULT_VIEW[key]);
