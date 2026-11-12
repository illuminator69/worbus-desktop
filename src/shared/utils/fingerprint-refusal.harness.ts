import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Fix round 3 (2026-11-12):  node --test src/shared/utils/fingerprint-refusal.harness.ts
 *
 * The hub (umbrella fix/phase-b-2026-11-10 @03b65d4, PROTOCOL §14) answers the fingerprint route
 * with `503 {"code":"audiomuse_too_old","need":"3.7.1","error":"…"}` when AudioMuse refuses the
 * POST, and `400 {"code":"bad_request"}` for a bad `n`. The desktop did `if (!res.ok) return [];`,
 * so both read as "no listening". Its own direct fallback has the same blind spot when an older
 * AudioMuse answers the POST (B-359) with a 405, or a 400 that is not JSON. A known refusal is a
 * named state the Your mix surfaces show; anything else stays today's empty answer.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const load = async () =>
    (await import('./fingerprint-refusal.ts').catch(() => null)) as null | {
        fingerprintRefusal: (viaHub: boolean, status: number, body: string) => unknown;
        refusalLine: (
            r: unknown,
        ) => { key: string; values: Record<string, string> } | { text: string };
    };

test('the_hubs_known_refusals_are_named', async () => {
    const mod = await load();
    assert.ok(mod, 'a refused fingerprint reads as an empty one: no named state');
    const tooOld = mod.fingerprintRefusal(
        true,
        503,
        JSON.stringify({
            code: 'audiomuse_too_old',
            error: 'AudioMuse refused the POST',
            need: '3.7.1',
        }),
    );
    assert.deepEqual(tooOld, { code: 'audiomuse_too_old', need: '3.7.1' });
    assert.deepEqual(mod.refusalLine(tooOld), {
        key: 'naviConnect.mixes.audioMuseTooOld',
        values: { need: '3.7.1' },
    });
    // No `need` sent: the version the POST needs.
    assert.deepEqual(mod.fingerprintRefusal(true, 503, '{"code":"audiomuse_too_old"}'), {
        code: 'audiomuse_too_old',
        need: '3.7.1',
    });
    const bad = mod.fingerprintRefusal(
        true,
        400,
        '{"code":"bad_request","error":"n must be 1-500"}',
    );
    assert.deepEqual(bad, { code: 'bad_request', error: 'n must be 1-500' });
    assert.deepEqual(mod.refusalLine(bad), { text: 'n must be 1-500' });
    // Anything else through the hub is today's empty answer.
    assert.equal(mod.fingerprintRefusal(true, 503, '{"code":"busy"}'), null);
    assert.equal(mod.fingerprintRefusal(true, 502, 'Bad gateway'), null);
    assert.equal(mod.fingerprintRefusal(true, 405, ''), null);
});

test('an_older_audiomuse_refusing_the_direct_post_is_named', async () => {
    const mod = await load();
    assert.ok(mod);
    assert.deepEqual(mod.fingerprintRefusal(false, 405, '<html>Method Not Allowed</html>'), {
        code: 'audiomuse_too_old',
        need: '3.7.1',
    });
    assert.deepEqual(mod.fingerprintRefusal(false, 400, '<!doctype html><title>400</title>'), {
        code: 'audiomuse_too_old',
        need: '3.7.1',
    });
    // A 400 in JSON is AudioMuse answering the POST it understood: today's empty answer.
    assert.equal(mod.fingerprintRefusal(false, 400, '{"error":"no history"}'), null);
    assert.equal(mod.fingerprintRefusal(false, 500, 'oops'), null);
});

test('the_refusal_reaches_the_your_mix_surfaces', () => {
    const main = read('../../main/features/core/audiomuse/index.ts');
    assert.match(main, /fingerprintRefusal\(ep\.viaHub, res\.status,/);
    const source = read('../../renderer/features/player/auto-dj/audio-muse-source.ts');
    assert.match(source, /refusalLine\(answer\.refused\)/);
    const en = JSON.parse(read('../../i18n/locales/en.json'));
    assert.match(en.naviConnect.mixes.audioMuseTooOld, /\{\{need\}\} or later/);
});
