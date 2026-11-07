import clsx from 'clsx';
import { ReactNode } from 'react';

import styles from './release-pill.module.css';

export type PillTone = 'active' | 'failed' | 'missing' | 'owned' | 'partly' | 'syncing';

/** One ownership or fill state, as a word on a pill (never a colour alone). */
export const ReleasePill = ({
    children,
    onCover,
    tone,
}: {
    children: ReactNode;
    onCover?: boolean;
    tone: PillTone;
}) => (
    <span className={clsx(styles.pill, onCover && styles.onCover)} data-tone={tone}>
        {children}
    </span>
);
