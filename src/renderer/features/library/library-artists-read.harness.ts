import { QueryClient, QueryObserver } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    LIBRARY_FRESH_MS,
    type LibraryArtistsData,
    libraryArtistsStaleTime,
    readLibraryArtists,
} from './library-artists-read.ts';

type Row = { id: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A server of `total` artists answering a page every `ms`, aborting with the query's signal.
const server = (total: number, ms = 20) => {
    const seen = { requests: 0 };
    const fetchPage = (startIndex: number, limit: number, signal?: AbortSignal) =>
        new Promise<{ items: Row[]; totalRecordCount: number }>((resolve, reject) => {
            seen.requests++;
            const timer = setTimeout(
                () =>
                    resolve({
                        items: Array.from(
                            { length: Math.max(0, Math.min(limit, total - startIndex)) },
                            (_, i) => ({ id: `a${startIndex + i}` }),
                        ),
                        totalRecordCount: total,
                    }),
                ms,
            );
            signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
            });
        });
    return { fetchPage, seen };
};

// The hook's query, as `use-library-artists.ts` builds it.
const options = (client: QueryClient, fetchPage: ReturnType<typeof server>['fetchPage']) => {
    const queryKey = ['srv', 'albumArtists', 'list', 'library-all', null];
    return {
        gcTime: 30 * 60 * 1000,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
            const firstRead = client.getQueryData(queryKey) === undefined;
            return readLibraryArtists<Row>({
                fetchPage: (start, limit) => fetchPage(start, limit, signal),
                onPage: firstRead ? (soFar) => client.setQueryData(queryKey, soFar) : undefined,
            });
        },
        queryKey,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: (query: { state: { data?: LibraryArtistsData<Row> } }) =>
            libraryArtistsStaleTime(query.state.data),
    };
};

test('readsEveryPageAndShowsTheFirstReadAsItArrives', async () => {
    const { fetchPage, seen } = server(1200, 0);
    const shown: number[] = [];
    const data = await readLibraryArtists<Row>({
        fetchPage,
        onPage: (soFar) => shown.push(soFar.items.length),
    });
    assert.equal(data.items.length, 1200);
    assert.equal(data.partial, undefined);
    assert.equal(data.capped, undefined);
    assert.deepEqual(shown, [500, 1000]);
    assert.equal(seen.requests, 3);
});

test('stopsAtTheLimitAndSaysSo', async () => {
    const { fetchPage } = server(2600, 0);
    const data = await readLibraryArtists<Row>({ fetchPage, max: 1500 });
    assert.equal(data.items.length, 1500);
    assert.equal(data.capped, true);
    // A library exactly at the limit is whole, not capped.
    const exact = await readLibraryArtists<Row>({
        fetchPage: server(1500, 0).fetchPage,
        max: 1500,
    });
    assert.equal(exact.capped, undefined);
});

test('aWholeListStaysFreshAPartialOneNever', () => {
    assert.equal(libraryArtistsStaleTime({ partial: true }), 0);
    assert.equal(libraryArtistsStaleTime({}), LIBRARY_FRESH_MS);
    assert.equal(libraryArtistsStaleTime(undefined), LIBRARY_FRESH_MS);
});

test('leavingDuringTheFirstReadDoesNotLeaveAPartialListAsTheLibrary', async () => {
    // Review finding: the page left after two of six pages; the cancelled read reverted to its last
    // manual write (1,000 rows, partial) as a fresh success, and a return within 10 minutes read nothing.
    const client = new QueryClient();
    const { fetchPage, seen } = server(3000);
    const first = new QueryObserver(client, options(client, fetchPage) as never);
    const leave = first.subscribe(() => {});
    await sleep(55);
    leave();
    await sleep(60);

    const before = seen.requests;
    const second = new QueryObserver(client, options(client, fetchPage) as never);
    const stop = second.subscribe(() => {});
    await sleep(400);
    const result = second.getCurrentResult() as { data?: LibraryArtistsData<Row> };
    stop();
    client.clear();

    assert.ok(seen.requests > before, 'coming back reads the library again');
    assert.equal(result.data?.items.length, 3000);
    assert.equal(result.data?.partial, undefined);
});
