import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { autoplayEnabledPatch, stationCharacterPatch, strategyPatch } from './autoplay-keys.ts';

/**
 * F3:  node --test src/renderer/features/player/station/autoplay-settings-keys.harness.ts
 *
 * Autoplay was split three ways under two names: Settings had no switch, the More panel and the
 * queue chips wrote `autoDJ.enabled`, and the station character (`station.character`) had no
 * Settings control at all. Settings now has the switch and the character, and writes through the
 * same two patch builders as the panel, so they cannot name different keys.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SETTINGS = '../../settings/components/';
const words = () => read('../../../../i18n/locales/en.json');

test('theAutoplaySwitchWritesAutoDJEnabled', () => {
    assert.deepEqual(autoplayEnabledPatch(true), { autoDJ: { enabled: true } });
    assert.deepEqual(autoplayEnabledPatch(false), { autoDJ: { enabled: false } });
});

test('theCharacterSelectWritesStationCharacter', () => {
    for (const id of ['close', 'balanced', 'explore']) {
        assert.deepEqual(stationCharacterPatch(id), { station: { character: id } });
    }
});

test('theStrategyFollowsTheModeAndWritesOnlyThatKey', () => {
    assert.deepEqual(strategyPatch('songs', 'similar'), { autoDJ: { songStrategy: 'similar' } });
    assert.deepEqual(strategyPatch('albums', 'random'), { autoDJ: { albumStrategy: 'random' } });
});

test('theSettingsSectionAndThePanelUseTheSameBuilders', () => {
    const settings = read(`${SETTINGS}playback/auto-dj-settings.tsx`);
    const panel = read('../../player/components/auto-dj-panel.tsx');
    for (const [name, source] of [
        ['settings', settings],
        ['panel', panel],
    ] as const) {
        assert.match(
            source,
            /autoplayEnabledPatch\(/,
            `${name} writes the switch through the builder`,
        );
        assert.match(source, /strategyPatch\(/, `${name} writes the strategy through the builder`);
        assert.doesNotMatch(source, /autoDJ:\s*\{\s*enabled/, `${name} must not inline the key`);
    }
    assert.match(settings, /stationCharacterPatch\(/);
});

test('theSettingsTimingControlIsTheSliderThePanelUses', () => {
    const settings = read(`${SETTINGS}playback/auto-dj-settings.tsx`);
    const panel = read('../../player/components/auto-dj-panel.tsx');
    assert.match(panel, /<Slider/);
    assert.match(settings, /<Slider/);
    assert.doesNotMatch(settings.slice(settings.indexOf('timing')), /<NumberInput[^>]*timing/i);
    for (const source of [settings, panel]) {
        assert.match(source, /min=\{1\}[\s\S]{0,400}max=\{5\}|max=\{5\}[\s\S]{0,400}min=\{1\}/);
    }
});

test('theSwitchComesFirstAndTheKnobsAreFoldedUnderTheUnavailableStations', () => {
    const settings = read(`${SETTINGS}playback/auto-dj-settings.tsx`);
    assert.ok(settings.indexOf('autoplayEnabledPatch') < settings.indexOf('stationCharacterPatch'));
    assert.match(settings, /<Accordion/);
    assert.match(settings, /t\('setting\.autoplayFallback'\)/);
    assert.match(words(), /"autoplayFallback": "When the server's stations are unavailable"/);
    const fold = settings.slice(settings.indexOf('const fallbackOptions'));
    for (const key of [
        'mode',
        'itemCount',
        'timing',
        'allowDuplicates',
        'onlySimilar',
        'artistRadioCount',
    ]) {
        assert.ok(fold.includes(key), `${key} is inside the fold`);
    }
});

test('scrobbleMicrotonalAndRadioCountMovedToPlayback', () => {
    const playback = read(`${SETTINGS}playback/playback-tab.tsx`);
    assert.match(playback, /ScrobbleSettings/);
    const general = read(`${SETTINGS}general/general-tab.tsx`);
    assert.doesNotMatch(general, /ScrobbleSettings/);
    const controls = read(`${SETTINGS}general/control-settings.tsx`);
    assert.doesNotMatch(controls, /microtonalPitchControls|artistRadioCount/);
    const audio = read(`${SETTINGS}playback/audio-settings.tsx`);
    assert.match(audio, /microtonalPitchControls/);
    const fold = read(`${SETTINGS}playback/auto-dj-settings.tsx`);
    assert.match(fold, /artistRadioCount/);
});

test('rowsTheServerOverridesSayWhatHappensInsteadOfDisappearing', () => {
    const application = read(`${SETTINGS}general/application-settings.tsx`);
    assert.match(words(), /"autosaveServerSaves": "Off while connected to a Worbus Server;/);
    assert.equal((application.match(/t\('setting\.autosaveServerSaves'\)/g) ?? []).length, 2);
    const autosave = application.slice(application.indexOf("t('setting.autosave')"));
    assert.match(
        autosave,
        /isHidden: !settings\.autoSave\.enabled/,
        'frequency keeps its own rule',
    );
    const transcode = read(`${SETTINGS}playback/transcode-settings.tsx`);
    assert.match(transcode, /t\('setting\.transcodeThisComputer'\)/);
    assert.match(
        words(),
        /"transcodeThisComputer": "Applies to this computer only; casting and other devices stream the original\."/,
    );
});
