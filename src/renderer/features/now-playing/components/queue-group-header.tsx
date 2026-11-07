import { useTranslation } from 'react-i18next';

import styles from './queue-group-header.module.css';

import { QueueGroupKind } from '/@/renderer/features/now-playing/utils/queue-grouping';

const LABEL_KEY: Record<QueueGroupKind, string> = {
    autoplay: 'naviConnect.queue.group.autoplay',
    earlier: 'naviConnect.queue.group.earlier',
    next: 'naviConnect.queue.group.upNext',
    playing: 'naviConnect.queue.group.nowPlaying',
    queued: 'naviConnect.queue.group.queuedByYou',
};

interface QueueGroupHeaderProps {
    kind: QueueGroupKind;
    /** At the right: the count (Queued by you, Up next) or the station's character or "Off" (Autoplay). */
    trail: null | string;
}

/** One group caption in the side queue (F4), spanning the table's width. */
export const QueueGroupHeader = ({ kind, trail }: QueueGroupHeaderProps) => {
    const { t } = useTranslation();
    return (
        <div className={styles.root} data-queue-group={kind}>
            <span className={styles.label}>{t(LABEL_KEY[kind])}</span>
            {trail && <span className={styles.trail}>{trail}</span>}
        </div>
    );
};
