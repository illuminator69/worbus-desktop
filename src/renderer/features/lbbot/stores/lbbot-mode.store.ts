import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { currentServerKey, useServerKey } from '/@/renderer/features/hub/utils/current-server-key';
import {
    LbDownloads,
    LbMode,
    modeFromFrame,
    rekeyMode,
    rememberMode,
} from '/@/shared/utils/lbbot-mode';

/**
 * Worbus P1: lb-bot's downloads mode for this connection, and the last known one per hub.
 *
 * `session` is what this connection has learned (null until the first `welcome`, and again
 * after the hub is switched); until then the mode is the one remembered for the configured hub
 * URL, so a server known to be "off" does not flash its download buttons at every start. The
 * rules themselves are pure (`lbbot-mode.ts`). Its own storage key: nothing else migrates.
 */
interface LbBotModeState {
    actions: {
        /**
         * Adopt a mode worked out by the pure rules: a welcome's (`stateAfterWelcome`) or a
         * refusal's (`stateAfterRefusal`, via `applyLbBotRefusal`).
         */
        adopt: (mode: LbMode) => void;
        /** An `lb` frame or a `/lb/status` read: only a valid `downloads` moves the mode. */
        applyFrame: (frame: unknown) => void;
        /** The hub was switched off or pointed elsewhere: back to the remembered mode. */
        forgetSession: () => void;
        /** P3: the first welcome with the server's id - copy the address's mode to the id. */
        rekey: (from: string, to: string) => void;
    };
    /**
     * The last `on` / `off` each hub said (at most four), keyed by the server key (P3: the id
     * once known, else the configured URL as before).
     */
    byHub: Record<string, LbDownloads>;
    /** `byHub`'s keys, oldest first. */
    order: string[];
    session: LbMode | null;
}

export const useLbBotModeStore = create<LbBotModeState>()(
    persist(
        (set, get) => {
            const setMode = (mode: LbMode) => {
                const { byHub, order } = get();
                const remembered = rememberMode(byHub, order, currentServerKey(), mode);
                set({ byHub: remembered.map, order: remembered.order, session: mode });
            };
            return {
                actions: {
                    adopt: setMode,
                    applyFrame: (frame) => setMode(modeFromFrame(getLbBotMode(), frame)),
                    forgetSession: () => set({ session: null }),
                    rekey: (from, to) => {
                        const { byHub, order } = get();
                        const moved = rekeyMode(byHub, order, from, to);
                        set({ byHub: moved.map, order: moved.order });
                    },
                },
                byHub: {},
                order: [],
                session: null,
            };
        },
        {
            name: 'store_lbbot_mode',
            partialize: (state) => ({ byHub: state.byHub, order: state.order }),
            version: 1,
        },
    ),
);

const modeOf = (state: LbBotModeState, url: string): LbMode =>
    state.session ?? state.byHub[url] ?? 'unknown';

/** The mode now, outside React. */
export const getLbBotMode = (): LbMode => modeOf(useLbBotModeStore.getState(), currentServerKey());

/** The mode, re-rendering when it (or the configured hub) changes. */
export const useLbBotModeValue = (): LbMode => {
    const key = useServerKey();
    return useLbBotModeStore((state) => modeOf(state, key));
};

export const lbBotModeActions = () => useLbBotModeStore.getState().actions;
