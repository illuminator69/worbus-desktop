import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { arrowMoveValue, nextRating } from './rating-logic.ts';

/**
 * The shared Rating's keyboard and timing (B-259, B-260, B-368):
 *   node --test src/shared/components/rating/rating.harness.ts
 *
 * B-259: arrow keys changed no rating anywhere. Chromium moves between radio inputs with an arrow by
 * checking the next input and firing a click on it; the wrapper's root `onClick` prevented the
 * default of every click (it keeps a click on a star from reaching a card's link), so the move was
 * cancelled, and Mantine only previews an arrow move anyway (`handleInputChange` sets the hover). The
 * stars are a radio group: an arrow now sets the rating, as a radio group's arrow selects.
 * B-368: the wrapper made a new `debounce()` every render, so two changes were never merged across
 * renders, and a delayed call decided "the same star again clears it" against the value of the
 * render it was made in. One debounce per Rating now, deciding against the value when it fires.
 * B-260: five ratings still went `readOnly` while a save ran, which removes the inputs and drops a
 * keyboard user's focus; they pass `busy` (inputs kept, a change dropped) as the table's does.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const radio = (value: string) => ({ tagName: 'INPUT', type: 'radio', value });

test('an_arrow_move_sets_the_star_it_lands_on', () => {
    assert.equal(arrowMoveValue(radio('4'), 'ArrowRight'), 4);
    assert.equal(arrowMoveValue(radio('2'), 'ArrowLeft'), 2);
    assert.equal(arrowMoveValue(radio('3'), 'ArrowUp'), 3);
    assert.equal(arrowMoveValue(radio('1'), 'ArrowDown'), 1);
});

test('a_click_that_is_not_an_arrow_move_is_mantines', () => {
    // Space on a star: Mantine's keydown sets it, the click that follows must not set it again.
    assert.equal(arrowMoveValue(radio('4'), ' '), null);
    // A pointer's click lands on the label or the star, never on the hidden input.
    assert.equal(arrowMoveValue({ tagName: 'svg' }, null), null);
    assert.equal(arrowMoveValue({ tagName: 'LABEL' }, 'ArrowRight'), null);
    assert.equal(arrowMoveValue(radio('x'), 'ArrowRight'), null);
});

test('the_same_star_again_clears_it', () => {
    assert.equal(nextRating(3, 3), 0);
    assert.equal(nextRating(4, 3), 4);
    assert.equal(nextRating(2, null), 2);
});

test('one_debounce_per_rating_deciding_when_it_fires', () => {
    const src = read('./rating.tsx');
    const body = src.slice(src.indexOf('export const Rating'));
    assert.doesNotMatch(
        body,
        /const debouncedOnChange = debounce\(/,
        'a new debounce on every render',
    );
    assert.match(body, /arrowMoveValue\(/, 'an arrow move is cancelled');
});

test('no_rating_drops_its_inputs_while_saving', () => {
    for (const file of [
        '../../../renderer/components/item-card/item-card-controls.tsx',
        '../../../renderer/components/item-list/item-detail-list/columns/rating-column.tsx',
        '../../../renderer/components/item-list/item-table-list/album-group-controls.tsx',
        '../../../renderer/features/shared/components/hero-actions.tsx',
        '../../../renderer/features/shared/components/library-header.tsx',
    ]) {
        assert.doesNotMatch(read(file), /readOnly=\{isMutatingRating\}/, file);
    }
});
