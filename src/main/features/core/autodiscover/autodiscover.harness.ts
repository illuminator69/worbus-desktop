import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-382 (Phase B):
 *   node --test src/main/features/core/autodiscover/autodiscover.harness.ts
 *
 * A fresh profile's sign-in page listed "Tower - Jellyfin server at 192.168.129.153": upstream
 * code's music-server discovery is a Jellyfin UDP broadcast, and Worbus works with Navidrome
 * only, so the one server it can find is one Worbus cannot use. Discovery finds only what Worbus
 * signs in to (Navidrome has no broadcast to answer; the Worbus Server has its own finder).
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('discovery_offers_no_jellyfin_server', () => {
    const src = read('./index.ts');
    const all = src.slice(
        src.indexOf('function discoverAll'),
        src.indexOf('function discoverAll') + 300,
    );
    assert.doesNotMatch(all, /discoverJellyfin/, 'discovery broadcasts for Jellyfin servers');
    assert.doesNotMatch(src, /who is JellyfinServer\?/, 'the Jellyfin broadcast is still sent');
});
