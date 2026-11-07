/**
 * navi-connect R11: the steps a request walks through, drawn in the missing album's box and the
 * album page's gaps box while a fill moves (Worbus for Android's `requestSteps`, RequestStage.kt). PROTOCOL
 * section 15.2 names states, not steps, so the captions are the clients' own, in en.json; a state
 * that is not a step of a running request gives no steps at all. Pure, so
 * `request-steps.harness.ts` runs it.
 */

export interface RequestStep {
    /** "3 of 12" beside the step that is moving, when the count is known. */
    count: null | { done: number; total: number };
    /** Which step; its caption is en.json's (`naviConnect.request.step*`). */
    name: StepName;
    status: StepStatus;
}

export type StepName = 'chosen' | 'downloading' | 'finding' | 'inLibrary' | 'placing' | 'queued';

export type StepStatus = 'done' | 'now' | 'pending';

const STEP_OF_STATE: Record<string, number> = {
    downloading: 2,
    placed: 4,
    placing: 3,
    queued: 1,
    searching: 0,
    verified: 5,
};

export const requestSteps = (state: string, done: number, total: number): RequestStep[] => {
    const now = STEP_OF_STATE[state];
    if (now === undefined) return [];
    const names: StepName[] = [
        state === 'searching' ? 'finding' : 'chosen',
        'queued',
        'downloading',
        'placing',
        'inLibrary',
    ];
    return names.map((name, index) => ({
        count: index === 2 && index === now && total > 0 ? { done, total } : null,
        name,
        status: index < now ? 'done' : index === now ? 'now' : 'pending',
    }));
};

/** The step a request is at, -1 when it has none: what the harness and the box's live region read. */
export const currentStep = (steps: RequestStep[]): number =>
    steps.findIndex((step) => step.status === 'now');
