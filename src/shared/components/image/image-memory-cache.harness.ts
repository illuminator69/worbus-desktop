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
    // Review L4: the hook's logic is NativeImageCore (native-image-core.harness.ts drives it).
    const core = readFileSync(new URL('./native-image-core.ts', import.meta.url), 'utf8');
    assert.match(core, /load = loadCachedImage/, 'useNativeImage loads through the memory cache');
    assert.match(core, /this\.cache\.pin\(/, 'the first render of a remount starts from the cache');
    assert.doesNotMatch(
        core,
        /URL\.revokeObjectURL/,
        'an unmount releases the cover to the cache instead of revoking it',
    );
    const hook = readFileSync(new URL('./use-native-image.ts', import.meta.url), 'utf8');
    assert.match(hook, /useState<NativeImageState>\(\(\) => core\.first\(request\)\)/);
    assert.doesNotMatch(hook, /URL\.revokeObjectURL/);
    const image = readFileSync(new URL('./image.tsx', import.meta.url), 'utf8');
    assert.match(image, /imageMemoryCache\.forget\(/, 'a cover that will not decode is not kept');
});

/**
 * Review of `99477e450` (REVIEW-second-rewalk-desktop-2026-11-13), M1: the full-screen player asks
 * for every song's cover at its original size (`imageRes.fullScreenPlayer: 0`, no `size`), and
 * originals run to megabytes. In one byte budget they pushed out hundreds of list covers, so
 * scroll-back blanked and asked again: the owner's complaint, back.
 */
type Limits = {
    largeBodyBytes?: number;
    largeMaxBytes?: number;
    maxBytes?: number;
    maxEntries?: number;
    maxKeptBodyBytes?: number;
    pinMs?: number;
};

test('full_size_and_very_large_covers_do_not_flush_list_covers', async () => {
    const m = (await load()) as unknown as null | {
        ImageMemoryCache: new (limits?: Limits) => CacheM1;
    };
    assert.ok(m, 'no memory cache');
    const image = (n: number) => new Blob([Buffer.alloc(n, 1)], { type: 'image/jpeg' });
    const list = (i: number) => ['subsonic', 'srv', '', `G${i}`, 80].join(':');
    const original = (id: string) => ['subsonic', 'srv', '', id, ''].join(':');

    // The reviewer's probe: 400 released 100 KB grid covers, then one held 40 MiB cover.
    const cache = new m.ImageMemoryCache();
    for (let i = 0; i < 400; i += 1) cache.release(cache.put(list(i), image(100_000))!);
    const big = cache.put(original('song-big'), image(40 * 1024 * 1024));
    assert.ok(big, 'a very large cover is still shown');
    assert.ok(alive(big!), 'and alive while its element holds it');
    let kept = 0;
    for (let i = 0; i < 400; i += 1) if (cache.peek(list(i))) kept += 1;
    assert.equal(kept, 400, `list covers kept after one 40 MiB cover: ${kept} of 400`);
    cache.release(big!);
    assert.equal(cache.peek(original('song-big')), undefined, 'a 40 MiB body is not kept');
    assert.ok(!alive(big!), 'and its bytes go when its element lets go');

    // A listening session with the full-screen player: a dozen originals of a few MiB each.
    for (let s = 0; s < 12; s += 1) {
        cache.release(cache.put(original(`song-${s}`), image(5 * 1024 * 1024))!);
    }
    kept = 0;
    for (let i = 0; i < 400; i += 1) if (cache.peek(list(i))) kept += 1;
    assert.equal(kept, 400, `list covers kept after 12 full-size covers: ${kept} of 400`);
    assert.ok(cache.peek(original('song-11')), 'the newest original is kept (its own budget)');
    assert.ok(cache.size().largeBytes <= 32 * 1024 * 1024, `large ${cache.size().largeBytes}`);

    // An unsized (full-size) cover is in the small budget even when its body is small.
    const tiny = new m.ImageMemoryCache({ largeMaxBytes: 1000, maxBytes: 1_000_000 });
    for (let s = 0; s < 5; s += 1) tiny.release(tiny.put(original(`o${s}`), image(400))!);
    assert.ok(tiny.size().largeBytes <= 1000);
    assert.equal(tiny.peek(original('o0')), undefined, 'the oldest original went');
});

/**
 * Review L1: a remount's first render showed a URL nobody held (`peek`); another row's `put` before
 * the effect could revoke it under the <img>. `pin` holds it until the element's effect takes it,
 * and lets go by itself if no effect ever comes (a render React threw away).
 */
