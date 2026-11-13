import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isPrivateAddress } from '../../../shared/utils/hub-addresses.ts';
import * as pageLink from './lb-page-link.ts';

/**
 * B-406, the desktop half (owner walk, 2026-11-13):
 *   node --test src/renderer/features/lbbot/to-fix.harness.ts
 *
 * The phone's Needs attention has a "To fix" section: the imports that need the user and the
 * download folders waiting to be filed, each folder "Artist - Album · 11 files" with Open in
 * lb-bot at `<base>/#/place/<id>` (PROTOCOL §15.6). The desktop reads only `counts` from
 * `/lb/attention` (main's `lbbot-attention-counts`) and shows the imports row alone: the folders
 * were never listed, and its to-fix badge never counted them. Same units as the phone: the
 * section's number is lb-bot's `counts.imports + counts.folders`; with downloading off the folders
 * are neither listed nor counted (a folder's one action is filing a download).
 */

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

interface Folder {
    fileCount: number;
    formats: string;
    id: string;
    identified: boolean;
    matchLabel: string;
}

const rule = pageLink as unknown as {
    folderDetail?: (f: Folder) => string;
    folderTitle?: (f: Folder) => string;
    lbPlaceLink?: (
        webUrl: null | string,
        activeAddress: null | string,
        isPrivate: (a: string) => boolean,
        id: string,
    ) => null | string;
    toFixSection?: (
        attention: unknown,
        downloadsOn: boolean,
    ) => { count: number; folders: Folder[]; imports: number; moreFolders: number };
};

const shared = async () =>
    (await import('../../../shared/utils/lbbot-attention.ts').catch(() => null)) as null | {
        attentionFolders: (answer: unknown) => Folder[];
    };

const ANSWER = {
    counts: { failedGaps: 0, failedRequests: 0, folders: 25, imports: 16, picks: 0 },
    folders: [
        {
            canConfirm: true,
            confidence: 'likely',
            fileCount: 11,
            formats: 'flac',
            id: 'a1b2c3d4e5f6',
            identified: true,
            matchLabel: 'After - After EP 2',
            name: 'After EP 2 [FLAC]',
            path: '/downloads/After EP 2 [FLAC]',
        },
        { fileCount: 3, formats: '', id: 'ffffeeeedddd', identified: false, matchLabel: '' },
        { fileCount: 2, id: '' },
    ],
    truncated: { albums: 0, folders: 23 },
};

