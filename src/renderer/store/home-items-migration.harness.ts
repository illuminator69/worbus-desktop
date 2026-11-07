import assert from 'node:assert/strict';
import test from 'node:test';

import {
    homeFeatureShouldTurnOff,
    migrateHomeItems,
    NEW_DEFAULT_HOME_ORDER,
    OLD_DEFAULT_HOME_ORDER,
} from './home-items-migration.ts';

/**
 * F5:  node --test src/renderer/store/home-items-migration.harness.ts
 *
 * Settings version 38: Home's rows get the redesign's order and four new rows; a customised order is kept.
 */

const rows = (ids: readonly string[], disabled: string[] = []) =>
    ids.map((id) => ({ disabled: disabled.includes(id), id }));

test('theOldDefaultBecomesTheNewDefault', () => {
    assert.deepEqual(migrateHomeItems(rows(OLD_DEFAULT_HOME_ORDER)), rows(NEW_DEFAULT_HOME_ORDER));
});

test('theOldDefaultKeepsItsDisabledRow', () => {
    assert.deepEqual(
        migrateHomeItems(rows(OLD_DEFAULT_HOME_ORDER, ['recentlyReleased'])),
        rows(NEW_DEFAULT_HOME_ORDER, ['recentlyReleased']),
    );
});

test('aCustomisedOrderIsKeptAndGainsTheFourNewRows', () => {
    const stored = [
        { disabled: false, id: 'mostPlayed' },
        { disabled: true, id: 'recentlyAdded' },
        { disabled: false, id: 'genres' },
    ];
    assert.deepEqual(migrateHomeItems(stored), [
        ...stored,
        ...rows(['fresh', 'mixes', 'rediscovery', 'similarArtists']),
    ]);
});

test('duplicatesAreDroppedFirstWins', () => {
    const stored = [
        { disabled: true, id: 'genres' },
        { disabled: false, id: 'genres' },
        { disabled: false, id: 'random' },
    ];
    assert.deepEqual(migrateHomeItems(stored), [
        { disabled: true, id: 'genres' },
        { disabled: false, id: 'random' },
        ...rows(['fresh', 'mixes', 'rediscovery', 'similarArtists']),
    ]);
});

test('anUnknownIdIsKept', () => {
    const migrated = migrateHomeItems([
        { disabled: false, id: 'mostPlayed' },
        { disabled: false, id: 'somethingNew' },
    ]);
    assert.deepEqual(
        migrated.map((r) => r.id),
        ['mostPlayed', 'somethingNew', 'fresh', 'mixes', 'rediscovery', 'similarArtists'],
    );
});

test('nothingStoredGivesTheNewDefault', () => {
    assert.deepEqual(migrateHomeItems(undefined), rows(NEW_DEFAULT_HOME_ORDER));
    assert.deepEqual(migrateHomeItems([]), rows(NEW_DEFAULT_HOME_ORDER));
});

test('migratingTwiceChangesNothing', () => {
    const once = migrateHomeItems(rows(OLD_DEFAULT_HOME_ORDER));
    assert.deepEqual(migrateHomeItems(once), once);
    const custom = migrateHomeItems([{ disabled: false, id: 'genres' }]);
    assert.deepEqual(migrateHomeItems(custom), custom);
});

test('homeFeatureTurnsOffOnlyForTheDefaultPair', () => {
    assert.equal(homeFeatureShouldTurnOff({ homeFeature: true, homeFeatureStyle: 'single' }), true);
    assert.equal(
        homeFeatureShouldTurnOff({ homeFeature: true, homeFeatureStyle: 'multiple' }),
        false,
    );
    assert.equal(
        homeFeatureShouldTurnOff({ homeFeature: false, homeFeatureStyle: 'single' }),
        false,
    );
    assert.equal(homeFeatureShouldTurnOff({}), false);
});
