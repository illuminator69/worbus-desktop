import { useTranslation } from 'react-i18next';

import styles from './scan.module.css';

import { type ArtistScan } from '/@/renderer/features/discography/hooks/use-artist-scan';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';

/**
 * The scan's one line, and while it runs the bar: determinate with lb-bot's counts ("6 of 10 done",
 * Worbus P1), else indeterminate (no value: the length is unknown). The block's height does not
 * change between phases (the bar's track is always there and the line keeps room for two lines),
 * so a scan starting or landing never moves the tiles below. An artist lb-bot could not find on
 * MusicBrainz (Worbus P1) offers Retry and Match manually inside that same line.
 */
export const ScanBar = ({ scan }: { scan: ArtistScan }) => {
    const { t } = useTranslation();
    if (!scan.line) return null;
    const failed = scan.phase === 'failed';
    const running = scan.phase === 'running';
    const unresolved = scan.phase === 'unresolved';
    return (
        <div
            className={styles.status}
            data-scan-status={scan.phase}
            data-steady={!failed && !unresolved}
        >
            {running ? (
                <div
                    aria-label={scan.counts?.text ?? t('naviConnect.discography.scan.barLabel')}
                    aria-valuemax={scan.counts ? 100 : undefined}
                    aria-valuemin={scan.counts ? 0 : undefined}
                    aria-valuenow={scan.counts ? Math.round(scan.counts.fraction * 100) : undefined}
                    className={styles.bar}
                    data-scan-bar=""
                    role="progressbar"
                >
                    {scan.counts ? (
                        <i
                            className={styles.barFill}
                            data-determinate="true"
                            style={{ width: `${scan.counts.fraction * 100}%` }}
                        />
                    ) : (
                        <i className={styles.barFill} />
                    )}
                </div>
            ) : (
                <div aria-hidden="true" className={styles.bar} data-hidden="true" />
            )}
            {unresolved ? (
                <div className={styles.line} data-actions="true" data-scan-unresolved="">
                    <span>{scan.line}</span>
                    <Button
                        data-scan-retry=""
                        disabled={!scan.scannable || !scan.available}
                        onClick={scan.start}
                        size="compact-sm"
                        variant="default"
                    >
                        {t('naviConnect.discography.scan.retry')}
                    </Button>
                    {scan.matchManually && (
                        <Button
                            data-scan-match=""
                            disabled={!scan.available}
                            onClick={scan.matchManually}
                            size="compact-sm"
                            variant="subtle"
                        >
                            {t('naviConnect.discography.scan.matchManually')}
                        </Button>
                    )}
                </div>
            ) : (
                <p
                    className={styles.line}
                    data-tone={failed ? 'failed' : undefined}
                    role={failed ? 'alert' : undefined}
                >
                    {failed && <Icon icon="warn" />}
                    {running && scan.counts ? `${scan.counts.text} · ${scan.line}` : scan.line}
                </p>
            )}
        </div>
    );
};
