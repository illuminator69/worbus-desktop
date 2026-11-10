import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

/**
 * W1 (B-305, B-367, B-371):  node --test src/renderer/store/play-order-guard.harness.ts
 *
 * `player.index` is a PLAY POSITION: with track shuffle on it is a position in
 * `queue.shuffled`, and `queue.shuffled[player.index]` is the playing row. Read raw anywhere
 * else it was taken for a row of the queue: the hub's `setQueue` named another song (B-305),
 * the saved-queue card and Navidrome's `savePlayQueue` saved the wrong current song and
 * "Go to current" scrolled to the wrong row (B-367, B-371).
 *
 * So the field is private to `src/renderer/store/`: everything else reads it through
 * `playingQueueIndex` (the playing row), `playOrder` (rows in play order) or `playPosition`
 * (the play position, for code that walks the play order). ESLint says the same
 * (`no-restricted-syntax` in eslint.config.mjs); this walks the source so the rule holds
 * where nobody runs the linter. Comments and strings are not reads: this parses the code.
 */

const RENDERER = new URL('../', import.meta.url).pathname;
const STORE = new URL('./', import.meta.url).pathname;

const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.tsx?$/.test(name) && !/\.harness\.ts$/.test(name) ? [path] : [];
    });

/** `x.player.index`, `player.index`, and `const { index } = x.player`. */
const rawReads = (path: string, text = readFileSync(path, 'utf8')): string[] => {
    const file = ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const isPlayer = (node: ts.Expression): boolean =>
        (ts.isIdentifier(node) && node.text === 'player') ||
        (ts.isPropertyAccessExpression(node) && node.name.text === 'player');
    const hits: string[] = [];
    const where = (node: ts.Node) =>
        `${relative(RENDERER, path)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const visit = (node: ts.Node) => {
        if (
            ts.isPropertyAccessExpression(node) &&
            node.name.text === 'index' &&
            isPlayer(node.expression)
        ) {
            hits.push(where(node));
        }
        if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            isPlayer(node.initializer) &&
            ts.isObjectBindingPattern(node.name) &&
            node.name.elements.some(
                (element) => (element.propertyName ?? element.name).getText(file) === 'index',
            )
        ) {
            hits.push(where(node));
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return hits;
};

const readsIn = (code: string): string[] => rawReads(join(RENDERER, 'probe.ts'), code);

test('no raw player.index read outside src/renderer/store', () => {
    const reads = sources(RENDERER)
        .filter((path) => !path.startsWith(STORE))
        .flatMap((path) => rawReads(path));
    assert.deepEqual(reads, [], `raw player.index reads:\n${reads.join('\n')}`);
});

test('the walker finds each form it guards (a guard that sees nothing proves nothing)', () => {
    const probe = join(STORE, 'player.store.ts');
    assert.ok(rawReads(probe).length > 10, 'the store itself reads its own field');
});

test('the walker sees every way to the field, aliases included (review 2026-11-10)', () => {
    const probe = [
        's.player.index;',
        's.player?.index;',
        "s.player['index'];",
        'const { index } = s.player;',
        'const { player } = s; player.index;',
        'const p = s.player;',
        'const { player: { index: i } } = s;',
        'const { player: q } = s;',
    ];
    for (const line of probe) {
        assert.equal(readsIn(line).length, 1, line);
    }
    // Other fields of the player slice, and `index` elsewhere, are not reads of it.
    for (const line of [
        's.player.status;',
        'const { player } = s; player.volume;',
        's.queue.index;',
        'row.index;',
    ]) {
        assert.equal(readsIn(line).length, 0, line);
    }
});
