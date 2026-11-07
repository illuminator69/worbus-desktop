declare module 'castv2-client' {
    export interface CastSession {
        appId?: string;
        displayName?: string;
        sessionId?: string;
        statusText?: string;
        transportId?: string;
    }

    export class Client {
        close(): void;
        connect(host: string | { host: string; port?: number }, callback: () => void): void;
        getSessions(callback: (err: Error | null, sessions: CastSession[]) => void): void;
        // The receiver's own view of itself (volume, running applications). Diagnostic
        // only — logReceiverState reads it instead of reasoning about the device's state,
        // which is how three separate theories about the LAUNCH refusal went wrong.
        getStatus(callback: (err: Error | null, status: unknown) => void): void;
        join(
            session: CastSession,
            app: unknown,
            callback: (err: Error | null, player: CastPlayer) => void,
        ): void;
        launch(app: unknown, callback: (err: Error | null, player: CastPlayer) => void): void;
        // 'close' fires when the device drops the connection — an idle timeout, another
        // sender taking the receiver over, or the speaker leaving the network.
        on(event: 'close', listener: () => void): void;
        on(event: 'error', listener: (err: Error) => void): void;
        // 'status' fires for every RECEIVER_STATUS the device broadcasts to its senders: its
        // volume changed (from anywhere), or an application started or stopped.
        // `applications` lists the receiver apps running, each with its `sessionId` (Worbus P2:
        // the bridge's own app session missing from it means another sender took the speaker).
        on(
            event: 'status',
            listener: (status?: { applications?: CastSession[]; volume?: unknown }) => void,
        ): void;
        // The callback's second argument is `status.volume` of the RECEIVER_STATUS that
        // answered: the volume the receiver is at after the command.
        setVolume(
            volume: { level?: number; muted?: boolean },
            callback?: (err: Error | null, volume?: unknown) => void,
        ): void;
    }

    export interface CastMediaStatus {
        currentTime?: number;
        idleReason?: string;
        media?: { contentId?: string; duration?: number };
        // Which media session the status is about; a LOAD from any sender starts a new one.
        mediaSessionId?: number;
        playerState?: string;
    }

    export interface CastPlayer {
        getStatus(callback: (err: Error | null, status: CastMediaStatus | null) => void): void;
        load(
            media: unknown,
            options: { autoplay?: boolean; currentTime?: number },
            callback: (err: Error | null, status?: CastMediaStatus) => void,
        ): void;
        on(event: 'status', listener: (status: CastMediaStatus) => void): void;
        pause(callback?: (err: Error | null) => void): void;
        play(callback?: (err: Error | null) => void): void;
        seek(currentTime: number, callback?: (err: Error | null) => void): void;
        stop(callback?: (err: Error | null) => void): void;
    }

    export const DefaultMediaReceiver: unknown;
}
