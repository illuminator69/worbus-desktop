/**
 * The codecs this renderer plays itself, as Navidrome's `getTranscodeDecision` wants them, and the
 * transcoding profiles offered when it cannot. Moved out of `audio-players.tsx` unchanged so a
 * harness can load it (B-342).
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

const DIRECT_PLAY_PROFILES: DirectPlayProfile[] = [];

export function getDefaultTranscodingProfiles() {
    return isSafari() ? SAFARI_TRANSCODING_PROFILES : DEFAULT_TRANSCODING_PROFILES;
}

export function getDirectPlayProfiles() {
    return DIRECT_PLAY_PROFILES;
}

// Shamelessly taken from NavidromeUI
export function detectBrowserProfile() {
    const audio = new Audio();

    for (const { codec, container, mime } of CODEC_PROBES) {
        if (audio.canPlayType(mime) === 'maybe' || audio.canPlayType(mime) === 'probably') {
            DIRECT_PLAY_PROFILES.push({
                audioCodecs: Array.isArray(codec) ? codec : [codec],
                containers: [container],
                protocols: ['http'],
            });
        }
    }

    return DIRECT_PLAY_PROFILES;
}

function isSafari() {
    const ua = navigator.userAgent;
    return ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Chromium');
}
