import { del, get, set } from 'idb-keyval';

import { createThrottledPersister } from '/@/renderer/lib/query-persister';

/** The app's react-query snapshot, IndexedDB key `feishin` (`main.tsx`'s provider). */
export const indexedDbPersister = createThrottledPersister({ del, get, set }, 'feishin');

/** Write the pending snapshot now (an account change: re-review N5). */
export const flushQueryPersister = (): void => indexedDbPersister.flush();
