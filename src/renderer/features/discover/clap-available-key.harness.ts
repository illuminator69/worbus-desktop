import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-321 (S-099's leftovers, 2026-10-31):  node --test src/renderer/features/discover/clap-available-key.harness.ts
 *
 * The CLAP probe ("can mood search be asked?") goes through the hub when one is enabled and signed in
 * (main `audiomuse/index.ts` `endpoint()`), else straight to AudioMuse. Its react-query key held only
 * the direct address and token, so switching the hub on or off, or signing in, kept the old answer
 * for up to an hour (`staleTime`). The key now names everything the answer depends on.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the_clap_probe_is_asked_again_when_the_hub_changes', async () => {
    const { clapAvailableKey } = await import('./clap-available-key.ts');
    const audioMuse = { token: 't', url: 'http://am:8000' };
    const hub = { enabled: true, signedIn: true, token: 'h', url: 'ws://hub:4790' };
    const base = JSON.stringify(clapAvailableKey(audioMuse, hub));
    for (const change of [
        { enabled: false },
        { signedIn: false },
        { token: 'other' },
        { url: 'ws://elsewhere:4790' },
    ]) {
        assert.notEqual(
            JSON.stringify(clapAvailableKey(audioMuse, { ...hub, ...change })),
            base,
            JSON.stringify(change),
        );
    }
});

test('both_readers_of_the_probe_use_one_key', () => {
    for (const file of [
        './use-discover-capabilities.ts',
        '../settings/components/server/worbus-server-settings.tsx',
    ]) {
        assert.match(read(file), /queryKey: clapAvailableKey\(audioMuse, clapHub\)/, file);
    }
});
