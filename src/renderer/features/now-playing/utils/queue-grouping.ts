// Pure: the side queue's groups by who put each row there. No `/@/` import, no store, no React,
// so the harness can load it with `node --test`.

export interface QueueGroup {
    count: number;
    kind: QueueGroupKind;
}

export type QueueGroupKind = 'autoplay' | 'earlier' | 'next' | 'playing' | 'queued';

export interface QueueRowInfo {
    stationAdded: boolean;
}

// The playing row is found by its unique key in the displayed rows, never by `player.index`
// (a position in the shuffled order while shuffle is on).
export function playingIndexOf(keys: readonly string[], activeKey: string | undefined): number {
    if (activeKey === undefined) return -1;
    return keys.indexOf(activeKey);
}

// The groups are consecutive runs whose counts sum to `rows.length`. Rows above the playing one
// are `earlier`; after it, flagged rows are `autoplay` and the others are `queued` when an
// autoplay row follows the playing one anywhere, else they are all one `next`.
export function queueGroups(rows: readonly QueueRowInfo[], playingIndex: number): QueueGroup[] {
    if (rows.length === 0) return [];
    if (playingIndex < 0 || playingIndex >= rows.length) {
        return [{ count: rows.length, kind: 'next' }];
    }

    const groups: QueueGroup[] = [];
    const push = (kind: QueueGroupKind) => {
        const last = groups[groups.length - 1];
        if (last && last.kind === kind) last.count += 1;
        else groups.push({ count: 1, kind });
    };

    const after = rows.slice(playingIndex + 1);
    const hasAutoplay = after.some((r) => r.stationAdded);

    for (let i = 0; i < playingIndex; i++) push('earlier');
    groups.push({ count: 1, kind: 'playing' });
    for (const row of after) {
        push(!hasAutoplay ? 'next' : row.stationAdded ? 'autoplay' : 'queued');
    }
    return groups;
}

// Rounded to the nearest minute (a half rounds up); a negative, NaN or infinite input is 0.
export function queueLength(totalMs: number): { hours: number; minutes: number } {
    if (!Number.isFinite(totalMs) || totalMs < 0) return { hours: 0, minutes: 0 };
    const total = Math.round(totalMs / 60_000);
    return { hours: Math.floor(total / 60), minutes: total % 60 };
}
