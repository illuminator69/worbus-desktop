import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Worbus P1, lane F (F2):  node --test src/renderer/features/lbbot/downloads-gate.harness.ts
 *
 * A source guard: every download surface follows lb-bot's downloads mode. Each file in the plan's
 * F2 table must call `useLbBotDownloadsShown(` itself, or be rendered only by a caller that does
 * (and that names it), or - for the non-hook ledger and acquire functions - ask `downloadsOffNow()`
 * before making a request. Removing the call from any one file makes this fail.
 */

const features = dirname(fileURLToPath(import.meta.url)).replace(/\/lbbot$/, '');
const read = (file: string): string => readFileSync(join(features, file), 'utf8');

const HOOK = 'useLbBotDownloadsShown(';

/** Files that read the mode themselves. */
const DIRECT = [
    'lbbot/components/acquire-button.tsx',
    'lbbot/routes/lbbot-external-album-route.tsx',
    'lbbot/hooks/use-album-request.ts',
    'lbbot/components/gap-box.tsx',
    'context-menu/actions/find-missing-tracks-action.tsx',
    'sidebar/components/sidebar-groups.tsx',
    'lbbot/routes/lbbot-downloads-route.tsx',
    'lbbot/hooks/use-fill-actions.ts',
    'sidebar/components/navi-connect-items.ts',
];

/**
 * Files whose download control is a gated child: [file, child file, the child it renders]. The
 * child renders nothing while off (AcquireButton), so the file's tile keeps everything else.
 */
const CHILD: [string, string, string][] = [
    [
        'lbbot/components/missing-album-tile.tsx',
        'lbbot/components/acquire-button.tsx',
        'AcquireButton',
    ],
    ['discover/components/fresh-row.tsx', 'lbbot/components/acquire-button.tsx', 'AcquireButton'],
    ['discover/components/browse-row.tsx', 'lbbot/components/acquire-button.tsx', 'AcquireButton'],
    [
        'listening/components/listening-sections.tsx',
        'lbbot/components/missing-album-tile.tsx',
        'MissingAlbumTile',
    ],
];

/** Files rendered only by a gated parent: [file, parent file, the file's component]. */
const PARENT: [string, string, string][] = [
    [
        'lbbot/components/album-request-box.tsx',
        'lbbot/routes/lbbot-external-album-route.tsx',
        'AlbumRequestBox',
    ],
    [
        'lbbot/components/find-sources-section.tsx',
        'lbbot/components/album-request-box.tsx',
        'FindSourcesSection',
    ],
];

/** The non-hook functions in use-lbbot.ts that must refuse locally while off. */
const LOCAL_REFUSALS = ['useAcquireAlbum', 'retryFill', 'allowMp3AndRetry'];

/** Whether a file is gated: it calls the hook, or its gated child / parent does. */
const gated = (file: string, seen: Set<string> = new Set()): boolean => {
    if (seen.has(file)) return false;
    seen.add(file);
    if (DIRECT.includes(file)) return read(file).includes(HOOK);
    const child = CHILD.find(([name]) => name === file);
    if (child) return read(file).includes(`<${child[2]}`) && gated(child[1], seen);
    const parent = PARENT.find(([name]) => name === file);
    if (parent) return read(parent[1]).includes(`<${parent[2]}`) && gated(parent[1], seen);
    return false;
};

const functionBody = (source: string, name: string): string => {
    const start = source.indexOf(`export const ${name} =`);
    if (start < 0) return '';
    const next = source.indexOf('\nexport ', start + 1);
    return source.slice(start, next < 0 ? undefined : next);
};

test('downloads_gate_every_surface', () => {
    for (const file of DIRECT) {
        assert.ok(read(file).includes(HOOK), `${file} does not call ${HOOK}`);
    }
    for (const [file, child, component] of CHILD) {
        assert.ok(gated(file), `${file} is not gated: no <${component}, or ${child} is not gated`);
    }
    for (const [file, parent, component] of PARENT) {
        assert.ok(
            gated(file),
            `${file} is not gated: ${parent} does not render <${component} gated`,
        );
    }
    // The pure sidebar model takes the flag from its one caller.
    assert.ok(
        read('sidebar/utils/sidebar-groups.ts').includes('ctx.downloadsShown'),
        'sidebar-groups.ts ignores downloadsShown',
    );
    const lbbot = read('lbbot/hooks/use-lbbot.ts');
    for (const name of LOCAL_REFUSALS) {
        assert.ok(
            functionBody(lbbot, name).includes('downloadsOffNow()'),
            `${name} does not refuse locally while downloading is off`,
        );
    }
});
