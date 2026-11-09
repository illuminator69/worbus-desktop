/**
 * The codecs this renderer plays itself, as Navidrome's `getTranscodeDecision` wants them, and the
 * transcoding profiles offered when it cannot. Out of `audio-players.tsx` so a harness can load it
 * (B-342).
 */
const CODEC_PROBES = [
    { codec: 'mp3', container: 'mp3', mime: 'audio/mpeg' },

    { codec: 'aac', container: 'mp4', mime: 'audio/mp4; codecs="mp4a.40.2"' },
    { codec: 'aac', container: 'aac', mime: 'audio/aac' },
    { codec: 'aac', container: 'mp4', mime: 'audio/x-m4a' },

    { codec: 'opus', container: 'ogg', mime: 'audio/ogg; codecs="opus"' },
    { codec: 'opus', container: 'webm', mime: 'audio/webm; codecs="opus"' },

    { codec: 'vorbis', container: 'ogg', mime: 'audio/ogg; codecs="vorbis"' },
    { codec: 'vorbis', container: 'webm', mime: 'audio/webm; codecs="vorbis"' },

    { codec: 'flac', container: 'flac', mime: 'audio/flac' },

    { codec: ['pcm', 'wav'], container: 'wav', mime: 'audio/wav' },

    { codec: 'alac', container: 'mp4', mime: 'audio/mp4; codecs="alac"' },
];

const DEFAULT_TRANSCODING_PROFILES = [
    { audioCodec: 'flac', container: 'flac', protocol: 'http' },
    { audioCodec: 'opus', container: 'ogg', protocol: 'http' },
    { audioCodec: 'mp3', container: 'mp3', protocol: 'http' },
];

const SAFARI_TRANSCODING_PROFILES = [{ audioCodec: 'mp3', container: 'mp3', protocol: 'http' }];

export interface DirectPlayProfile {
    audioCodecs: string[];
    containers: string[];
    protocols: string[];
}

/** Filled on first use, once; null until then. */
let directPlayProfiles: DirectPlayProfile[] | null = null;

export function getDefaultTranscodingProfiles() {
    return isSafari() ? SAFARI_TRANSCODING_PROFILES : DEFAULT_TRANSCODING_PROFILES;
}

/**
 * B-342: probed here, on first use, not in a component's mount effect. The first caller at a fresh
 * start is the restored queue's stream URL, which the web player resolves from its own effects,
 * before its parent's mount effect could run; it then sent `directPlayProfiles: []` and Navidrome
 * transcoded (or, without ffmpeg, failed) the restored song. `canPlayType` is synchronous, so
 * nothing needs to wait. With no `Audio` (not a browser) the answer is `[]` and is not kept.
 */
export function getDirectPlayProfiles(): DirectPlayProfile[] {
    if (directPlayProfiles) return directPlayProfiles;
    if (typeof Audio === 'undefined') return [];
    directPlayProfiles = detectBrowserProfile(new Audio());
    return directPlayProfiles;
}

// Shamelessly taken from NavidromeUI
function detectBrowserProfile(audio: Pick<HTMLAudioElement, 'canPlayType'>) {
    const profiles: DirectPlayProfile[] = [];

    for (const { codec, container, mime } of CODEC_PROBES) {
        if (audio.canPlayType(mime) === 'maybe' || audio.canPlayType(mime) === 'probably') {
            profiles.push({
                audioCodecs: Array.isArray(codec) ? codec : [codec],
                containers: [container],
                protocols: ['http'],
            });
        }
    }

    return profiles;
}

function isSafari() {
    const ua = navigator.userAgent;
    return ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Chromium');
}