test('a_cover_on_a_first_render_is_not_revoked_before_its_effect_holds_it', async () => {
    const m = (await load()) as unknown as null | {
        ImageMemoryCache: new (limits?: Limits) => Cache & {
            holdCount: () => number;
            pin: (key: string) => undefined | { unpin: () => void; url: string };
        };
    };
    assert.ok(m, 'no memory cache');
    const image = () => new Blob([Buffer.alloc(10, 1)], { type: 'image/jpeg' });
    const cache = new m.ImageMemoryCache({ maxEntries: 2, pinMs: 30 });
    assert.equal(typeof cache.pin, 'function', 'no pin: the first render holds nothing');
    const onScreen = cache.put('x', image())!;
    const shownBefore = cache.put('a', image())!;
    cache.release(shownBefore);
    const pinned = cache.pin('a')!; // the remount's first render: <img src=pinned.url>
    assert.equal(pinned.url, shownBefore);
    cache.release(cache.put('y', image())!); // another row's fetch lands before the effect
    assert.ok(alive(pinned.url), 'pinned: not revoked under the first render');
    const taken = cache.take('a');
    assert.equal(taken, pinned.url, 'the effect takes the same cover');
    pinned.unpin();
    pinned.unpin(); // idempotent
    cache.release(taken!);
    cache.release(onScreen);
    // A render thrown away: nobody takes it, and the pin lets go by itself.
    cache.release(cache.put('b', image())!);
    const orphan = cache.pin('b')!;
    assert.equal(cache.holdCount(), 1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(cache.holdCount(), 0, 'an orphaned pin lets go');
    assert.ok(orphan.url);
});

/**
 * Review L3: a row that left mid-fetch rejected its caller, while the sent request ran to its end
 * (B-412's rule) and its bytes were dropped; scroll-back asked again. A late image is kept.
 */
test('a_request_that_ends_after_its_row_left_is_kept', async () => {
    let asked = 0;
    const server = createServer((_req, res) => {
        asked += 1;
        setTimeout(() => {
            res.setHeader('Cache-Control', 'public, no-cache');
            res.setHeader('Content-Type', 'image/jpeg');
            res.end(JPEG);
        }, 150);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        const m = await load();
        assert.ok(m, 'no memory cache');
        const cache = new m.ImageMemoryCache();
        const request = cover(`http://127.0.0.1:${port}`, 'G07', 'late');
        const row = new AbortController();
        const pending = m.loadCachedImage(request, { signal: row.signal }, {}, cache);
        setTimeout(() => row.abort(), 40); // the row scrolls away while the cover is in flight
        await assert.rejects(pending);
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.ok(cache.peek(request.cacheKey), 'the late image is kept');
        const again = await m.loadCachedImage(request, {}, {}, cache);
        assert.equal(asked, 1, 'scroll-back asks nothing');
        cache.release(again);
    } finally {
        server.close();
    }
});

/**
 * Review M2: a cover changed from inside the app (lb-bot's album override "cover only", an override,
 * an undo) kept its old image all session. Navidrome 0.64.2 answers a cover `Cache-Control: public,
 * no-cache` with an ETag that carries the album's update time (measured on the VM's stand-in), so
 * before the memory cache every remount revalidated and picked the new one up. `forgetItems` drops
 * every size of the named items, tells the elements showing them, and a fetch that was in flight
 * when they were forgotten is shown but not kept.
 */
test('a_changed_cover_is_forgotten_at_every_size', async () => {
    const m = (await load()) as unknown as null | {
        ImageMemoryCache: new (limits?: Limits) => Cache & {
            forgetItems: (ids: Iterable<string>) => void;
            holdCount: () => number;
            onForget: (listener: (ids: ReadonlySet<string>) => void) => () => void;
        };
        loadCachedImage: Module['loadCachedImage'];
    };
    assert.ok(m, 'no memory cache');
    const cache = new m.ImageMemoryCache();
    assert.equal(typeof cache.forgetItems, 'function', 'nothing forgets a changed cover');
    const image = () => new Blob([Buffer.alloc(10, 1)], { type: 'image/jpeg' });
    const key = (id: string, size: number | string) =>
        ['subsonic', 'srv', 'http://nd:4533', id, size].join(':');
    const held = cache.put(key('AL1', 300), image())!;
    for (const k of [key('AL1', 80), key('AL1', ''), key('SONG1', 80), key('AL2', 80)]) {
        cache.release(cache.put(k, image())!);
    }
    const heard: string[][] = [];
    const stop = cache.onForget((ids) => heard.push([...ids]));
    cache.forgetItems(['AL1', 'SONG1']);
    stop();
    for (const k of [key('AL1', 80), key('AL1', ''), key('AL1', 300), key('SONG1', 80)]) {
        assert.equal(cache.peek(k), undefined, `${k} forgotten`);
    }
    assert.ok(cache.peek(key('AL2', 80)), 'another album is kept');
    assert.deepEqual(heard, [['AL1', 'SONG1']], 'the elements are told');
    assert.ok(alive(held), 'still on screen: not revoked under its element');
    cache.release(held);
    assert.ok(!alive(held));

    // In flight when forgotten: shown, not kept (it may be the old cover).
    let answer: (() => void) | undefined;
    const server = createServer((_req, res) => {
        answer = () => {
            res.setHeader('Content-Type', 'image/jpeg');
            res.end(JPEG);
        };
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        const request = cover(`http://127.0.0.1:${port}`, 'AL3', 'x');
        const pending = m.loadCachedImage(request, {}, {}, cache);
        while (!answer) await new Promise((resolve) => setTimeout(resolve, 5));
        cache.forgetItems(['AL3']);
        answer();
        const url = await pending;
        assert.ok(alive(url), 'shown');
        assert.equal(cache.peek(request.cacheKey), undefined, 'not kept');
        cache.release(url);
        assert.ok(!alive(url));
        assert.equal(cache.holdCount(), 0);
    } finally {
        server.close();
    }
});

/**
 * M2's callers: the album override dialog's cover-only save, the end of an override or undo job
 * (from the dialog or Library Matches), and the `library` frame lb-bot sends once Navidrome has
 * rescanned the album (`albumIndexed` with its id).
 */
test('a_cover_changed_in_the_app_is_forgotten_where_it_changes', () => {
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    const modal = read('../../../renderer/features/lbbot/components/album-match-modal.tsx');
    const save = modal.slice(modal.indexOf('const saveCoverOnly'), modal.indexOf('const undo'));
    assert.match(save, /forgetAlbumCovers\(\[albumId\]\)/, 'the cover-only save');
    assert.match(
        read('../../../renderer/features/lbbot/utils/leave-album.ts'),
        /forgetAlbumCovers\(/,
        'the end of an override or undo job',
    );
    const lbbot = read('../../../renderer/features/lbbot/hooks/use-lbbot.ts');
    const refresh = lbbot.slice(lbbot.indexOf('export const useLbBotLibraryRefresh'));
    assert.match(refresh, /forgetAlbumCovers\(ids\)/, "the library frame's albums");
});

/**
 * B-428: on Navidrome a cover's id now carries its version (`<id>&_=<imageHash>`), and Navidrome
 * answers the CURRENT versioned id `public, max-age=31536000, immutable` (measured 2026-11-13).
 * So once a version is old, Chromium's HTTP cache answers its URL from disk without asking. A cover
 * forgotten from inside the app (`forgetAlbumCovers`) is asked again under the id the app holds,
 * which can still be the old version (the play queue's songs, a list not yet refetched): that first
 * ask after a forget must revalidate (`cache: 'no-cache'`), or it gets the old image back.
 */
test('b428_the_first_ask_after_a_forget_revalidates_each_size_once', async () => {
    const m = await load();
    assert.ok(m);
    const asked: (RequestCache | undefined)[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        asked.push(init?.cache);
        return new Response(
            new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }),
            {
                headers: { 'content-type': 'image/jpeg' },
            },
        );
    }) as typeof fetch;
    try {
        const cache = new m.ImageMemoryCache() as Cache & {
            forgetItems: (ids: Iterable<string>) => void;
        };
        const id = 'AL1&_=e59f1a9d92c7d2c8';
        const at = (size: number) => ({
            cacheKey: ['subsonic', 'server-1', 'http://nd:4533', id, size].join(':'),
            url: `http://nd:4533/rest/getCoverArt.view?id=${encodeURIComponent(id)}&size=${size}`,
        });
        cache.release(await m.loadCachedImage(at(80), {}, {}, cache));
        assert.deepEqual(asked, [undefined], 'a first ask is an ordinary one');
        cache.forgetItems([id]);
        cache.release(await m.loadCachedImage(at(80), {}, {}, cache));
        assert.equal(asked[1], 'no-cache', 'the ask after the forget revalidates');
        cache.release(await m.loadCachedImage(at(300), {}, {}, cache));
        assert.equal(asked[2], 'no-cache', 'another size of it too');
        cache.forget(at(80).cacheKey);
        cache.release(await m.loadCachedImage(at(80), {}, {}, cache));
        assert.equal(asked[3], undefined, 'once: revalidated since the forget');
        const other = {
            cacheKey: ['subsonic', 'server-1', 'http://nd:4533', 'AL2', 80].join(':'),
            url: 'http://nd:4533/rest/getCoverArt.view?id=AL2&size=80',
        };
        cache.release(await m.loadCachedImage(other, {}, {}, cache));
        assert.equal(asked[4], undefined, 'a cover nobody forgot is not revalidated');
    } finally {
        globalThis.fetch = realFetch;
    }
});
