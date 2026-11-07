import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    activityPageCopy,
    failedRowWishlistExplain,
    wishlistEmptyLine,
    wishlistRowLines,
} from './wishlist-copy.ts';

/**
 * Worbus P1, lane F (F3):  node --test src/renderer/features/lbbot/components/wishlist-copy.harness.ts
 *
 * What the Wishlist page says per row and when empty, in both modes. The picker answers en.json
 * keys; this resolves them against en.json itself (i18next's `_one` / `_other` plural and
 * `{{name}}` interpolation), so the words checked are the words shown. While downloading is off
 * nothing says it searches (Worbus for Android's sentence, lane N ruling 1); while on (or unknown, an older
 * peer) the copy is today's, byte for byte.
 */

const en = JSON.parse(
    readFileSync(new URL('../../../../i18n/locales/en.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const lookup = (path: string): string => {
    let node: unknown = en;
    for (const part of path.split('.')) node = (node as Record<string, unknown>)?.[part];
    assert.equal(typeof node, 'string', `en.json has no string at ${path}`);
    return node as string;
};

const resolve = (line: { key: string; values?: Record<string, number> }): string => {
    const count = line.values?.count;
    const key = count === undefined ? line.key : `${line.key}_${count === 1 ? 'one' : 'other'}`;
    return lookup(key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(line.values?.[name] ?? ''),
    );
};

const BANNED = ['download', 'source', 'soulseek', 'peer', 'looking', 'searches', 'looked', 'tried'];

test('wishlist_copy_off_has_no_searching_words', () => {
    const texts: string[] = [];
    for (const attempts of [0, 1, 7]) {
        const lines = wishlistRowLines(false, { attempts, lastReason: 'No peer had it.' });
        texts.push(resolve(lines.status));
        // No attempts and no reason while off: lb-bot is not looking.
        assert.equal(lines.reason, null);
    }
    for (const hours of [0, 1, 6]) texts.push(resolve(wishlistEmptyLine(false, hours)));
    assert.equal(texts[0], 'Saved for when your server can get albums');
    assert.equal(texts[3], 'Nothing on the wishlist. Add a missing album to keep it here.');
    for (const text of texts) {
        for (const word of BANNED) {
            assert.ok(!text.toLowerCase().includes(word), `"${text}" says "${word}"`);
        }
    }
});

test('wishlist_copy_on_unchanged', () => {
    const row = (attempts: number, lastReason = '') =>
        wishlistRowLines(true, { attempts, lastReason });
    assert.equal(resolve(row(0).status), 'Waiting for the first re-search');
    assert.equal(resolve(row(1).status), 'Still looking - 1 search so far');
    assert.equal(resolve(row(4).status), 'Still looking - 4 searches so far');
    assert.equal(row(4, 'No peer had it.').reason, 'No peer had it.');
    assert.equal(row(4).reason, null);
    assert.equal(
        resolve(wishlistEmptyLine(true, 6)),
        'Nothing on the wishlist. When a download fails because nobody is sharing an album, you can put it here and lb-bot will keep looking every 6 hours.',
    );
    assert.equal(
        resolve(wishlistEmptyLine(true, 0)),
        'Nothing on the wishlist. When a download fails because nobody is sharing an album, you can put it here and lb-bot will keep looking periodically.',
    );
});

// Worbus P1 (review 5): the Downloads page while downloading is off is Activity (the sidebar's
// name for it), and its empty line says none of the searching words. On, it is today's page.

test('activity_copy_off_has_no_searching_words', () => {
    const off = activityPageCopy(false);
    const texts = [resolve(off.title), resolve(off.empty)];
    assert.equal(texts[0], 'Activity');
    assert.equal(texts[1], 'Nothing here yet.');
    for (const text of texts) {
        for (const word of BANNED) {
            assert.ok(!text.toLowerCase().includes(word), `"${text}" says "${word}"`);
        }
    }
});

test('activity_copy_on_unchanged', () => {
    const on = activityPageCopy(true);
    assert.equal(resolve(on.title), 'Downloads');
    assert.equal(
        resolve(on.empty),
        'Nothing yet. Albums you ask lb-bot to fetch show up here while they download, and stay until you dismiss them.',
    );
});

// F7 walk: a failed row that offers the wishlist explains it. While on, lb-bot keeps looking for a
// wishlisted album; while off it only keeps it, and the sentence must not promise a search.

test('failed_row_wishlist_explain_off_has_no_searching_words', () => {
    const text = failedRowWishlistExplain(false);
    assert.equal(text, 'Add it to the wishlist to keep it for when your server can get albums.');
    for (const word of BANNED) {
        assert.ok(!text.toLowerCase().includes(word), `"${text}" says "${word}"`);
    }
});

test('failed_row_wishlist_explain_on_unchanged', () => {
    assert.equal(
        failedRowWishlistExplain(true),
        'Nobody had it this time. The swarm changes — add it to the wishlist and lb-bot will keep looking every few hours.',
    );
});
