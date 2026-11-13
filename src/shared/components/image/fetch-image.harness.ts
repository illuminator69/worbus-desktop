import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

/**
 * B-412, the cause (2026-11-13):
 *   node --test src/shared/components/image/fetch-image.harness.ts
 *
 * The owner's Navidrome answers every In Waves song with the same 1339-byte JPEG when asked one at
 * a time (the read-only probe). The dev profile's own HTTP cache holds what it answered the desktop:
 * for 6 of the 12 songs, asked together in one second (01:12:34Z), `200`, `Content-Length: 0`, no
 * Content-Type, `Cache-Control: public, no-cache`; the other 6 the JPEG. Those 6 are exactly the
 * failing rows (Baddy on the Floor, The Feeling I…, Treat Each Other Right, Breather, All You…,
 * Every Single…). The desktop took an empty 200 as an image: a blob of nothing, which the <img> could
 * not decode (before the B-412 stack fix: a broken glyph over another song's cover; after it: the
 * empty-art icon). An empty or non-image 200 is a failed answer, retried past the HTTP cache.
 *
 * The stand-in: one JPEG for every id, `public, no-cache`; the first ask of each id answers the
 * empty 200 the owner's server did under load.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0x43, 0, 1, 2, 3, 0xff, 0xd9]);

const standIn = async (emptyFirst: number) => {
    const asked = new Map<string, number>();
    const server = createServer((req, res) => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        const n = (asked.get(id) ?? 0) + 1;
        asked.set(id, n);
        res.setHeader('Cache-Control', 'public, no-cache');
        if (n <= emptyFirst) {
            res.setHeader('Content-Length', '0');
            res.end();
            return;
        }
        res.setHeader('Content-Type', 'image/jpeg');
        res.end(JPEG);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return { asked, base: `http://127.0.0.1:${port}`, close: () => server.close() };
};

type FetchImage = (
    request: { url: string },
    init: { signal: AbortSignal },
    options?: { budgetMs?: number; delaysMs?: number[]; reaskTimeoutMs?: number },
) => Promise<Blob>;

const load = async () =>
    ((await import('./fetch-image.ts').catch(() => null)) as null | { fetchImage: FetchImage })
        ?.fetchImage;

test('an_empty_200_is_asked_again_and_the_image_arrives', async () => {
    const s = await standIn(1);
    try {
        const fetchImage = await load();
        assert.ok(fetchImage, 'an empty 200 is taken as the image (a blob of nothing)');
        const ids = ['3OORz6xNV6Kc82jebP3MNh', '4BkcU7ab3FXAfd6ivlrOvU', '14A1Uwln8MSQ736eDLYd1I'];
        const blobs = await Promise.all(
            ids.map((id) =>
                fetchImage(
                    { url: `${s.base}/rest/getCoverArt.view?id=${id}&size=80` },
                    { signal: new AbortController().signal },
                    { delaysMs: [1, 1] },
                ),
            ),
        );
        for (const blob of blobs) {
            assert.equal(blob.size, JPEG.length);
            assert.equal(blob.type, 'image/jpeg');
        }
        for (const id of ids) assert.equal(s.asked.get(id), 2, 'asked once more, no more');
    } finally {
        s.close();
    }
});

test('a_server_that_keeps_answering_nothing_is_a_failure', async () => {
    const s = await standIn(99);
    try {
        const fetchImage = (await load())!;
        await assert.rejects(
            fetchImage(
                { url: `${s.base}/rest/getCoverArt.view?id=x&size=80` },
                { signal: new AbortController().signal },
                { delaysMs: [1, 1] },
            ),
        );
        assert.equal(s.asked.get('x'), 3, 'three asks in all');
    } finally {
        s.close();
    }
});

test('the_native_image_fetches_through_it', async () => {
    const { readFileSync } = await import('node:fs');
    const hook = readFileSync(new URL('./use-native-image.ts', import.meta.url), 'utf8');
    // B-412 follow-up: through the memory cache, whose misses go to fetchImage.
    assert.match(hook, /loadCachedImage\(/, 'useNativeImage reads one fetch, any 200 its image');
    const cache = readFileSync(new URL('./image-memory-cache.ts', import.meta.url), 'utf8');
    assert.match(cache, /await fetchImage\(/, 'the memory cache fetches its misses through it');
});

/**
 * B-412, the burst (owner re-check of `5201f1416`: Still Summer and The Feeling I… still empty, their
 * last stored answers empty 200s at 01:26:01Z). Navidrome 0.64.2, read: the 11 songs of In Waves'
 * disc share ONE resized-cover cache entry (`serveDisc` keys it by disc id, album time and
 * DiscArtPriority, not by the song); the first request writes it while the others read it as it is
 * written (`utils/cache/file_caches.go` Get: a reader of an entry in progress). When the writer's
 * request is cancelled (the desktop aborted it: a row or the player bar re-rendered, a card left the
 * viewport), its read fails, the writer is closed with nothing in it, and every reader of that entry
 * ends at a clean EOF: `200`, `Content-Length: 0`. The stand-in models that: one shared entry, the
 * first request in a wave writes it, a writer whose client goes away leaves the wave's readers empty.
 * The desktop must not cancel a cover request it has sent (only one still waiting to be sent), and
 * must not send more than a few at once.
 */
