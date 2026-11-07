import { useTranslation } from 'react-i18next';

import discographyStyles from './discography.module.css';
import styles from './scan.module.css';

const GhostTile = ({ subline, width }: { subline: boolean; width: string }) => (
    <div className={styles.ghostTile}>
        <div className={`${styles.ghost} ${styles.ghostCover}`} />
        <div className={`${styles.ghost} ${styles.ghostText}`} style={{ width }} />
        {subline && <div className={`${styles.ghost} ${styles.ghostSub}`} />}
    </div>
);

/**
 * A first scan's placeholder, shaped like the answer (board ArtistScan): a section heading and a row
 * of five, a shorter heading and two. The real sections replace it in the same container.
 */
export const GhostSections = ({ itemsPerRow }: { itemsPerRow: number }) => {
    const { t } = useTranslation();
    const grid = { '--items-per-row': itemsPerRow } as React.CSSProperties;
    return (
        <div
            aria-label={t('naviConnect.discography.scan.ghostLabel')}
            data-ghost-sections=""
            role="status"
        >
            <div className={`${styles.ghost} ${styles.ghostHead}`} />
            <div className={discographyStyles.grid} style={grid}>
                {['80%', '70%', '85%', '60%', '75%'].map((width, index) => (
                    <GhostTile key={index} subline width={width} />
                ))}
            </div>
            <div className={`${styles.ghost} ${styles.ghostHead} ${styles.ghostHeadShort}`} />
            <div className={discographyStyles.grid} style={grid}>
                <GhostTile subline={false} width="80%" />
                <GhostTile subline={false} width="65%" />
            </div>
        </div>
    );
};
