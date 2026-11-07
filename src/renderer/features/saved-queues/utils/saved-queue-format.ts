import { SavedQueue, SavedQueueKind } from '/@/renderer/store/saved-queues.store';

// navi-connect: shared display helpers for saved queues, used by both the home "Continue Listening"
// carousel and the full-screen Saved Queues management view. Worbus for Android renders the same records from the
// same rules (see its SavedQueueFormat.kt) — keep the two in step.

export const SAVED_QUEUE_KIND_LABEL: Record<SavedQueueKind, string> = {
    album: 'Album',
    journey: 'Journey',
    manual: 'Queue',
    moodFlow: 'Mood Flow',
    playlist: 'Playlist',
    radio: 'Radio',
};

export const trackCount = (n: number): string => `${n} track${n === 1 ? '' : 's'}`;

/**
 * Names of the shape "Queue · 12 tracks" that older builds SYNTHESIZED and then stored as a real
 * `sourceName`. They go stale the moment the queue is edited (a record titled "12 tracks" listing
 * 19), and they duplicate the subtitle verbatim. Nothing writes them any more; this hides the ones
 * already in the history — and on the hub, where they'd otherwise outlive both clients.
 */
const SYNTHESIZED_NAME = /^(Album|Journey|Mood Flow|Playlist|Queue|Radio) · \d+ (songs?|tracks?)$/;

export const realSourceName = (entry: SavedQueue): string | undefined => {
    const name = entry.sourceName?.trim();
    if (!name || SYNTHESIZED_NAME.test(name)) return undefined;
    return name;
};

/**
 * Best display title: the user's own name if they set one, else **the track that will actually play
 * when this queue is restored**.
 *
 * That last part is a deliberate reversal. Titling by origin was stable but unhelpful — half the
 * history read "Queue · 12 tracks" or the name of an album you'd long since played past, and the
 * cards gave no clue what pressing them would do. The origin is still shown, on the third line.
 */
export const savedQueueTitle = (entry: SavedQueue): string =>
    entry.name ||
    entry.currentSongName ||
    entry.songs[entry.currentIndex]?.name ||
    realSourceName(entry) ||
    `${SAVED_QUEUE_KIND_LABEL[entry.sourceKind] ?? 'Queue'} · ${trackCount(entry.songCount)}`;

/** Second line: what kind of queue this is and how big, prefixed with the live marker. */
export const savedQueueSubtitle = (entry: SavedQueue, isActive: boolean): string =>
    [
        isActive ? 'Now Playing' : null,
        SAVED_QUEUE_KIND_LABEL[entry.sourceKind] ?? 'Queue',
        trackCount(entry.songCount),
    ]
        .filter(Boolean)
        .join(' · ');

/** Third line: where the queue came from, when that isn't already the title. */
export const savedQueueSourceLine = (entry: SavedQueue): string => {
    const source = realSourceName(entry);
    if (!source || source === savedQueueTitle(entry)) return '';
    return `from ${source}`;
};

/**
 * The song whose artwork represents this queue: the one it will resume on. Rendered by id, with this
 * client's own credentials — a peer's `coverImageUrl` points at ITS server URL with ITS auth, which
 * is why cross-client cards showed a broken-image placeholder.
 */
export const savedQueueCoverSongId = (entry: SavedQueue): string | undefined =>
    entry.currentSongId ?? entry.songs[entry.currentIndex]?.id ?? entry.songs[0]?.id;

/** Total runtime of a saved queue, as `h:mm:ss` / `m:ss`. */
export const savedQueueDuration = (entry: SavedQueue): string => {
    const total = Math.round(
        entry.songs.reduce((sum, song) => sum + (song.duration ?? 0), 0) / 1000,
    );
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    const pad = (n: number) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
};
