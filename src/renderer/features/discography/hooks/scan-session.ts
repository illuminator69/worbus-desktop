import { useSyncExternalStore } from 'react';

/**
 * The scans this session started, by artist (Call 13): the task id lb-bot answered and when. Kept at
 * module level so leaving the page and coming back still knows a scan is running, and written by
 * `useIndexArtist` so a scan started from the MusicBrainz picker counts too. Not persisted: after a
 * restart only lb-bot's own record (read through the hub's 60 s cache) says a scan is running.
 */
type Started = { atMs: number; taskId: string };

const started = new Map<string, Started>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const noteScanStarted = (ndId: string, taskId: string) => {
    if (!ndId || !taskId) return;
    started.set(ndId, { atMs: Date.now(), taskId });
    emit();
};

export const clearScanStarted = (ndId: string) => {
    if (started.delete(ndId)) emit();
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const useStartedScan = (ndId: string): null | Started =>
    useSyncExternalStore(subscribe, () => started.get(ndId) ?? null);
