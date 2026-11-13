import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-418 (the owner's re-walk of B-384, 2026-11-13): Find sources listed about 20 pages of folders
 * and the owner could not tell Björk – Debut's "Debut Live" folders from the studio ones. A card
 * showed the folder's last path segment only, and on Soulseek that is often a disc or format folder
 * ("CD1", "FLAC") whose parent carries the words that tell folders apart. A card names the last two
 * segments, the full path on hover, on every desktop source list (gap fill and album sources, both
 * through `SourceCards`).
 *
 *     node --test src/renderer/features/lbbot/components/source-folder-label.harness.ts
 */

type Label = (source: { folder: string; peer: string }) => string;

const load = async () =>
    ((await import('./source-cards-model.ts')) as unknown as { folderLabel?: Label }).folderLabel;

test('a_card_names_the_folder_and_its_parent', async () => {
    const folderLabel = await load();
    assert.ok(folderLabel, 'no folderLabel: a card names only the last segment ("CD1")');
    const at = (folder: string) => folderLabel({ folder, peer: 'peer' });
    assert.equal(at('@@abcde\\Music\\Björk\\Debut Live\\CD1'), 'Debut Live / CD1');
    assert.equal(at('Music/Björk/Björk - Debut (1993)'), 'Björk / Björk - Debut (1993)');
    assert.equal(at('Music\\Björk\\Debut Live\\'), 'Björk / Debut Live', 'a trailing slash');
    // lb-bot sends a non-admin the last segment alone; a share root is not a name.
    assert.equal(at('Debut Live'), 'Debut Live');
    assert.equal(at('@@abcde\\Debut'), 'Debut');
    assert.equal(at(''), 'peer', 'no folder: the peer');
});

test('every_desktop_source_list_shows_it_with_the_full_path_on_hover', () => {
    const cards = readFileSync(new URL('./source-cards.tsx', import.meta.url), 'utf8');
    assert.match(cards, /title=\{source\.folder\}>\s*\{folderLabel\(source\)\}/);
    for (const user of ['./gap-box.tsx', './find-sources-section.tsx']) {
        const src = readFileSync(new URL(user, import.meta.url), 'utf8');
        assert.match(src, /<SourceCards\b/, `${user} lists sources through SourceCards`);
    }
});
