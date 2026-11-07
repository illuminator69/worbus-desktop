import { CSSProperties, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import columns from '/@/renderer/features/discography/components/artist-columns.module.css';
import { Discography } from '/@/renderer/features/discography/components/discography';
import { SimilarArtistList } from '/@/renderer/features/discography/components/similar-artist-list';
import { LbBotIndexButton } from '/@/renderer/features/lbbot/components/lbbot-index-button';
import { MetaAbout } from '/@/renderer/features/lbbot/components/meta-about';
import {
    useLbBotArtistMeta,
    useLbBotAvailable,
    useLbBotDiscography,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ForkDetailPage } from '/@/renderer/features/shared/components/fork-detail-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * navi-connect: an artist page for someone the library has nothing by.
 *
 * Keyed on the MusicBrainz artist id in the `mb:` form lb-bot's own scan already
 * understands — `api_artist_discography` treats an `mb:`-prefixed `nd_id` as
 * external, skips the library match, and classifies everything `missing`.
 *
 * The discography is the **same** component the owned artist page renders (F7),
 * over the same model, so the two pages' kinds cannot drift apart.
 */

const LbBotExternalArtistRoute = () => {
    const { artistMbid } = useParams() as { artistMbid: string };
    const [search] = useSearchParams();

    const { t } = useTranslation();
    const ndId = `mb:${artistMbid}`;
    const available = useLbBotAvailable();
    // From the local index mirror when lb-bot has indexed this artist — looked up
    // by the MBID first, exactly as lb-bot's own read does for an `mb:` id — so
    // an artist scanned once renders at once, offline included. The network
    // read is the fallback for one it has not.
    const discography = useLbBotDiscography(artistMbid ? ndId : '', artistMbid);
    // A disabled react-query stays `pending`, so gate the spinner on lb-bot actually
    // being there — otherwise this page spins forever with the feature switched off.
    const loading = available && discography.isLoading;
    // lb-bot's own name for the artist once it has scanned them; the link that got
    // here carries one meanwhile.
    const artistName = discography.data?.artistName || search.get('name') || '';

    // On an unowned artist lb-bot is the ONLY possible source of an About:
    // there is no Navidrome record to carry a biography, so no metadata agent
    // can ever answer for this page. That is the reason the editorial layer
    // lives in lb-bot rather than in a Navidrome plugin, and until now it was
    // the one page that never showed it.
    //
    // Nothing here can flash: there is no competing text to arrive first.
    const meta = useLbBotArtistMeta(artistMbid, artistName).data;

    const releaseCount = discography.data?.indexed ? discography.data.releases.length : null;
    const links = [
        ...(meta?.links ?? []).filter((link) => !/musicbrainz\.org/.test(link.url)),
        {
            label: 'MusicBrainz',
            type: 'musicbrainz',
            url: `https://musicbrainz.org/artist/${artistMbid}`,
        },
    ];

    return (
        <ForkDetailPage
            headerChildren={
                // Only what the page knows: the count lb-bot's index holds (no type or years are
                // carried for an artist, so none are drawn).
                releaseCount !== null ? (
                    <Text className={columns.heroMeta} isMuted>
                        {t('naviConnect.artistPage.releasesFromMusicBrainz', {
                            count: releaseCount,
                        })}
                    </Text>
                ) : undefined
            }
            itemType={LibraryItem.ALBUM_ARTIST}
            kicker={t('naviConnect.artistPage.kickerNotOwned')}
            plain
            route={AppRoute.LIBRARY_ALBUM_ARTISTS}
            title={artistName || 'Artist'}
        >
            {/* Not while the mirror is answering: a discography
                already on screen is the one thing this sentence
                would contradict. */}
            {!available && !discography.data && (
                <Text isMuted>
                    lb-bot is not configured on your hub, so there is nothing to read this
                    discography from.
                </Text>
            )}

            {loading && <Spinner container />}

            {/* F7: the owned page's two columns. One column below 960 px: About first, as before. */}
            <div className={columns.layout} data-main="true">
                <div className={columns.main}>
                    {available || discography.data ? (
                        <div
                            className={columns.item}
                            style={{ '--order-narrow': 2 } as CSSProperties}
                        >
                            <Discography
                                artistMbid={artistMbid}
                                artistName={artistName}
                                menu={
                                    <LbBotIndexButton
                                        artistMbid={artistMbid}
                                        artistName={artistName}
                                        discography={discography.data}
                                        ndId={ndId}
                                    />
                                }
                                ndId={ndId}
                                owned={null}
                            />
                        </div>
                    ) : null}
                </div>
                <div className={columns.side}>
                    {meta && (
                        <section
                            className={columns.item}
                            style={{ '--order-narrow': 1 } as CSSProperties}
                        >
                            <h2 className={columns.sideLabel}>
                                {t('naviConnect.artistPage.about')}
                            </h2>
                            <MetaAbout meta={meta} showLinks={false} />
                        </section>
                    )}
                    <div className={columns.item} style={{ '--order-narrow': 3 } as CSSProperties}>
                        <SimilarArtistList mbid={artistMbid} name={artistName} />
                    </div>
                    <section
                        className={columns.item}
                        style={{ '--order-narrow': 4 } as CSSProperties}
                    >
                        <h2 className={columns.sideLabel}>{t('naviConnect.artistPage.links')}</h2>
                        <div className={columns.links}>
                            {links.map((link) => (
                                <a
                                    className={columns.link}
                                    href={link.url}
                                    key={link.url}
                                    rel="noreferrer"
                                    target="_blank"
                                >
                                    {link.label}
                                </a>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </ForkDetailPage>
    );
};

const LbBotExternalArtistRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotExternalArtistRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotExternalArtistRouteWithBoundary;
