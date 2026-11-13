import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import test from 'node:test';

type Cache = {
    forgetItems: (ids: Iterable<string>) => void;
    holdCount: () => number;
    onForget: (listener: (ids: ReadonlySet<string>) => void) => () => void;
    peek: (key: string) => string | undefined;
};
type Core = {
    first: (request?: null | Request) => State;
    held: null | string;
    invalidated: (ids: ReadonlySet<string>) => boolean;
    onFetchError?: () => void;
    setState: (update: ((state: State) => State) | State) => void;
    unmount: () => void;
    update: (args: { enabled: boolean; request?: null | Request }) => (() => void) | void;
};
type Modules = {
    cache: {
        ImageMemoryCache: new (
            limits: { pinMs?: number },
            urls: { create: (blob: Blob) => string; revoke: (url: string) => void },
        ) => Cache;
    };
    core: { NativeImageCore: new (cache: Cache) => Core };
};
/**
 * Review L4 of `99477e450`:  node --test src/shared/components/image/native-image-core.harness.ts
 *
 * The risky part of the cover memory cache is the holds `useNativeImage` takes and gives back, and
 * the tests only matched source text. Its effect logic is `NativeImageCore` (the hook is the React
 * wrapper), driven here the way React drives it (first render, effect, the effect's cleanup before
 * the next one, unmount) against the real cache and `loadCachedImage`, a 127.0.0.1 stand-in that
 * answers when told, and object URLs that check, when one is revoked, that no element shows or
 * holds it. At the end every hold is back: the cache's hold count is 0.
 */
type Request = { cacheKey: string; url: string };
type State = { displaySrc?: string; status: string };

const load = async (): Promise<Modules | null> => {
    const core = await import('./native-image-core.ts').catch(() => null);
    const cache = await import('./image-memory-cache.ts').catch(() => null);
    return core && cache ? ({ cache, core } as unknown as Modules) : null;
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0x43, 0, 1, 2, 3, 0xff, 0xd9]);
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

