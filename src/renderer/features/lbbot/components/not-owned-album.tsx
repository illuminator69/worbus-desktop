import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './not-owned-album.module.css';

import { AlbumTracklist } from '/@/renderer/features/lbbot/components/album-tracklist';
import { FindItRow } from '/@/renderer/features/lbbot/components/find-it-row';
import { MetaAbout } from '/@/renderer/features/lbbot/components/meta-about';
import { type AlbumRequest } from '/@/renderer/features/lbbot/hooks/use-album-request';
import { LbBotMeta } from '/@/shared/types/lbbot-types';

/**
 * The body of the page for an album the library does not have (board AlbumUnowned, B-169): the one
 * request box under the hero (R11: Find sources folds it open into the search, the cards, then the
 * request), then About (read this first) beside the MusicBrainz tracklist.
 */
export const NotOwnedAlbum = ({
    artist,
    meta,
    request,
    requestBox,
    rgid,
}: {
    artist: string;
    meta: LbBotMeta | null | undefined;
    request: AlbumRequest;
    /** The one request box (sources, then the request). */
    requestBox?: ReactNode;
    rgid: string;
}) => {
    const { t } = useTranslation();
    const hasAbout = !!meta && (meta.paragraphs.length > 0 || !!meta.summary);
    return (
        <div className={styles.body} data-not-owned-album="">
            {requestBox}
            <div className={styles.columns}>
                <section data-album-about="">
                    <h2 className={styles.label}>
                        {t('naviConnect.albumPage.about')}{' '}
                        <small>{t('naviConnect.albumPage.aboutFirst')}</small>
                    </h2>
                    {hasAbout ? (
                        <MetaAbout meta={meta!} />
                    ) : (
                        // No About from lb-bot (none written, or an lb-bot too old to say): said once,
                        // never as an error.
                        <p className={styles.muted}>{t('naviConnect.albumPage.noAbout')}</p>
                    )}
                    {/* Worbus P1: a section of its own below About, drawn only once the read
                        has answered with links, so nothing above it moves. */}
                    <FindItRow links={meta?.findIt} />
                </section>
                <AlbumTracklist artist={artist} request={request} rgid={rgid} />
            </div>
            <p className={styles.muted}>{t('naviConnect.albumPage.noPlay')}</p>
        </div>
    );
};
