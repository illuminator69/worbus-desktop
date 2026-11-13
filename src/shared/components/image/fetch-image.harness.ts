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
    options?: { delaysMs?: number[] },
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
    assert.match(hook, /fetchImage\(/, 'useNativeImage reads one fetch, any 200 its image');
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
