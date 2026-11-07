import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Worbus P5 lane F, F3:  node --test src/main/features/core/discord-rpc/application-id.harness.ts
 *
 * Discord presence runs on Worbus's own Discord application (design §6.9), created by the owner on
 * 2026-11-07 (lane D). With no application ID at all presence is off, says so once in the log, and
 * never reaches upstream's application. A person's own Application ID still wins. The module is
 * imported inside each test so that, before it exists, each test fails on its own.
 */

/** The owner's Worbus application (lane D, 2026-11-07). Not secret: it is in every presence call. */
const WORBUS_APP = '1568623974751936573';

const load = () => import('./application-id.ts');

const fakeDeps = () => {
    const created: string[] = [];
    const lines: string[] = [];
    return {
        created,
        deps: {
            create: (clientId: string) => {
                created.push(clientId);
                return { destroy: async () => undefined, login: async () => undefined };
            },
            log: { info: (line: string) => lines.push(line) },
        },
        lines,
    };
};

test('discord_uses_worbus_application', async () => {
    const { connectDiscord, WORBUS_DISCORD_APPLICATION_ID } = await load();
    assert.equal(WORBUS_DISCORD_APPLICATION_ID, WORBUS_APP);
    const fake = fakeDeps();
    assert.ok(await connectDiscord(undefined, fake.deps));
    assert.ok(await connectDiscord('   ', fake.deps));
    assert.ok(await connectDiscord('', fake.deps));
    assert.deepEqual(fake.created, [WORBUS_APP, WORBUS_APP, WORBUS_APP]);
    assert.deepEqual(fake.lines, [], 'nothing to say when presence is on');
});

test('discord_off_without_application_id', async () => {
    const { connectDiscord } = await load();
    const fake = fakeDeps();
    const deps = { ...fake.deps, appId: '' };
    assert.equal(await connectDiscord(undefined, deps), null);
    assert.equal(await connectDiscord('   ', deps), null);
    assert.equal(await connectDiscord('', deps), null);
    assert.deepEqual(fake.created, [], 'no connection attempt');
    assert.equal(fake.lines.length, 1, 'one log line, however often the renderer asks');
    assert.match(fake.lines[0], /Discord presence is off/);
});

test('discord_user_client_id_wins', async () => {
    const { connectDiscord } = await load();
    const fake = fakeDeps();
    const client = await connectDiscord(' 123456789012345678 ', fake.deps);
    assert.ok(client);
    assert.deepEqual(fake.created, ['123456789012345678']);
});

test('discord_upstream_default_is_not_a_choice', async () => {
    const { connectDiscord } = await load();
    const fake = fakeDeps();
    // The old app's default, saved in every copied profile (built here so the ID is in no file).
    const upstream = ['11659576687', '58900787'].join('');
    assert.ok(await connectDiscord(upstream, fake.deps));
    assert.deepEqual(fake.created, [WORBUS_APP], "Worbus's application, never upstream's");
});

test('discord_failed_login_destroys_client', async () => {
    const { connectDiscord } = await load();
    let destroyed = 0;
    const deps = {
        create: () => ({
            destroy: async () => {
                destroyed += 1;
            },
            login: async () => {
                throw new Error('Could not connect');
            },
        }),
        log: { info: () => undefined },
    };
    await assert.rejects(connectDiscord('123456789012345678', deps), /Could not connect/);
    assert.equal(destroyed, 1, 'the client that failed to log in is closed, not leaked');
});

test('no_upstream_discord_id', () => {
    const SRC = new URL('../../../../', import.meta.url).pathname;
    const hits: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (readFileSync(full).includes(['11659576687', '58900787'].join('')))
                hits.push(full);
        }
    };
    walk(SRC);
    assert.deepEqual(hits, [], "upstream's Discord application");
});
