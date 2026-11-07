import { useTranslation } from 'react-i18next';

import styles from './not-owned-album.module.css';

import { Button } from '/@/shared/components/button/button';
import { LbFindItLink } from '/@/shared/utils/find-it';

/**
 * "Find it" (Worbus P1, F4): where else a missing album can be found, as chip links - confirmed
 * pages filled, search links subtle, in `toFindIt`'s order. Shown in both downloads modes. Each
 * opens in the system browser (`setWindowOpenHandler` in the main process hands a `_blank` link
 * to `shell.openExternal`). No links, no section and no heading.
 */
export const FindItRow = ({ links }: { links: LbFindItLink[] | undefined }) => {
    const { t } = useTranslation();
    if (!links?.length) return null;
    return (
        <section className={styles.findIt} data-find-it="">
            <h2 className={styles.label}>{t('naviConnect.findIt.title')}</h2>
            <div className={styles.actions}>
                {links.map((link) => (
                    <Button
                        component="a"
                        data-find-it-kind={link.kind}
                        href={link.url}
                        key={link.url}
                        rel="noreferrer"
                        size="compact-sm"
                        target="_blank"
                        variant={link.kind === 'confirmed' ? 'filled' : 'subtle'}
                    >
                        {link.label}
                    </Button>
                ))}
            </div>
        </section>
    );
};