test('main_passes_the_folders_without_a_name_or_a_path', async () => {
    const mod = await shared();
    assert.ok(mod, 'nothing reads the folder rows: only the counts cross to the renderer');
    const rows = mod.attentionFolders(ANSWER);
    assert.deepEqual(rows, [
        {
            fileCount: 11,
            formats: 'flac',
            id: 'a1b2c3d4e5f6',
            identified: true,
            matchLabel: 'After - After EP 2',
        },
        { fileCount: 3, formats: '', id: 'ffffeeeedddd', identified: false, matchLabel: '' },
    ]);
    assert.deepEqual(mod.attentionFolders({ folders: 'x' }), []);
    assert.deepEqual(mod.attentionFolders(null), []);
    assert.match(
        read('src/main/features/core/lbbot/index.ts'),
        /attentionFolders\(/,
        "main's /lb/attention read keeps the counts alone",
    );
});

test('to_fix_lists_the_folders_in_the_phones_units', async () => {
    assert.equal(typeof rule.toFixSection, 'function', 'no To fix section on the desktop');
    const answer = { ...ANSWER, folders: (await shared())!.attentionFolders(ANSWER) };
    const section = rule.toFixSection!(answer, true);
    assert.equal(section.count, 41, "16 imports + 25 folders, lb-bot's counts, not the rows");
    assert.equal(section.imports, 16);
    assert.equal(section.folders.length, 2);
    assert.equal(section.moreFolders, 23);
    const off = rule.toFixSection!(answer, false);
    assert.equal(off.count, 16, 'downloading off: the folders are not counted');
    assert.equal(off.folders.length, 0);
});

test('a_folder_says_what_it_is_and_opens_lbbot_on_it', () => {
    assert.equal(typeof rule.folderTitle, 'function');
    const [identified, unknown] = [
        { fileCount: 11, formats: 'flac', id: 'a', identified: true, matchLabel: 'After - EP 2' },
        { fileCount: 1, formats: '', id: 'b', identified: false, matchLabel: 'stale' },
    ];
    // Review L3: the words are the caller's (i18n), as the To fix section passes them.
    const words = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
    const title = rule.folderTitle as unknown as (f: Folder, unidentified: string) => string;
    const detail = rule.folderDetail as unknown as (f: Folder, files: typeof words) => string;
    assert.equal(title(identified, 'Unidentified folder'), 'After - EP 2');
    assert.equal(title(unknown, 'Unidentified folder'), 'Unidentified folder');
    assert.equal(detail(identified, words), '11 files · FLAC');
    assert.equal(detail(unknown, words), '1 file');
    assert.equal(
        rule.lbPlaceLink!('https://lb.example.org/', null, isPrivateAddress, 'a1b2c3d4e5f6'),
        'https://lb.example.org/#/place/a1b2c3d4e5f6',
    );
    assert.equal(
        rule.lbPlaceLink!('', 'ws://192.168.1.20:4790', isPrivateAddress, 'a1b2c3d4e5f6'),
        'http://192.168.1.20:8899/#/place/a1b2c3d4e5f6',
    );
    assert.equal(rule.lbPlaceLink!('', 'wss://hub.example.org', isPrivateAddress, 'x'), null);
});

test('the_badge_counts_the_folders_and_the_page_shows_them', () => {
    const ledger = [{ outcome: 'failed', settled: true }];
    const toFixCount = pageLink.toFixCount as unknown as (
        l: typeof ledger,
        a: unknown,
        downloadsOn?: boolean,
    ) => number;
    assert.equal(toFixCount(ledger, ANSWER), 1 + 16 + 25, 'the badge leaves the folders out');
    assert.equal(toFixCount(ledger, ANSWER, false), 1 + 16);
    assert.match(
        read('src/renderer/features/lbbot/routes/lbbot-downloads-route.tsx'),
        /<ToFixSection/,
        'the Downloads page shows the imports row alone',
    );
});

/**
 * B-406 review L3: lb-bot's folder id is 12 lowercase hex characters (`_download_folder_id`);
 * anything else would draw a dead Open in lb-bot. And the folder's words are i18n'd like their
 * neighbours.
 */
test('only_a_folder_id_lbbot_could_have_made_is_listed', async () => {
    const mod = (await shared())!;
    const rows = mod.attentionFolders({
        folders: [
            { fileCount: 1, id: 'a1b2c3d4e5f6' },
            { fileCount: 1, id: 'A1B2C3D4E5F6' },
            { fileCount: 1, id: 'a1b2c3d4e5' },
            { fileCount: 1, id: 'a1b2c3d4e5f6/../x' },
            { fileCount: 1, id: 'g1b2c3d4e5f6' },
        ],
    });
    assert.deepEqual(
        rows.map((r) => r.id),
        ['a1b2c3d4e5f6'],
    );
});

test('the_folder_words_come_from_the_caller', () => {
    const f = { fileCount: 1, formats: 'flac', id: 'a', identified: false, matchLabel: '' };
    const title = rule.folderTitle as unknown as (f: Folder, unidentified: string) => string;
    const detail = rule.folderDetail as unknown as (
        f: Folder,
        files: (count: number) => string,
    ) => string;
    assert.equal(title(f, 'Dossier non identifié'), 'Dossier non identifié');
    assert.equal(
        detail({ ...f, fileCount: 3 }, (n) => `${n} fichiers`),
        '3 fichiers · FLAC',
    );
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    assert.equal(en.naviConnect.toFix.unidentified, 'Unidentified folder');
    assert.equal(en.naviConnect.toFix.files_one, '{{count}} file');
    assert.equal(en.naviConnect.toFix.files_other, '{{count}} files');
});
