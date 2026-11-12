/**
 * Fix round 4 (2026-11-12): whether the QUEUE plays on this device, as the hub is told it
 * (`queue-playing.harness.ts`). An internet radio station drives the same player status (the
 * radio store calls `mediaPlay`/`mediaPause`), but it is not the queue: the session's `isPlaying`,
 * `report`, `setQueue … play` and the routing of a local play are the queue's. While a station is
 * active, the queue is paused as far as the hub knows. Pure and import-free (`status` is the
 * player store's `PlayerStatus`, a string).
 */
export const queuePlaysHere = (status: string, radioActive: boolean): boolean =>
    status === 'playing' && !radioActive;
