/**
 * The stage 2 review's n5: what a failed rating save puts back in the views the query caches do not
 * hold (list rows, the player's queue, the hub mirror). The optimistic `USER_RATING` emit carries an
 * empty `previous` map; each listener notes what it showed for an id before applying the new value
 * (the first answer wins), and a failed save emits those values back, one event per value.
 */

interface RatingPayload {
    id: string[];
    itemType: string;
    previous?: Map<string, null | number>;
    rating: null | number;
    serverId: string;
}

/** A listener noting what it showed for `id` before the optimistic value lands. */
export const notePrevious = (
    payload: RatingPayload,
    id: string,
    rating: null | number | undefined,
) => {
    if (!payload.previous || payload.previous.has(id)) return;
    payload.previous.set(id, rating ?? null);
};

/** The events that put back what the listeners showed before a failed save. */
export const restorePayloads = <P extends RatingPayload>(payload: P): P[] => {
    const byRating = new Map<null | number, string[]>();
    for (const [id, rating] of payload.previous ?? []) {
        const ids = byRating.get(rating) ?? [];
        ids.push(id);
        byRating.set(rating, ids);
    }
    return [...byRating].map(([rating, id]) => ({
        ...payload,
        id,
        previous: undefined,
        rating,
    }));
};
