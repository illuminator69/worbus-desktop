import assert from 'node:assert/strict';
import test from 'node:test';

import { currentStep, requestSteps } from './request-steps.ts';

/**
 * R11: a request's five steps, after Worbus for Android's `requestSteps`.
 *
 *     node --test src/renderer/features/lbbot/request-steps.harness.ts
 */

test('each running state is one step', () => {
    assert.equal(currentStep(requestSteps('searching', 0, 0)), 0);
    assert.equal(currentStep(requestSteps('queued', 0, 0)), 1);
    assert.equal(currentStep(requestSteps('downloading', 0, 0)), 2);
    assert.equal(currentStep(requestSteps('placing', 0, 0)), 3);
    assert.equal(currentStep(requestSteps('placed', 0, 0)), 4);
});

test('verified has every step done', () => {
    const steps = requestSteps('verified', 0, 0);
    assert.equal(currentStep(steps), -1);
    assert.ok(steps.every((step) => step.status === 'done'));
});

test('a state that is not a step of a running request gives none', () => {
    assert.deepEqual(requestSteps('failed', 0, 0), []);
    assert.deepEqual(requestSteps('', 0, 0), []);
    assert.deepEqual(requestSteps('cancelled', 0, 0), []);
});

test('the first step says whether the source is still being found', () => {
    // Review minor 9: the captions are en.json's; the model names the step.
    assert.equal(requestSteps('searching', 0, 0)[0].name, 'finding');
    assert.equal(requestSteps('queued', 0, 0)[0].name, 'chosen');
    assert.deepEqual(
        requestSteps('placed', 0, 0).map((step) => step.name),
        ['chosen', 'queued', 'downloading', 'placing', 'inLibrary'],
    );
});

test('the count rides on Downloading only while it is the step that moves', () => {
    assert.deepEqual(requestSteps('downloading', 3, 12)[2].count, { done: 3, total: 12 });
    assert.equal(requestSteps('downloading', 0, 0)[2].count, null);
    assert.equal(requestSteps('placing', 12, 12)[2].count, null);
});
