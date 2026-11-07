import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { api } from '/@/renderer/api';
import {
    type LibraryArtistsData,
    libraryArtistsStaleTime,
    readLibraryArtists,
} from '/@/renderer/features/library/library-artists-read';
import { useCurrentServer } from '/@/renderer/store';
import { AlbumArtist, AlbumArtistListSort, SortOrder } from '/@/shared/types/domain-types';

type LibraryArtists = LibraryArtistsData<AlbumArtist>;

export const libraryArtistsKey = (serverId: string, musicFolderId: null | string | string[]) =>
    [serverId, 'albumArtists', 'list', 'library-all', musicFolderId] as const;

/**
 * F6: every album artist in the library (Call 3): Navidrome's search is substring-only, so the
 * Library field narrows a list held here. Read in pages of 500 (at most 20,000 rows), sorted by
 * name, in the persisted music folder. On the first read each page is shown as it arrives; a refetch
 * (the lb-bot library refresh, an artist image change) keeps the old list on screen until the new one
 * is whole. Cached 10 minutes under the `albumArtists` list family, so the refresh drops it.
 */
export const useLibraryArtists = (): {
    artists: AlbumArtist[];
    /** The list stopped at the row limit before the server's total. */
    capped: boolean;
    error: boolean;
    loadedAll: boolean;
    loading: boolean;
    refetch: () => void;
    total: number | undefined;
} => {
    const server = useCurrentServer();
    const serverId = server?.id ?? '';
    const musicFolderId = server?.musicFolderId?.length ? server.musicFolderId : null;
    const queryClient = useQueryClient();
    const queryKey = useMemo(
        () => libraryArtistsKey(serverId, musicFolderId),
        [serverId, musicFolderId],
    );

    const query = useQuery<LibraryArtists>({
        enabled: !!serverId,
        gcTime: 30 * 60 * 1000,
        queryFn: async ({ signal }) => {
            const firstRead = queryClient.getQueryData(queryKey) === undefined;
            return readLibraryArtists<AlbumArtist>({
                fetchPage: async (startIndex, limit) =>
                    api.controller.getAlbumArtistList({
                        apiClientProps: { serverId, signal },
                        query: {
                            limit,
                            sortBy: AlbumArtistListSort.NAME,
                            sortOrder: SortOrder.ASC,
                            startIndex,
                        },
                    }),
                onPage: firstRead
                    ? (soFar) => queryClient.setQueryData<LibraryArtists>(queryKey, soFar)
                    : undefined,
            });
        },
        queryKey,
        refetchOnWindowFocus: false,
        retry: false,
        // A partial list (a first read abandoned when the page was left) is read again on the next visit.
        staleTime: (q) => libraryArtistsStaleTime(q.state.data),
        throwOnError: false,
    });

    const data = query.data;
    const { refetch: refetchQuery } = query;
    const refetch = useCallback(() => void refetchQuery(), [refetchQuery]);

    return {
        artists: data?.items ?? EMPTY,
        capped: !!data?.capped,
        error: query.isError,
        loadedAll: !!data && !data.partial,
        loading: !data && query.isFetching,
        refetch,
        total: data?.totalRecordCount ?? undefined,
    };
};

const EMPTY: AlbumArtist[] = [];