const sharedEntryStandIn = async () => {
    let wave: null | { readers: ((body: Buffer) => void)[] } = null;
    let inFlight = 0;
    let maxInFlight = 0;
    let cancelled = 0;
    const asked = new Map<string, number>();
    const server = createServer((req, res) => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        asked.set(id, (asked.get(id) ?? 0) + 1);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        let done = false;
        const answer = (body: Buffer) => {
            if (done) return;
            done = true;
            inFlight -= 1;
            res.setHeader('Cache-Control', 'public, no-cache');
            if (body.length) res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Content-Length', String(body.length));
            res.end(body);
        };
        req.on('close', () => {
            if (!done && !res.writableEnded) {
                cancelled += 1;
                done = true;
                inFlight -= 1;
            }
        });
        if (wave) {
            wave.readers.push(answer);
            return;
        }
        const current: { readers: ((body: Buffer) => void)[] } = { readers: [answer] };
        wave = current;
        setTimeout(() => {
            // The writer's request went away: the entry closes empty for every reader.
            const writerGone = done;
            wave = null;
            for (const reader of current.readers) reader(writerGone ? Buffer.alloc(0) : JPEG);
        }, 60);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return {
        asked,
        base: `http://127.0.0.1:${port}`,
        close: () => server.close(),
        stats: () => ({ cancelled, maxInFlight }),
    };
};

test('a_row_that_goes_away_does_not_empty_the_other_rows_covers', async () => {
    const s = await sharedEntryStandIn();
    try {
        const fetchImage = (await load())!;
        const ids = ['still-summer', 'feeling', 'breather', 'all-you', 'every-single', 'falling'];
        const controllers = ids.map(() => new AbortController());
        const asks = ids.map((id, i) =>
            fetchImage(
                { url: `${s.base}/rest/getCoverArt.view?id=${id}&size=80` },
                { signal: controllers[i].signal },
                { delaysMs: [1, 1] },
            ),
        );
        // The first row re-renders 20 ms in: its fetch is aborted while it writes the shared entry.
        setTimeout(() => controllers[0].abort(), 20);
        const results = await Promise.allSettled(asks);
        assert.equal(results[0].status, 'rejected', 'the row that went away gets nothing');
        for (const r of results.slice(1)) {
            assert.equal(r.status, 'fulfilled');
            assert.equal((r as PromiseFulfilledResult<Blob>).value.size, JPEG.length);
        }
        const { cancelled, maxInFlight } = s.stats();
        assert.equal(cancelled, 0, 'a sent cover request was cancelled: its readers got nothing');
        assert.ok(maxInFlight <= 4, `${maxInFlight} cover requests in flight at once`);
        for (const id of ids.slice(1)) {
            assert.equal(s.asked.get(id), 1, `${id}: asked again after an empty answer`);
        }
    } finally {
        s.close();
    }
});

/**
 * B-412, re-walk on `a96a9de17` (cold start, In Waves in the side queue): Treat Each… and Life still
 * show the empty-art icon, a different pair from the walk before. A cover the server answers empty
 * more than twice was given up after three asks in ~4 s (1 s, then 3 s), and the re-asks of every
 * row that got an empty answer went out together at the same moments: one more wave on the disc's
 * shared resize entry, the very condition that emptied them (B-415: asked together, empty; one at a
 * time, the JPEG). A cover is asked again, with a growing wait, until it gets an image or a real
 * error, and the re-asks to one server go one at a time.
 */
const delayedStandIn = async (emptyFor: (id: string) => number, holdMs: number) => {
    const asked = new Map<string, number>();
    let reasksInFlight = 0;
    let maxReasksInFlight = 0;
    const server = createServer((req, res) => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        const n = (asked.get(id) ?? 0) + 1;
        asked.set(id, n);
        const reask = n > 1;
        if (reask) {
            reasksInFlight += 1;
            maxReasksInFlight = Math.max(maxReasksInFlight, reasksInFlight);
        }
        setTimeout(() => {
            if (reask) reasksInFlight -= 1;
            res.setHeader('Cache-Control', 'public, no-cache');
            if (n <= emptyFor(id)) {
                res.setHeader('Content-Length', '0');
                res.end();
                return;
            }
            res.setHeader('Content-Type', 'image/jpeg');
            res.end(JPEG);
        }, holdMs);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return {
        asked,
        base: `http://127.0.0.1:${port}`,
        close: () => server.close(),
        maxReasks: () => maxReasksInFlight,
    };
};

test('a_cover_answered_empty_three_times_still_arrives', async () => {
    // Treat Each… and Life: empty for their first three asks, then the JPEG.
    const stuck = new Set(['life', 'treat-each']);
    const s = await delayedStandIn((id) => (stuck.has(id) ? 3 : 0), 5);
    try {
        const fetchImage = (await load())!;
        // The default number of re-asks, each wait shortened to 1 ms (the base: 2, not exported).
        const mod = (await import('./fetch-image.ts')) as unknown as { RETRY_DELAYS_MS?: number[] };
        const delaysMs = (mod.RETRY_DELAYS_MS ?? [1000, 3000]).map(() => 1);
        const ids = ['treat-each', 'life', 'sleep-sound', 'girl'];
        const results = await Promise.allSettled(
            ids.map((id) =>
                fetchImage(
                    { url: `${s.base}/rest/getCoverArt.view?id=${id}&size=80` },
                    { signal: new AbortController().signal },
                    { delaysMs },
                ),
            ),
        );
        for (const [i, r] of results.entries()) {
            assert.equal(
                r.status,
                'fulfilled',
                `${ids[i]}: given up while the server was still answering empty`,
            );
        }
        assert.equal(s.asked.get('treat-each'), 4, 'asked until the image came, no more');
        assert.equal(s.asked.get('sleep-sound'), 1);
    } finally {
        s.close();
    }
});

test('the_re_asks_to_one_server_go_one_at_a_time', async () => {
    const s = await delayedStandIn(() => 1, 40);
    try {
        const fetchImage = (await load())!;
        const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
        await Promise.all(
            ids.map((id) =>
                fetchImage(
                    { url: `${s.base}/rest/getCoverArt.view?id=${id}&size=80` },
                    { signal: new AbortController().signal },
                    { delaysMs: [1, 1] },
                ),
            ),
        );
        assert.equal(s.maxReasks(), 1, `${s.maxReasks()} re-asks in flight at once: one more wave`);
    } finally {
        s.close();
    }
});

test('the_default_wait_grows_and_outlasts_a_burst_without_asking_forever', async () => {
    const mod = (await import('./fetch-image.ts')) as unknown as { RETRY_DELAYS_MS?: number[] };
    const delays = mod.RETRY_DELAYS_MS;
    assert.ok(Array.isArray(delays), 'RETRY_DELAYS_MS is exported');
    for (let i = 1; i < delays.length; i += 1) {
        assert.ok(delays[i] >= delays[i - 1], 'each wait at least the one before');
    }
    const total = delays.reduce((a, b) => a + b, 0);
    assert.ok(total >= 60_000, `asks again for ${total} ms only: a burst outlasts that`);
    assert.ok(delays.length <= 10, `${delays.length + 1} asks per cover: a storm`);
    assert.ok(Math.max(...delays) <= 30_000, 'no wait longer than 30 s');
});

test('a_cover_whose_row_goes_away_while_it_waits_is_not_asked_again', async () => {
    const s = await delayedStandIn(() => 99, 1);
    try {
        const fetchImage = (await load())!;
        const controller = new AbortController();
        const pending = fetchImage(
            { url: `${s.base}/rest/getCoverArt.view?id=gone&size=80` },
            { signal: controller.signal },
            { delaysMs: [50, 50, 50] },
        );
        setTimeout(() => controller.abort(), 25);
        await assert.rejects(pending);
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(s.asked.get('gone'), 1, 'asked again after its row went away');
    } finally {
        s.close();
    }
});

/**
 * B-412 review M1 (2026-11-13, probe `reask-lane-stall.probe.ts`): the re-asks to one server go one
 * at a time, and the lane was given back only when the sent request ended. Nothing timed a request
 * out, and a caller's abort does not cancel a sent request (by design), so one re-ask that never
 * got an answer (a stalled resize, a TCP path left dead by sleep/wake) held the lane for good:
 * every other emptied row on that server waited in `loading` forever, past the ~2 min bound,
 * never reaching the empty-art icon. A re-ask is timed out, a row that goes away gives the lane
 * back, and waiting for the lane counts in the cover's budget.
 */
const stallingStandIn = async (stalls: (id: string, n: number) => boolean) => {
    const asked = new Map<string, number>();
    const server = createServer((req, res) => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        const n = (asked.get(id) ?? 0) + 1;
        asked.set(id, n);
        if (n === 1) {
            // every cover's first ask: the empty 200 of a burst
            res.setHeader('Content-Length', '0');
            res.end();
            return;
        }
        if (stalls(id, n)) return; // never answered
        res.setHeader('Content-Type', 'image/jpeg');
        res.end(JPEG);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return {
        asked,
        base: `http://127.0.0.1:${port}`,
        close: () => {
            server.closeAllConnections();
            server.close();
        },
    };
};

const settle = (p: Promise<unknown>) => {
    const state = { value: 'pending' as 'error' | 'image' | 'pending' };
    p.then(
        () => (state.value = 'image'),
        () => (state.value = 'error'),
    );
    return state;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a_re_ask_that_never_answers_does_not_hold_the_lane_for_good', async () => {
    const s = await stallingStandIn((id) => id === 'stuck');
    try {
        const fetchImage = (await load())!;
        const stuck = settle(
            fetchImage(
                { url: `${s.base}/rest/getCoverArt.view?id=stuck` },
                { signal: new AbortController().signal },
                { delaysMs: [1, 1, 1], reaskTimeoutMs: 150 },
            ),
        );
        await wait(60); // stuck's re-ask is in flight, holding the lane
        const other = settle(
            fetchImage(
                { url: `${s.base}/rest/getCoverArt.view?id=other` },
                { signal: new AbortController().signal },
                { delaysMs: [1, 1, 1], reaskTimeoutMs: 150 },
            ),
        );
        await wait(1500);
        assert.equal(
            other.value,
            'image',
            `other is ${other.value}: the stalled re-ask held the lane`,
        );
        assert.equal(
            stuck.value,
            'error',
            'the cover that never answers ends as the empty-art icon',
        );
    } finally {
        s.close();
    }
});

test('a_row_that_goes_away_gives_the_lane_back', async () => {
    const s = await stallingStandIn((id) => id === 'stuck');
    try {
        const fetchImage = (await load())!;
        const gone = new AbortController();
        fetchImage(
            { url: `${s.base}/rest/getCoverArt.view?id=stuck` },
            { signal: gone.signal },
            { delaysMs: [1, 1, 1], reaskTimeoutMs: 60_000 },
        ).catch(() => {});
        await wait(60);
        const other = settle(
            fetchImage(
                { url: `${s.base}/rest/getCoverArt.view?id=other` },
                { signal: new AbortController().signal },
                { delaysMs: [1, 1, 1], reaskTimeoutMs: 60_000 },
            ),
        );
        await wait(60);
        gone.abort(); // stuck's row unmounts while its re-ask hangs
        await wait(500);
        assert.equal(
            other.value,
            'image',
            `other is ${other.value}: the lane went with the request`,
        );
    } finally {
        s.close();
    }
});

test('waiting_for_the_lane_counts_in_the_covers_budget', async () => {
    const s = await stallingStandIn((id) => id === 'stuck');
    try {
        const fetchImage = (await load())!;
        fetchImage(
            { url: `${s.base}/rest/getCoverArt.view?id=stuck` },
            { signal: new AbortController().signal },
            { budgetMs: 60_000, delaysMs: [1, 1, 1], reaskTimeoutMs: 60_000 },
        ).catch(() => {});
        await wait(60);
        const other = settle(
            fetchImage(
                { url: `${s.base}/rest/getCoverArt.view?id=other` },
                { signal: new AbortController().signal },
                { budgetMs: 300, delaysMs: [1, 1, 1], reaskTimeoutMs: 60_000 },
            ),
        );
        await wait(1000);
        assert.equal(
            other.value,
            'error',
            `other is ${other.value} after its budget, waiting for the lane`,
        );
    } finally {
        s.close();
    }
});

test('a_cover_has_a_re_ask_timeout_and_a_budget_by_default', async () => {
    const mod = (await import('./fetch-image.ts')) as unknown as {
        GIVE_UP_AFTER_MS?: number;
        REASK_TIMEOUT_MS?: number;
        RETRY_DELAYS_MS: number[];
    };
    assert.equal(typeof mod.REASK_TIMEOUT_MS, 'number', 'a re-ask waits for its answer forever');
    assert.ok(mod.REASK_TIMEOUT_MS! <= 30_000, 'a re-ask timeout longer than 30 s');
    assert.equal(typeof mod.GIVE_UP_AFTER_MS, 'number', 'no bound on lane waiting');
    const total = mod.RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    assert.ok(mod.GIVE_UP_AFTER_MS! >= total, 'the budget is shorter than the schedule');
    assert.ok(mod.GIVE_UP_AFTER_MS! <= 180_000, 'a cover may spin for more than 3 min');
});

/**
 * B-412 review L1 (2026-11-13): the long schedule (9 asks over ~2 min) is for the case B-415
 * measured, Navidrome's `getCoverArt` answering an empty 200 under a burst. A host that answers
 * 5xx or 429, or an empty 200 from a host that is not a Subsonic cover endpoint (a "no art" answer,
 * Cover Art Archive), spun for over 2 min and cost 9 asks, all through the server's one re-ask lane
 * ahead of real recoveries. Definitive answers (a 404, a 501, a body that is not an image) fail at
 * the first answer.
 */
const answeringStandIn = async (answer: (res: import('node:http').ServerResponse) => void) => {
    let asked = 0;
    const server = createServer((_req, res) => {
        asked += 1;
        answer(res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return { asked: () => asked, base: `http://127.0.0.1:${port}`, close: () => server.close() };
};

const quickDefaults = async () => {
    const mod = (await import('./fetch-image.ts')) as unknown as { RETRY_DELAYS_MS: number[] };
    return mod.RETRY_DELAYS_MS.map(() => 1);
};

const asksFor = async (path: string, answer: (res: import('node:http').ServerResponse) => void) => {
    const s = await answeringStandIn(answer);
    try {
        const fetchImage = (await load())!;
        await assert.rejects(
            fetchImage(
                { url: `${s.base}${path}` },
                { signal: new AbortController().signal },
                { delaysMs: await quickDefaults() },
            ),
        );
        return s.asked();
    } finally {
        s.close();
    }
};

const empty = (res: import('node:http').ServerResponse) => {
    res.setHeader('Content-Length', '0');
    res.end();
};

test('a_server_error_is_asked_again_a_few_times_not_the_whole_schedule', async () => {
    for (const status of [503, 429, 500]) {
        const n = await asksFor('/rest/getCoverArt.view?id=x', (res) => {
            res.statusCode = status;
            res.end();
        });
        assert.ok(n > 1, `${status}: not asked again`);
        assert.ok(n <= 4, `${status}: asked ${n} times`);
    }
});

test('an_empty_200_from_another_host_is_asked_again_a_few_times', async () => {
    const n = await asksFor('/release/abc/front-250', empty);
    assert.ok(n > 1 && n <= 4, `an empty 200 off a cover endpoint: asked ${n} times`);
});

test('navidromes_empty_cover_keeps_the_whole_schedule', async () => {
    const n = await asksFor('/rest/getCoverArt.view?id=x&size=80', empty);
    assert.equal(n, (await quickDefaults()).length + 1);
});

test('a_definitive_answer_fails_at_the_first', async () => {
    const notFound = await asksFor('/rest/getCoverArt.view?id=x', (res) => {
        res.statusCode = 404;
        res.end();
    });
    assert.equal(notFound, 1, '404');
    const notImplemented = await asksFor('/rest/getCoverArt.view?id=x', (res) => {
        res.statusCode = 501;
        res.end();
    });
    assert.equal(notImplemented, 1, '501');
    const document = await asksFor('/rest/getCoverArt.view?id=x', (res) => {
        res.setHeader('Content-Type', 'text/xml');
        res.end('<subsonic-response status="failed"/>');
    });
    assert.equal(document, 1, 'a Subsonic error document');
});
