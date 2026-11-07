import { useTranslation } from 'react-i18next';

import styles from './not-owned-album.module.css';

import { ReleasePill } from '/@/renderer/features/discography/components/release-pill';
import { type AlbumRequest } from '/@/renderer/features/lbbot/hooks/use-album-request';
import { caaCoverUrl } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { PreviewButton } from '/@/renderer/features/preview/components/preview-button';
import { Button } from '/@/shared/components/button/button';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';

/**
 * A choice between a release's versions or editions: up to three as a segmented control, more as a
 * Select (a sideways-scrolling bar hid editions you could not see existed).
 */
export const EditionPicker = ({
    kind,
    onChange,
    options,
    value,
}: {
    kind: 'edition' | 'version';
    onChange: (index: number) => void;
    options: string[];
    value: number;
}) => {
    const { t } = useTranslation();
    const label = kind === 'version' ? t('common.version') : t('naviConnect.missingAlbum.edition');
    const data = options.map((option, index) => ({ label: option, value: String(index) }));
    if (options.length <= 3) {
        return (
            <SegmentedControl
                aria-label={label}
                data={data}
                fullWidth
                onChange={(next) => onChange(Number(next))}
                size="xs"
                value={String(value)}
            />
        );
    }
    return (
        <Select
            aria-label={label}
            data={data}
            onChange={(next) => next !== null && onChange(Number(next))}
            value={String(value)}
        />
    );
};

/**
 * The tracklist of an album the library does not have, from MusicBrainz (board AlbumUnowned): the
 * edition picker at its head (the tracklist and the source search both follow it), then the tracks
 * with a Missing pill. No play controls; a preview only when that feature is on.
 */
export const AlbumTracklist = ({
    artist,
    request,
    rgid,
}: {
    artist: string;
    request: AlbumRequest;
    rgid: string;
}) => {
    const { t } = useTranslation();
    const { releasesQuery, tracklistQuery, variant, variants } = request;
    const tracks = tracklistQuery.data?.tracks ?? [];
    return (
        <section data-album-tracklist="">
            <h2 className={styles.label}>{t('naviConnect.albumPage.tracklist')}</h2>
            <div className={styles.pickers}>
                {releasesQuery.isLoading && <Skeleton height={30} />}
                {!releasesQuery.isLoading && !releasesQuery.data && (
                    <div>
                        <p className={styles.muted}>{t('naviConnect.albumPage.editionsUnread')}</p>
                        <Button
                            mt={6}
                            onClick={() => void releasesQuery.refetch()}
                            size="compact-sm"
                            variant="default"
                        >
                            {t('naviConnect.albumPage.tryAgain')}
                        </Button>
                    </div>
                )}
                {variants.length > 1 && (
                    <EditionPicker
                        kind="version"
                        onChange={request.setVariantIndex}
                        options={variants.map((v) =>
                            [v.title, v.disambiguation].filter(Boolean).join(' · '),
                        )}
                        value={request.variantIndex}
                    />
                )}
                {request.editions.length > 1 && (
                    <EditionPicker
                        kind="edition"
                        onChange={request.setEditionIndex}
                        options={request.editions.map((e) => e.label)}
                        value={request.editionIndex}
                    />
                )}
            </div>
            {tracklistQuery.isLoading ? (
                <>
                    <div className={styles.ghost} />
                    <div className={styles.ghost} />
                    <div className={styles.ghost} />
                </>
            ) : (
                <>
                    {tracks.map((track) => (
                        <div className={styles.track} key={`${track.position}-${track.title}`}>
                            <span className={styles.trackNumber}>{track.position}</span>
                            <span className={styles.trackTitle}>{track.title}</span>
                            <PreviewButton
                                album={variant?.title || ''}
                                artist={releasesQuery.data?.artist || artist}
                                coverUrl={variant?.coverUrl || caaCoverUrl(rgid)}
                                title={track.title}
                            />
                            <ReleasePill tone="missing">
                                {t('naviConnect.discography.pill.missing')}
                            </ReleasePill>
                        </div>
                    ))}
                    {tracklistQuery.data && tracks.length === 0 && (
                        <p className={styles.muted}>{t('naviConnect.albumPage.noTracklist')}</p>
                    )}
                    {tracklistQuery.data === null && (
                        <div data-tracklist-unread="">
                            <p className={styles.muted}>
                                {t('naviConnect.albumPage.tracklistUnread')}
                            </p>
                            <Button
                                mt={6}
                                onClick={() => void tracklistQuery.refetch()}
                                size="compact-sm"
                                variant="default"
                            >
                                {t('naviConnect.albumPage.tryAgain')}
                            </Button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
};
