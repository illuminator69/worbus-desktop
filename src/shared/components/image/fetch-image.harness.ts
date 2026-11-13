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
