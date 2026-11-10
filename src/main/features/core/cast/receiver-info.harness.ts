import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { castKind, receiverLevel, serviceToDevice } from './receiver-info.ts';

/** node --test src/main/features/core/cast/receiver-info.harness.ts */

// `ca` values of the kind these product lines publish in their TXT record, written down from
// published records. NOT read off the two real devices on this network.
const CHROMECAST_TV = '201221'; // video out, audio out, ...
const NEST_SPEAKER = '199172'; // audio out, no video
const SPEAKER_GROUP = '199204'; // audio out + multizone group

test('a receiver with a picture is a TV, one with sound only a speaker', () => {
    assert.equal(castKind(CHROMECAST_TV), 'tv');
    assert.equal(castKind(NEST_SPEAKER), 'speaker');
});

test('a group is a group, though it is audio out as well', () => {
    assert.equal(castKind(SPEAKER_GROUP), 'group');
    assert.equal(castKind('37'), 'group', 'bits 32 + 4 + 1: the group bit is asked first');
});

test('the three bits alone', () => {
    assert.equal(castKind('1'), 'tv');
    assert.equal(castKind('4'), 'speaker');
    assert.equal(castKind('32'), 'group');
    assert.equal(castKind('5'), 'tv', 'video and audio out');
    assert.equal(castKind(4), 'speaker', 'a number is read as one');
});

test('no usable capability bits: no kind, so the row draws its generic icon', () => {
    assert.equal(castKind(undefined), undefined, 'the record has no `ca`');
    assert.equal(castKind(''), undefined);
    assert.equal(castKind('0'), undefined);
    assert.equal(castKind('2'), undefined, 'video in only: neither output');
    assert.equal(castKind('speaker'), undefined);
    assert.equal(castKind('4.5'), undefined);
    assert.equal(castKind('-4'), undefined);
    assert.equal(castKind(Number.NaN), undefined);
});

test('a bit above the 32-bit range does not disturb the three that are read', () => {
    assert.equal(castKind(String(2 ** 40 + 4)), 'speaker');
    assert.equal(castKind(String(2 ** 40 + 32)), 'group');
});

test("the receiver's level is 0..1 on the wire and 0..100 on the row", () => {
    assert.equal(receiverLevel({ level: 0.35, muted: false }), 35);
    assert.equal(receiverLevel({ level: 1 }), 100);
    assert.equal(receiverLevel({ level: 0 }), 0);
    assert.equal(receiverLevel({ level: 0.3499999940395355 }), 35, 'a float32 from the device');
    assert.equal(receiverLevel({ level: 1.2 }), 100);
});

test('a muted receiver is at 0, whatever level it would return to', () => {
    assert.equal(receiverLevel({ level: 0.6, muted: true }), 0);
    assert.equal(receiverLevel({ muted: true }), 0);
});

test('a status without a level reports nothing', () => {
    assert.equal(receiverLevel(undefined), null);
    assert.equal(receiverLevel(null), null);
    assert.equal(receiverLevel({}), null);
    assert.equal(receiverLevel({ muted: false }), null);
    assert.equal(receiverLevel({ level: '0.5' }), null);
    assert.equal(receiverLevel({ level: Number.NaN }), null);
});

/**
 * B-115 (desktop half): a Cast device advertises the port it listens on in its mDNS SRV record.
 * A speaker group's leader advertises the group on a port of its own (not 8009), so a bridge that
 * always dials 8009 drives the leader alone. The bridge must dial the advertised port. No real
 * device: the services are written out by hand.
 */
test('the_device_keeps_the_port_it_advertises', () => {
    const group = serviceToDevice({
        addresses: ['192.168.1.40'],
        name: 'Downstairs',
        port: 32123,
        txt: { ca: SPEAKER_GROUP, fn: 'Downstairs', id: 'g1' },
    });
    assert.equal(group?.port, 32123);
    // A record with no port (never seen; bonjour-service always sets one) dials Cast's own.
    const plain = serviceToDevice({ addresses: ['192.168.1.41'], name: 'Kitchen', txt: {} });
    assert.equal(plain?.port, 8009);
});

test('the_bridge_dials_and_probes_that_port', () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /client\.connect\(this\.host,/, 'castv2 dials the host on 8009');
    assert.doesNotMatch(src, /socket\.connect\(CAST_PORT, /, 'the probe dials 8009');
});
