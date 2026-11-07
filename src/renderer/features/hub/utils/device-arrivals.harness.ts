import assert from 'node:assert/strict';
import test from 'node:test';

import type { ArrivalContext, ArrivalDevice } from './device-arrivals.ts';

import {
    ARRIVAL_MIN_ABSENCE_MS,
    ARRIVAL_PROPOSAL_MS,
    createArrivalTracker,
} from './device-arrivals.ts';

/**
 * F1:  node --test src/renderer/features/hub/utils/device-arrivals.harness.ts
 *
 * Which hub device "just connected", from the `devices` snapshots the hub store is given:
 * what the bar's pill offers as "Switch to <name>".
 */

const ME = 'desk';

// Extra keys stand for the rest of a hub `DeviceInfo` (volume, isActive), which the tracker ignores.
const device = (
    id: string,
    patch: Partial<ArrivalDevice> & Record<string, unknown> = {},
): ArrivalDevice => ({
    id,
    name: id.toUpperCase(),
    online: true,
    ...patch,
});

const ctx = (patch: Partial<ArrivalContext> = {}): ArrivalContext => ({
    activeId: null,
    hiddenIds: new Set(),
    myId: ME,
    ...patch,
});

const proposedId = (tracker: ReturnType<typeof createArrivalTracker>, now: number, c = ctx()) =>
    tracker.proposal(now, c)?.id ?? null;

test('theFirstSnapshotIsABaseline', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME), device('pixel'), device('tv')], 0);
    assert.equal(proposedId(tracker, 0), null);
});

test('aNewIdAfterTheBaselineIsAnArrival', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    assert.equal(proposedId(tracker, 1_000), 'pixel');
});

test('aDeviceOfflineForTheMinimumThenOnlineIsAnArrival', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME), device('pixel')], 0);
    tracker.observe([device(ME), device('pixel', { online: false })], 1_000);
    tracker.observe([device(ME), device('pixel')], 1_000 + ARRIVAL_MIN_ABSENCE_MS);
    assert.equal(proposedId(tracker, 1_000 + ARRIVAL_MIN_ABSENCE_MS), 'pixel');
});

test('aDeviceMissingForTheMinimumThenBackIsAnArrival', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME), device('pixel')], 0);
    tracker.observe([device(ME)], 1_000);
    tracker.observe([device(ME), device('pixel')], 1_000 + ARRIVAL_MIN_ABSENCE_MS);
    assert.equal(proposedId(tracker, 1_000 + ARRIVAL_MIN_ABSENCE_MS), 'pixel');
});

// Worbus for Android keeps its hub socket while backgrounded; it reconnects when its process restarts, and
// is back within seconds (its backoff starts at 1 s). That is the arrival the pill is for.
test('anAppRestartAFewSecondsLongIsAnArrival', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME), device('pixel')], 0);
    tracker.observe([device(ME), device('pixel', { online: false })], 1_000);
    tracker.observe([device(ME), device('pixel')], 6_000);
    assert.equal(proposedId(tracker, 6_000), 'pixel');
});

test('observeReturnsWhatArrived', () => {
    const tracker = createArrivalTracker();
    assert.deepEqual(tracker.observe([device(ME)], 0), []);
    assert.deepEqual(
        tracker.observe([device(ME), device('pixel')], 1_000).map((d) => d.id),
        ['pixel'],
    );
    assert.deepEqual(tracker.observe([device(ME), device('pixel', { volume: 3 })], 2_000), []);
});

test('aDeviceOfflineForTwoSecondsIsNotAnArrival', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME), device('pixel')], 0);
    tracker.observe([device(ME), device('pixel', { online: false })], 1_000);
    tracker.observe([device(ME), device('pixel')], 3_000);
    assert.equal(proposedId(tracker, 3_000), null);
    // A socket that drops for a moment and vanishes from the list is the same.
    tracker.observe([device(ME)], 4_000);
    tracker.observe([device(ME), device('pixel')], 6_000);
    assert.equal(proposedId(tracker, 6_000), null);
});

test('aVolumeOnlyChangeIsNotAnArrival', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME), device('pixel', { volume: 40 })], 0);
    tracker.observe([device(ME), device('pixel', { volume: 80 })], 500);
    assert.equal(proposedId(tracker, 500), null);
});

test('anActiveFlagChangeIsNotAnArrival', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME), device('pixel', { isActive: false })], 0);
    tracker.observe([device(ME), device('pixel', { isActive: true })], 500);
    tracker.observe([device(ME), device('pixel', { name: 'Pixel 8' })], 900);
    assert.equal(proposedId(tracker, 900), null);
});

test('aHiddenDeviceIsNeverProposed', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    assert.equal(proposedId(tracker, 1_000, ctx({ hiddenIds: new Set(['pixel']) })), null);
});

test('anUnreachableDeviceIsNeverProposed', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('cast', { reachable: false })], 1_000);
    assert.equal(proposedId(tracker, 1_000), null);
    // The bridge then reaches it: the arrival still stands while it is fresh.
    tracker.observe([device(ME), device('cast', { reachable: true })], 2_000);
    assert.equal(proposedId(tracker, 2_000), 'cast');
});

test('myOwnIdAndTheActiveIdAreNeverProposed', () => {
    const tracker = createArrivalTracker();
    tracker.observe([], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    assert.equal(proposedId(tracker, 1_000, ctx({ activeId: 'pixel' })), null);
    assert.equal(proposedId(tracker, 1_000, ctx({ myId: 'pixel' })), ME);
});

test('aDeviceThatGoesOfflineAgainIsNotProposed', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    tracker.observe([device(ME), device('pixel', { online: false })], 2_000);
    assert.equal(proposedId(tracker, 2_000), null);
});

test('theProposalExpiresAfterThirtySeconds', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    assert.equal(proposedId(tracker, 1_000 + ARRIVAL_PROPOSAL_MS - 1), 'pixel');
    assert.equal(proposedId(tracker, 1_000 + ARRIVAL_PROPOSAL_MS + 1), null);
});

test('expiresAtIsThirtySecondsAfterTheArrival', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    assert.equal(tracker.expiresAt('pixel'), 1_000 + ARRIVAL_PROPOSAL_MS);
    assert.equal(tracker.expiresAt(ME), null);
});

test('dismissRemovesTheProposal', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    tracker.dismiss('pixel');
    assert.equal(proposedId(tracker, 1_000), null);
});

test('theLaterOfTwoArrivalsWins', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    tracker.observe([device(ME), device('pixel'), device('tv')], 2_000);
    assert.equal(proposedId(tracker, 2_000), 'tv');
    tracker.dismiss('tv');
    assert.equal(proposedId(tracker, 2_000), 'pixel');
});

test('resetMakesTheNextSnapshotABaselineAgain', () => {
    const tracker = createArrivalTracker();
    tracker.observe([device(ME)], 0);
    tracker.observe([device(ME), device('pixel')], 1_000);
    tracker.reset();
    assert.equal(proposedId(tracker, 1_000), null);
    tracker.observe([device(ME), device('pixel'), device('tv')], 60_000);
    assert.equal(proposedId(tracker, 60_000), null);
});
