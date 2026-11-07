import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createRoot } from 'react-dom/client';

import { App } from '/@/renderer/app';
import { shouldPersistLbBotQuery } from '/@/renderer/features/lbbot/utils/persisted-queries';
// The throttled IndexedDB persister (Q-010), in its own module so an account change can flush it.
import { indexedDbPersister } from '/@/renderer/lib/app-query-persister';
import { queryClient } from '/@/renderer/lib/react-query';

createRoot(document.getElementById('root')!).render(
    <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
            buster: 'feishin',
            dehydrateOptions: {
                shouldDehydrateQuery: (query) => {
                    const isSuccess = query.state.status === 'success';
                    const isLyricsQueryKey =
                        query.queryKey.includes('song') &&
                        query.queryKey.includes('lyrics') &&
                        query.queryKey.includes('select');

                    // navi-connect: lb-bot's slow-moving reads (meta, editions,
                    // tracklists, Fresh, Deezer) too, each bounded by age.
                    return (isSuccess && isLyricsQueryKey) || shouldPersistLbBotQuery(query);
                },
            },
            hydrateOptions: {
                defaultOptions: {
                    queries: {
                        gcTime: Infinity,
                    },
                },
            },
            maxAge: Infinity,
            persister: indexedDbPersister,
        }}
    >
        <App />
    </PersistQueryClientProvider>,
);
