import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';

/**
 * B-412 follow-up (owner's second re-walk, 2026-11-13 evening): "the cover arts disappear when
 * scrolling away and then load in again when the attention comes back to them. this never happened
 * on mobile".
 *   node --test src/shared/components/image/image-memory-cache.harness.ts
 *
 * The lists are virtualised: a row that scrolls out of the overscan unmounts, and `useNativeImage`
 * revoked its blob on unmount and fetched the cover again on the next mount (through the per-server
 * slots, behind whatever else was in flight). Worbus for Android keeps every cover it has decoded in
 * Coil's memory cache keyed by the cover id (`memoryCacheKey(coverArtId)`), so a row that comes back
 * shows it at once. The desktop's equivalent: a bounded memory cache keyed by the request's identity
 * (`ImageRequest.cacheKey`: server, base URL, id, size; never the salted-token URL), which keeps the
 * bytes and one object URL per cover, so a remount shows the same image on its first render without
 * a request. An empty answer (B-412) is never kept as the image.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0x43, 0, 1, 2, 3, 0xff, 0xd9]);

const standIn = async () => {
    let mode: 'empty' | 'jpeg' = 'jpeg';
    let asked = 0;
    const server = createServer((_req, res) => {
        asked += 1;
        res.setHeader('Cache-Control', 'public, no-cache');
        if (mode === 'empty') {
            res.setHeader('Content-Length', '0');
            res.end();
            return;
        }
        res.setHeader('Content-Type', 'image/jpeg');
        res.end(JPEG);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return {
        asked: () => asked,
        base: `http://127.0.0.1:${port}`,
        close: () => server.close(),
        setMode: (next: 'empty' | 'jpeg') => {
            mode = next;
        },
    };
};

type Cache = {
    forget: (key: string) => void;
    peek: (key: string) => string | undefined;
    put: (key: string, blob: Blob) => string | undefined;
    release: (url: string) => void;
    size: () => { bytes: number; entries: number };
    take: (key: string) => string | undefined;
};

type Module = {
    ImageMemoryCache: new (limits?: { maxBytes?: number; maxEntries?: number }) => Cache;
    imageMemoryCache: Cache;
    loadCachedImage: (
        request: { cacheKey?: string; url: string },
        init: { signal?: AbortSignal },
        options?: { budgetMs?: number; delaysMs?: number[] },
        cache?: Cache,
    ) => Promise<string>;
    MEMORY_CACHE_MAX_BYTES: number;
    MEMORY_CACHE_MAX_ENTRIES: number;
};

const load = async () =>
    (await import('./image-memory-cache.ts').catch(() => null)) as Module | null;

const alive = (url: string) => resolveObjectURL(url) !== undefined;

const cover = (base: string, id: string, salt: string) => ({
    cacheKey: ['subsonic', 'server-1', '', id, 80].join(':'),
    url: `${base}/rest/getCoverArt.view?id=${id}&u=walk&t=tok${salt}&s=${salt}&v=1.13.0&c=Worbus&size=80`,
});

test('a_cover_shown_once_shows_again_on_remount_with_no_request', async () => {
    const s = await standIn();
    try {
        const m = await load();
        assert.ok(m, 'no memory cache: a remounted row fetches its cover again');
        const cache = new m.ImageMemoryCache();
        const first = cover(s.base, 'G02', 'a1');
        // Mount, the cover loads, the row scrolls away (unmount).
        const shown = await m.loadCachedImage(first, {}, {}, cache);
        assert.equal(s.asked(), 1);
        cache.release(shown);
        assert.ok(alive(shown), 'the cache keeps the bytes after the row unmounts');
        // Remount: the first render already has the image.
        assert.equal(
            cache.peek(first.cacheKey),
            shown,
            'first render of the remount: the same image',
        );
        const again = await m.loadCachedImage(first, {}, {}, cache);
        assert.equal(again, shown);
        assert.equal(s.asked(), 1, 'the remount asked the server nothing');
        cache.release(again);
    } finally {
        s.close();
    }
});

test('the_key_is_the_requests_identity_not_its_salted_url', async () => {
    const s = await standIn();
    try {
        const m = await load();
        assert.ok(m, 'no memory cache');
        const cache = new m.ImageMemoryCache();
        const a = await m.loadCachedImage(cover(s.base, 'G03', 'salt-one'), {}, {}, cache);
        const b = await m.loadCachedImage(cover(s.base, 'G03', 'salt-two'), {}, {}, cache);
        assert.equal(b, a, 'a new salt is the same cover');
        assert.equal(s.asked(), 1);
        cache.release(a);
        cache.release(b);
    } finally {
        s.close();
    }
    // The keys the servers' requests carry hold no credential (the salt and token change per login).
    for (const file of [
        '../../../renderer/api/subsonic/subsonic-controller.ts',
        '../../../renderer/api/jellyfin/jellyfin-controller.ts',
    ]) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8');
        const keyLine = source.split('\n').find((line) => /cacheKey:\s*\[/.test(line));
        assert.ok(keyLine, `${file}: a cacheKey`);
        assert.doesNotMatch(keyLine!, /credential|token|\burl\b/i, `${file}: ${keyLine}`);
    }
});

test('an_empty_200_is_never_cached', async () => {
    const s = await standIn();
    try {
        const m = await load();
        assert.ok(m, 'no memory cache');
        const cache = new m.ImageMemoryCache();
        const request = cover(s.base, 'G05', 'x');
        s.setMode('empty');
        await assert.rejects(m.loadCachedImage(request, {}, { delaysMs: [1, 1, 1] }, cache));
        assert.equal(cache.peek(request.cacheKey), undefined, 'the empty answer is not the image');
        assert.equal(cache.size().entries, 0);
        // Asked again on the next mount, and kept once it is an image.
        const before = s.asked();
        s.setMode('jpeg');
        const url = await m.loadCachedImage(request, {}, {}, cache);
        assert.equal(s.asked(), before + 1, 'the next mount asks the server again');
        assert.equal(cache.peek(request.cacheKey), url);
        cache.release(url);
        // And put refuses what is not an image, whoever hands it over.
        assert.equal(cache.put('k-empty', new Blob([])), undefined);
        assert.equal(cache.put('k-xml', new Blob(['<error/>'], { type: 'text/xml' })), undefined);
        assert.equal(
            cache.put('k-json', new Blob(['{}'], { type: 'application/json' })),
            undefined,
        );
        assert.equal(cache.size().entries, 1);
    } finally {
        s.close();
    }
});

test('the_cache_is_bounded', async () => {
    const m = await load();
    assert.ok(m, 'no memory cache');
    const image = (n: number) => new Blob([Buffer.alloc(n, 1)], { type: 'image/jpeg' });

    // By count: the least recently shown go first, and their object URLs are revoked.
    const byCount = new m.ImageMemoryCache({ maxBytes: 1_000_000, maxEntries: 3 });
    const urls = ['a', 'b', 'c', 'd', 'e'].map((key) => {
        const url = byCount.put(key, image(10))!;
        byCount.release(url);
        if (key === 'c') byCount.peek('a'); // shown again: no longer the oldest
        return url;
    });
    assert.equal(byCount.size().entries, 3);
    assert.equal(byCount.peek('b'), undefined);
    assert.equal(byCount.peek('c'), undefined);
    assert.ok(byCount.peek('a'), 'a cover shown again is kept');
    assert.ok(!alive(urls[1]) && !alive(urls[2]), 'an evicted cover frees its bytes');

    // By bytes.
    const byBytes = new m.ImageMemoryCache({ maxBytes: 100, maxEntries: 1000 });
    for (const key of ['p', 'q', 'r', 's']) byBytes.release(byBytes.put(key, image(40))!);
    assert.ok(byBytes.size().bytes <= 100, `bytes ${byBytes.size().bytes}`);

    // A cover on screen is never evicted under it; it goes once released, if still over.
    const held = new m.ImageMemoryCache({ maxBytes: 1_000_000, maxEntries: 2 });
    const onScreen = held.put('on-screen', image(10))!;
    for (const key of ['x', 'y', 'z']) held.release(held.put(key, image(10))!);
    assert.equal(held.peek('on-screen'), onScreen);
    assert.ok(alive(onScreen));
    assert.ok(held.size().entries <= 2);

    // Forgotten while on screen (it would not decode): gone from the cache, freed when released.
    held.forget('on-screen');
    assert.equal(held.peek('on-screen'), undefined);
    assert.ok(alive(onScreen), 'still shown: not revoked under the element');
    held.release(onScreen);
    assert.ok(!alive(onScreen));

    // The shared cache's own bounds are finite and sane.
    assert.ok(m.MEMORY_CACHE_MAX_ENTRIES > 100 && m.MEMORY_CACHE_MAX_ENTRIES <= 5000);
    assert.ok(m.MEMORY_CACHE_MAX_BYTES > 0 && m.MEMORY_CACHE_MAX_BYTES <= 256 * 1024 * 1024);
});

test('the_native_image_reads_the_memory_cache', () => {
    const hook = readFileSync(new URL('./use-native-image.ts', import.meta.url), 'utf8');
    assert.match(hook, /loadCachedImage\(/, 'useNativeImage loads through the memory cache');
    assert.match(
        hook,
        /useState<NativeImageState>\(\s*\(\)\s*=>/,
        'the first render of a remount starts from the cache',
    );
    assert.match(hook, /imageMemoryCache\.peek\(/);
    assert.doesNotMatch(
        hook,
        /URL\.revokeObjectURL/,
        'an unmount releases the cover to the cache instead of revoking it',
    );
    const image = readFileSync(new URL('./image.tsx', import.meta.url), 'utf8');
    assert.match(image, /imageMemoryCache\.forget\(/, 'a cover that will not decode is not kept');
});
