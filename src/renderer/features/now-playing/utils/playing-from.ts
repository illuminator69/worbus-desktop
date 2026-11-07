// Pure: what the side queue's header says the queue is playing from. No English here; the
// component builds the sentences with `t()`. No `/@/` import, no store, no React.

export interface PlayingFrom {
    device: null | string;
    kind: null | PlayingFromKind;
    state: PlayingFromState;
    title: null | string;
}

export interface PlayingFromInput {
    autoplay: boolean;
    device: null | string;
    engine: boolean;
    kind: null | string;
    name: null | string;
    sourceName: null | string;
    stationName: null | string;
    stationState: 'absent' | 'bound' | 'stopped';
}

export type PlayingFromKind = 'album' | 'journey' | 'moodFlow' | 'playlist' | 'radio';

export type PlayingFromState = 'autoDj' | 'continues' | 'off' | 'running' | 'stopped';

const KINDS: readonly string[] = ['album', 'journey', 'moodFlow', 'playlist', 'radio'];

const text = (value: null | string): null | string => (value?.trim() ? value : null);

/** The line under the header's title: the device that plays the queue, or else its kind. */
export type PlayingFromLine = null | { device: string } | { kind: PlayingFromKind };

export function playingFrom(input: PlayingFromInput): PlayingFrom {
    const kind = KINDS.includes(input.kind ?? '') ? (input.kind as PlayingFromKind) : null;

    // The user's name wins; a radio prefers the hub's station name over its seed's name.
    const title =
        text(input.name) ??
        (input.kind === 'radio' ? text(input.stationName) : null) ??
        text(input.sourceName);

    let state: PlayingFromState;
    if (!input.engine) state = input.autoplay ? 'autoDj' : 'off';
    else if (input.stationState === 'stopped') state = 'stopped';
    else if (input.stationState === 'bound') state = kind === 'radio' ? 'running' : 'continues';
    else state = input.autoplay ? 'continues' : 'off';

    return { device: input.device, kind, state, title };
}

/**
 * What the queue IS, never the autoplay state (B-251): the Autoplay switch beside the title says
 * on / off, so the line exists for a queue or does not, and the switch never adds or removes it.
 * The character shows in the characters row, a bound station in its own line.
 */
export function playingFromLine(from: PlayingFrom): PlayingFromLine {
    if (from.device) return { device: from.device };
    return from.kind ? { kind: from.kind } : null;
}
