import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { EXPORT_SECRET_PATHS, keepCurrentSecrets, omitExportSecrets } from './export-secrets.ts';

/**
 * F1:  node --test src/renderer/store/export-secrets.harness.ts
 *
 * Settings > Advanced > Export wrote the whole store as plain JSON, hub token, AudioMuse token,
 * remote password, Last.fm and translation keys included: "send me your settings" leaked the hub
 * token. The export now drops every path in EXPORT_SECRET_PATHS, and an import of a file without
 * them keeps the values that are set now.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const PLANTED = {
    hubToken: 'planted-hub-token-7f3a',
    lastfm: 'planted-lastfm-key-91bc',
    muse: 'planted-audiomuse-token-c20d',
    remote: 'planted-remote-password-44aa',
    translate: 'planted-translation-key-0e5f',
};

// The shape of the state slices that carry secrets, plus neighbours that must survive.
const state = () => ({
    actionsAreNotHere: undefined,
    audioMuse: { token: PLANTED.muse, url: 'http://muse.lan:8000' },
    general: { accent: 'rgb(53, 116, 252)', lastfmApiKey: PLANTED.lastfm, theme: 'defaultDark' },
    hub: {
        enabled: true,
        hiddenDeviceIds: ['a'],
        name: 'Desk',
        publicServerUrl: 'https://music.example.com',
        token: PLANTED.hubToken,
        url: 'ws://hub.lan:4790',
    },
    lyrics: { follow: true, translationApiKey: PLANTED.translate },
    remote: { enabled: false, password: PLANTED.remote, port: 4333, username: 'feishin' },
    version: 42,
});

const get = (obj: any, path: string) =>
    path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);

test('theListNamesTheFiveSecretsAndTheHubSwitch', () => {
    assert.deepEqual([...EXPORT_SECRET_PATHS].sort(), [
        'audioMuse.token',
        'general.lastfmApiKey',
        'hub.enabled',
        'hub.token',
        'lyrics.translationApiKey',
        'remote.password',
    ]);
});

test('everyPathInTheListIsAbsentFromTheExport', () => {
    const out = omitExportSecrets(state());
    for (const path of EXPORT_SECRET_PATHS) {
        assert.equal(get(out, path), undefined, `${path} must not be exported`);
        const parent = get(out, path.split('.').slice(0, -1).join('.'));
        assert.ok(parent && !(path.split('.').pop()! in parent), `${path} key itself must be gone`);
    }
});

test('noPlantedSecretSurvivesAnywhereInTheSerialisedExport', () => {
    const json = JSON.stringify(omitExportSecrets(state()));
    for (const value of Object.values(PLANTED)) {
        assert.ok(!json.includes(value), `${value} leaked into the export`);
    }
});

test('theRestOfTheStateIsExportedUntouchedAndTheInputIsNotMutated', () => {
    const input = state();
    const out: any = omitExportSecrets(input);
    assert.equal(out.hub.url, 'ws://hub.lan:4790');
    assert.equal(out.hub.name, 'Desk');
    assert.equal(out.hub.publicServerUrl, 'https://music.example.com');
    assert.equal(out.audioMuse.url, 'http://muse.lan:8000');
    assert.equal(out.general.theme, 'defaultDark');
    assert.equal(out.remote.port, 4333);
    assert.equal(out.version, 42);
    // The live store object keeps its secrets: the export is a copy.
    assert.equal(input.hub.token, PLANTED.hubToken);
    assert.equal(input.remote.password, PLANTED.remote);
});

test('aFileWithoutSecretsKeepsTheCurrentOnesOnImport', () => {
    const file: any = omitExportSecrets(state());
    const current: any = state();
    current.hub.token = 'current-hub-token';
    current.remote.password = 'current-remote';
    current.general.lastfmApiKey = 'current-lastfm';
    current.lyrics.translationApiKey = 'current-translate';
    current.audioMuse.token = 'current-muse';

    const merged: any = keepCurrentSecrets(file, current);
    for (const path of EXPORT_SECRET_PATHS) {
        assert.equal(get(merged, path), get(current, path), `${path} must stay as it is now`);
    }
    // everything else comes from the file
    assert.equal(merged.hub.url, 'ws://hub.lan:4790');
    // the parsed file object is not edited in place
    assert.equal(get(file, 'hub.token'), undefined);
});

test('aSecretThatTheFileDoesCarryIsAppliedAndNotOverwrittenByTheCurrent', () => {
    const file: any = omitExportSecrets(state());
    file.hub.token = 'from-an-older-export';
    const current: any = state();
    const merged: any = keepCurrentSecrets(file, current);
    assert.equal(merged.hub.token, 'from-an-older-export');
    assert.equal(merged.remote.password, PLANTED.remote);
});

test('aMissingParentIsNotInventedByTheFill', () => {
    const merged: any = keepCurrentSecrets({ general: { theme: 'x' } }, state());
    assert.equal(merged.hub, undefined);
    assert.equal(merged.remote, undefined);
    assert.equal(merged.general.lastfmApiKey, PLANTED.lastfm);
});

test('theListCoversEverySecretLookingKeyOfTheSettingsSchema', () => {
    // A new token / password / API key in the settings schema must be added to the list, or this
    // fails. It reads the zod schema text, so it cannot be satisfied by editing the list alone.
    const schema = read('./settings.store.ts');
    const names = new Set<string>();
    for (const m of schema.matchAll(/^\s+(\w*(?:token|password|apikey|secret))\s*:\s*z\./gim)) {
        names.add(m[1]);
    }
    assert.ok(names.size >= 4, `expected to find the schema's secret keys, got ${[...names]}`);
    const listed = new Set(EXPORT_SECRET_PATHS.map((p) => p.split('.').pop()));
    for (const name of names) {
        assert.ok(listed.has(name), `schema key "${name}" looks secret and is not in the list`);
    }
});

test('theExportHookAndTheImportModalUseTheList', () => {
    const store = read('./settings.store.ts');
    const hook = store.slice(store.indexOf('export const useSettingsForExport'));
    assert.match(
        hook.slice(0, hook.indexOf('export const migrateSettings')),
        /omitExportSecrets\(/,
        'useSettingsForExport must strip the secrets',
    );
    const modal = read(
        '../components/export-import-settings-modal/export-import-settings-modal.tsx',
    );
    assert.match(modal, /keepCurrentSecrets\(/, 'the import must keep the current secrets');
});

test('theHubSwitchTravelsNeitherWayAndTheOtherHubFieldsDo', () => {
    // A fresh profile that imports a file must not land on Connect on with an empty token.
    const file: any = omitExportSecrets(state());
    assert.equal(file.hub.enabled, undefined);
    assert.equal(file.hub.url, 'ws://hub.lan:4790');
    assert.equal(file.hub.name, 'Desk');
    assert.equal(file.hub.publicServerUrl, 'https://music.example.com');

    const fresh: any = state();
    fresh.hub.enabled = false;
    fresh.hub.token = '';
    const merged: any = keepCurrentSecrets(file, fresh);
    assert.equal(merged.hub.enabled, false, "import keeps the profile's own switch");
    assert.equal(merged.hub.token, '');
    assert.equal(merged.hub.url, 'ws://hub.lan:4790');
});
