import type { RowKeys } from '/@/renderer/features/library/components/artist-row';
import type { CSSProperties, KeyboardEvent } from 'react';

import { useTranslation } from 'react-i18next';

import styles from './link-row.module.css';

import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';

interface LinkRowProps {
    host: string;
    index: number;
    /** lb-bot's own sentence when it could not open the link; empty otherwise. */
    message: string;
    onKeys: RowKeys;
    onOpen: () => void;
    pending: boolean;
    style?: CSSProperties;
    tabbable: boolean;
}

/**
 * F6: a pasted link in the Library field (design brief 7.2): one row, resolved only when pressed (or
 * Enter in the field), never as it is typed.
 */
export const LinkRow = ({
    host,
    index,
    message,
    onKeys,
    onOpen,
    pending,
    style,
    tabbable,
}: LinkRowProps) => {
    const { t } = useTranslation();
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (!pending) onOpen();
            return;
        }
        onKeys(event, index);
    };
    return (
        <div style={style}>
            <div
                aria-busy={pending}
                className={styles.row}
                data-library-link-row
                data-row-index={index}
                onKeyDown={onKeyDown}
                role="group"
                tabIndex={tabbable ? 0 : -1}
            >
                <span aria-hidden className={styles.icon}>
                    <Icon icon="externalLink" size="lg" />
                </span>
                <span className={styles.text}>
                    <span className={styles.name}>{t('page.library.openLink')}</span>
                    <span className={styles.line}>{message || host}</span>
                </span>
                <Button
                    disabled={pending}
                    loading={pending}
                    onClick={onOpen}
                    size="xs"
                    tabIndex={-1}
                    variant="filled"
                >
                    {t('page.library.open')}
                </Button>
            </div>
        </div>
    );
};
