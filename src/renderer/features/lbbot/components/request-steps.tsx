import { useTranslation } from 'react-i18next';

import styles from './request-steps.module.css';

import { type RequestStep, type StepName } from '/@/renderer/features/lbbot/request-steps';
import { Icon } from '/@/shared/components/icon/icon';

/** A step's caption, from en.json (the model names the step; review minor 9). */
const useStepCaption = () => {
    const { t } = useTranslation();
    return (name: StepName): string => {
        switch (name) {
            case 'chosen':
                return t('naviConnect.request.stepChosen');
            case 'downloading':
                return t('naviConnect.request.stepDownloading');
            case 'finding':
                return t('naviConnect.request.stepFinding');
            case 'inLibrary':
                return t('naviConnect.request.stepInLibrary');
            case 'placing':
                return t('naviConnect.request.stepPlacing');
            case 'queued':
                return t('naviConnect.request.stepQueued');
        }
    };
};

/** A request's steps, one row each (Worbus for Android's `RequestSteps`): done ticked, the moving one spinning. */
export const RequestSteps = ({ steps }: { steps: RequestStep[] }) => {
    const { t } = useTranslation();
    const caption = useStepCaption();
    return (
        <ol className={styles.steps} data-request-steps="">
            {steps.map((step) => (
                <li
                    aria-current={step.status === 'now' ? 'step' : undefined}
                    className={styles.step}
                    data-status={step.status}
                    key={step.name}
                >
                    <span aria-hidden="true" className={styles.mark}>
                        {step.status === 'done' && <Icon icon="check" size="xs" />}
                    </span>
                    <span className={styles.label}>{caption(step.name)}</span>
                    {step.count && (
                        <span className={styles.detail}>
                            {t('naviConnect.request.stepCount', step.count)}
                        </span>
                    )}
                </li>
            ))}
        </ol>
    );
};
