import { useTranslation } from 'react-i18next';

import styles from './scan.module.css';

import { type ArtistScan } from '/@/renderer/features/discography/hooks/use-artist-scan';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';

/**
 * The one Rescan control, at the filter bar's right end; its words are the scan's phase. Not for an
 * unresolved artist (Worbus P1): its Retry sits in the scan line, beside Match manually.
 */
export const RescanControl = ({ scan }: { scan: ArtistScan }) => {
    const { t } = useTranslation();
    if (scan.phase === 'unavailable' || scan.phase === 'unresolved') return null;
    const running = scan.phase === 'running';
    const disabled = running || !scan.scannable || !scan.available;
    const label = t(`naviConnect.discography.scan.control.${scan.phase}`);
    return (
        <Button
            aria-disabled={disabled}
            className={styles.control}
            data-rescan=""
            data-scan-phase={scan.phase}
            leftSection={
                running ? (
                    <span aria-hidden="true" className={styles.spin} />
                ) : (
                    <Icon icon={scan.phase === 'never' ? 'search' : 'refresh'} />
                )
            }
            onClick={disabled ? undefined : scan.start}
            size="compact-sm"
            title={
                !scan.scannable
                    ? t('naviConnect.discography.scan.unscannable')
                    : !scan.available
                      ? t('naviConnect.discography.scan.lbbotDown')
                      : undefined
            }
            variant={scan.phase === 'never' ? 'filled' : 'default'}
        >
            {label}
        </Button>
    );
};
