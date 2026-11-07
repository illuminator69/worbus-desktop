import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-228:  node --test src/renderer/features/albums/routes/album-detail-scroll.harness.ts
 *
 * Back to an album page restores its scroll offset, as the artist pages do (R4 / B-208): the
 * route persists the offset of the same scroll area it renders. The offset is keyed by the
 * history entry (react-router's location.key), so two albums, or one album opened twice, never
 * share one.
 */

test('theAlbumPagePersistsTheScrollAreaItRenders', () => {
    const source = readFileSync(new URL('./album-detail-route.tsx', import.meta.url), 'utf8');
    assert.match(source, /useNativeScrollPersist\(\{ enabled: true, scrollRef: scrollAreaRef \}\)/);
    assert.match(source, /<NativeScrollArea[\s\S]*?ref=\{scrollAreaRef\}/);
});
