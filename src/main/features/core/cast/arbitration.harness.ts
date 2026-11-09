import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeviceRegistry } from '../hub/device-registry.ts';
import { claimStep, reevaluateClaims } from './arbitration.ts';

/**
 * B-107:  node --test src/main/features/core/cast/arbitration.harness.ts
 *
 * The phone's cast bridge holds a speaker; this desktop's bridge for the same speaker stands
 * down (PROTOCOL §12.2). Then the desktop's MAIN hub socket drops for a second (a Wi-Fi blip, a
 * suspend, a hub restart). The main client forgets the registry it snooped off that connection
 * and emits `devices`, which runs every bridge's `reevaluate`; and the bridge's own claim timer
 * reads the same registry. A registry this desktop does not have is not evidence that the speaker
 * is free (navi-connect/CLAUDE.md §3, "unknown is not evidence"). A claim made on it registers the
 * speaker with the hub, which evicts the phone's bridge (4003) mid-song.
 *
 * What it drives: the real registry the main client keeps (device-registry.ts) and the real
 * arbitration (arbitration.ts), in the order index.ts calls them. What it does not reach: the
 * sockets, the timers and the jitter, and the hub's eviction itself (a walk with a speaker does).
 */

const SELF = 'desktop-1';
const PHONE = 'phone-1';
const CAST = 'cast:living-room';

const phoneHolds = { bridgedBy: PHONE, id: CAST, online: true };
const phoneRow = { id: PHONE, online: true };

const input = (
    registry: ReturnType<ReturnType<typeof createDeviceRegistry>['current']>,
    patch: { createdAt?: number; hubConnected?: boolean; now?: number } = {},
) => ({
    castHubId: CAST,
    createdAt: 0,
    hubConnected: true,
    now: 60_000,
    registry,
    selfHubId: SELF,
    ...patch,
});

test('aBlipOfTheMainSocketDoesNotFreeTheSpeaker', () => {
    const registry = createDeviceRegistry();
    registry.snoop({ devices: [phoneRow, phoneHolds], t: 'welcome' });
    assert.equal(claimStep(input(registry.current(), { now: 3_000 })), 'stand-down');

    // 60 s later the main socket drops: scheduleReconnect forgets the registry and emits it.
    registry.connectionEnded();
    const during = input(registry.current(), { hubConnected: false, now: 60_000 });
    assert.equal(reevaluateClaims(during), false, 'reevaluate must not claim on a forgotten registry');
    assert.notEqual(claimStep({ ...during, now: 61_000 }), 'connect', 'the claim timer neither');

    // The main socket is open again, its welcome not yet read.
    const reopened = input(registry.current(), { hubConnected: true, now: 61_500 });
    assert.equal(reevaluateClaims(reopened), false);
    assert.notEqual(claimStep(reopened), 'connect');

    // The welcome says the phone still holds it.
    registry.snoop({ devices: [phoneRow, phoneHolds], t: 'welcome' });
    const after = input(registry.current(), { now: 61_600 });
    assert.equal(reevaluateClaims(after), false);
    assert.equal(claimStep(after), 'stand-down');
});

test('aColdStartWaitsForTheFirstRegistryHoweverLongItTakes', () => {
    // The bridge is discovered before the main socket has read its first welcome. The old rule
    // waited 10 s and then claimed on nothing; since P3 a bridge cannot dial without the main
    // socket's live address anyway, so the bound bought nothing but the steal.
    const registry = createDeviceRegistry();
    assert.notEqual(claimStep(input(registry.current(), { hubConnected: false, now: 2_000 })), 'connect');
    assert.notEqual(claimStep(input(registry.current(), { hubConnected: false, now: 15_000 })), 'connect');
    // Open, welcome not read yet.
    assert.notEqual(claimStep(input(registry.current(), { hubConnected: true, now: 15_000 })), 'connect');
});

test('aReleasedSpeakerIsClaimed', () => {
    const registry = createDeviceRegistry();
    registry.snoop({ devices: [phoneRow, phoneHolds], t: 'welcome' });
    // The phone quit: its bridge's row goes offline, then away.
    registry.snoop({ devices: [phoneRow, { ...phoneHolds, online: false }], t: 'devices' });
    assert.equal(reevaluateClaims(input(registry.current())), true);
    assert.equal(claimStep(input(registry.current())), 'connect');
    registry.snoop({ devices: [phoneRow], t: 'devices' });
    assert.equal(claimStep(input(registry.current())), 'connect');
});

test('ourOwnPreviousSocketIsNoCompetitor', () => {
    const registry = createDeviceRegistry();
    registry.snoop({ devices: [{ bridgedBy: SELF, id: CAST, online: true }], t: 'welcome' });
    assert.equal(claimStep(input(registry.current())), 'connect');
});

test('anEmptyRegistryFromTheHubIsKnownAndFree', () => {
    // A welcome listing no devices at all is the hub's word, not an absence of one.
    const registry = createDeviceRegistry();
    registry.snoop({ devices: [], t: 'welcome' });
    assert.equal(claimStep(input(registry.current())), 'connect');
});

test('framesWithoutARegistryLeaveItAlone', () => {
    const registry = createDeviceRegistry();
    registry.snoop({ devices: [phoneRow, phoneHolds], t: 'welcome' });
    assert.equal(registry.snoop({ t: 'session' }), false);
    assert.equal(registry.snoop({ t: 'devices' }), false);
    assert.equal(claimStep(input(registry.current())), 'stand-down');
});
