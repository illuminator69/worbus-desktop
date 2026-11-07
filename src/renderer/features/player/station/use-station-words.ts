import type { StationCharacterId } from '/@/shared/types/station-types';

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { stationStatusKey } from '/@/renderer/features/player/station/station-chips';
import {
    characterLabel,
    charactersOf,
    StationBinding,
} from '/@/renderer/features/player/station/station-logic';
import {
    useStationBinding,
    useStationCatalog,
    useStationInFlight,
    useStationMode,
    useStationStore,
} from '/@/renderer/features/player/station/station-store';
import { useSettingsStore } from '/@/renderer/store/settings.store';

/**
 * Everything a surface says about autoplay and the station, in one place so the queue's chip
 * row, its "playing from" chip and the mix form cannot come to disagree (I-040, I-041). Every
 * sentence is built from what the hub answered (the station's name, character, engine,
 * exhaustion, stop) or from the catalogue it served; the bundled copy of that catalogue stands
 * in only when the hub has given none.
 */
export const useStationWords = () => {
    const { t } = useTranslation();
    const mode = useStationMode();
    const bound = useStationBinding();
    const catalog = useStationCatalog();
    const inFlight = useStationInFlight();
    const lastPartial = useStationStore((s) => s.lastPartial);
    const autoplay = useSettingsStore((s) => s.autoDJ.enabled);
    const preferred = useSettingsStore((s) => s.station?.character ?? 'balanced');

    const characters = useMemo(() => charactersOf(catalog), [catalog]);
    /** The character in effect: the bound station's own, else the one a new station starts with. */
    const character: StationCharacterId = bound?.character ?? preferred;

    const labelOf = useCallback((id: StationCharacterId) => characterLabel(catalog, id), [catalog]);

    const stationName = useCallback(
        (b: StationBinding): string => {
            if (b.name) return b.name;
            if (b.seed?.kind === 'yourMix') return t('naviConnect.station.yourMix');
            if (b.seed?.name) return t('naviConnect.station.radioOf', { name: b.seed.name });
            return t('naviConnect.station.radio');
        },
        [t],
    );

    /** What happens next, for the line under the chips (station-chips.ts says when). */
    const statusKey = stationStatusKey({ autoplay, bound, inFlight, lastPartial, mode });
    const status = useMemo((): null | string => {
        switch (statusKey) {
            case 'continues':
                return t('naviConnect.station.continues');
            case 'exhausted':
                return t('naviConnect.station.exhausted');
            case 'finding':
                return t('naviConnect.station.finding');
            case 'offStops':
                return t('naviConnect.station.offStops');
            case 'partial':
                return t('naviConnect.station.partial');
            default:
                return null;
        }
    }, [statusKey, t]);

    return {
        autoplay,
        bound,
        catalog,
        character,
        characterLabel: labelOf,
        characters,
        inFlight,
        mode,
        preferred,
        stationName,
        status,
    };
};