const standIn = async () => {
    const waiting: ServerResponse[] = [];
    const asked = new Map<string, number>();
    const server = createServer((req, res) => {
        const id = new URL(req.url!, 'http://x').searchParams.get('id')!;
        asked.set(id, (asked.get(id) ?? 0) + 1);
        waiting.push(res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;
    return {
        /** Answers every request waiting, then lets the answers arrive. */
        answer: async () => {
            for (const res of waiting.splice(0)) {
                res.setHeader('Cache-Control', 'public, no-cache');
                res.setHeader('Content-Type', 'image/jpeg');
                res.end(JPEG);
            }
            await tick(60);
        },
        asked: (id: string) => asked.get(id) ?? 0,
        close: () => server.close(),
        request: (id: string, salt = 'a'): Request => ({
            cacheKey: ['subsonic', 'srv', '', id, 80].join(':'),
            url: `${base}/rest/getCoverArt.view?id=${id}&u=w&t=t${salt}&s=${salt}&size=80`,
        }),
        waiting: () => waiting.length,
    };
};

test('holds_return_to_zero_and_no_url_is_revoked_while_shown_or_held', async () => {
    const m = await load();
    assert.ok(m, 'no NativeImageCore: the hook cannot be driven outside React');
    const s = await standIn();
    const elements = new Set<{ core: Core; state: State }>();
    const violations: string[] = [];
    const cache = new m.cache.ImageMemoryCache(
        { pinMs: 40 },
        {
            create: (blob) => URL.createObjectURL(blob),
            revoke: (url) => {
                for (const element of elements) {
                    if (element.state.displaySrc === url || element.core.held === url) {
                        violations.push(url);
                    }
                }
                URL.revokeObjectURL(url);
            },
        },
    );
    // React's order: render (`first`), commit, the effect; the effect's cleanup before the next
    // run of it; on unmount the cleanup, then the unmount effect.
    const mount = (request: null | Request, enabled = true) => {
        const core = new m.core.NativeImageCore(cache);
        const element = {
            cleanup: undefined as (() => void) | undefined | void,
            core,
            effect: (next: null | Request = element.request, on = enabled) => {
                element.cleanup?.();
                element.request = next;
                element.cleanup = core.update({ enabled: on, request: next });
            },
            request,
            state: { status: 'idle' } as State,
            stopListening: () => {},
            unmount: () => {
                element.cleanup?.();
                core.unmount();
                element.stopListening();
                elements.delete(element);
            },
        };
        core.setState = (update) => {
            element.state = typeof update === 'function' ? update(element.state) : update;
        };
        element.state = core.first(request);
        elements.add(element);
        element.stopListening = cache.onForget((ids) => {
            if (core.invalidated(ids)) element.effect();
        });
        element.effect();
        return element;
    };
    const alive = (url?: string) => !!url && resolveObjectURL(url) !== undefined;

    try {
        // Mount: the cover loads.
        const a = mount(s.request('C1'));
        assert.equal(a.state.status, 'loading');
        await s.answer();
        assert.equal(a.state.status, 'loaded');
        const c1 = a.state.displaySrc!;
        assert.ok(alive(c1));

        // Request change: C2 loads, C1 is let go (kept in memory).
        a.effect(s.request('C2'));
        await s.answer();
        const c2 = a.state.displaySrc!;
        assert.notEqual(c2, c1);
        assert.ok(alive(c1), 'C1 stays in memory');

        // The same cover under a new salt: no request, the same URL.
        a.effect(s.request('C2', 'other-salt'));
        assert.equal(a.state.displaySrc, c2);
        assert.equal(s.asked('C2'), 1);

        // Abort: C3 in flight, then C4 asked before C3 answers.
        a.effect(s.request('C3'));
        await tick();
        a.effect(s.request('C4'));
        await tick();
        // Unmount mid-fetch.
        a.unmount();
        await s.answer();
        assert.ok(cache.peek(s.request('C3').cacheKey), 'C3 arrived after its row left: kept');
        assert.ok(cache.peek(s.request('C4').cacheKey), 'C4 arrived after unmount: kept');
        assert.equal(cache.holdCount(), 0, 'nothing is held after the unmount');

        // Remount on C1: on its first render, with no request, and held by the effect.
        const b = mount(s.request('C1'));
        assert.equal(b.state.displaySrc, c1, 'first render of the remount: the same image');
        assert.equal(s.asked('C1'), 1, 'the remount asked nothing');
        // Two elements on one cover.
        const c = mount(s.request('C1'));
        assert.equal(c.state.displaySrc, c1);
        b.unmount();
        assert.ok(alive(c1), 'still held by the other element');

        // A changed cover (M2): forgotten while shown; the element asks again and keeps the old
        // image on screen until the new one is there.
        cache.forgetItems(['C1']);
        assert.equal(s.waiting(), 1, 'the element showing it asked again');
        await s.answer();
        assert.equal(c.state.status, 'loaded');
        assert.notEqual(c.state.displaySrc, c1, 'a new URL for the new bytes');
        assert.ok(!alive(c1), 'the old one is freed once nothing shows it');

        // Disabled (off screen) and never loaded, then unmounted.
        const d = mount(s.request('C5'), false);
        assert.equal(d.state.status, 'idle');
        d.unmount();

        // A first render thrown away by React: rendered, never committed.
        new m.core.NativeImageCore(cache).first(s.request('C2'));

        c.unmount();
        await tick(80); // pins let go
        assert.equal(cache.holdCount(), 0, 'every hold is back');
        assert.deepEqual(violations, [], 'no URL was revoked while an element showed or held it');
    } finally {
        for (const element of [...elements]) element.unmount();
        s.close();
    }
});

test('the_hook_is_the_core_in_react', () => {
    const hook = readFileSync(new URL('./use-native-image.ts', import.meta.url), 'utf8');
    assert.match(hook, /new NativeImageCore\(/, 'useNativeImage runs NativeImageCore');
    assert.match(hook, /\.first\(request\)/, "the first render is the core's");
    assert.match(hook, /\.update\(/, "the effect is the core's");
    assert.match(hook, /\.unmount\(\)/);
    assert.match(hook, /onForget\(/, 'a changed cover reaches the element');
});
