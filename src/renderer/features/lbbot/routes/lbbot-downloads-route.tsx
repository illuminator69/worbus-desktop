import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import styles from './lbbot-downloads-route.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { allows } from '/@/renderer/features/hub/utils/hub-roles';
import { ResolveLinkBox } from '/@/renderer/features/lbbot/components/resolve-link-box';
import { activityPageCopy } from '/@/renderer/features/lbbot/components/wishlist-copy';
import { WishlistList } from '/@/renderer/features/lbbot/components/wishlist-list';
import { describeFill } from '/@/renderer/features/lbbot/fill-vocabulary';
import { useFillActions } from '/@/renderer/features/lbbot/hooks/use-fill-actions';
import {
    caaCoverUrl,
    useLbBotAttention,
    useLbBotDownloadsShown,
    useLbBotWishlist,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useNeedYou } from '/@/renderer/features/lbbot/hooks/use-need-you';
import { libraryToFixCount } from '/@/renderer/features/lbbot/lb-page-link';
import { LedgerRow, useFillLedger } from '/@/renderer/features/lbbot/stores/active-fills.store';
import {
    FILTER_LABEL,
    FILTER_ORDER,
    LEDGER_MATCHES,
    LedgerFilter,
} from '/@/renderer/features/lbbot/utils/activity-filters';
import {
    drawnRow,
    NeedYouServerEntry,
    serverLedgerRow,
} from '/@/renderer/features/lbbot/utils/need-you';
import { Fold } from '/@/renderer/features/motion/fold';
import { ForkListPage } from '/@/renderer/features/shared/components/fork-list-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { useHubRoles } from '/@/renderer/store/hub.store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Progress } from '/@/shared/components/progress/progress';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * navi-connect: everything lb-bot has been asked to fetch from Soulseek, in flight
 * and finished.
 *
 * A fill takes minutes — search, transfer, tagging, placement, then Navidrome's own
 * scan — and until now it was visible *only* from the artist page that started it.
 * Navigate away and there was no way to see it, no way to know it had failed, and no
 * way to ask again.
 *
 * Nothing here polls. The ledger watcher mounted at the app root reads every
 * unsettled row in one request whether or not this page is open — this view used
 * to watch only the rows that passed its filter, so choosing "Didn't land" stopped
 * the fills in flight from being polled at all. Every word and every button comes
 * from `describeFill` (PROTOCOL §15.2), the table Worbus for Android renders from too.
 */

/** A one-second clock for the countdowns and "last checked Ns ago". */
const useNow = (): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
};

const FillRow = ({ now, row }: { now: number; row: LedgerRow }) => {
    // F7: the same actions as the album page's request box, so one row offers the same buttons.
    const { busy, label, run, shown } = useFillActions(row);
    const downloadsShown = useLbBotDownloadsShown();
    const view = describeFill(row, now, downloadsShown);
    const failed = row.settled && row.outcome !== 'done';

    return (
        <div className={styles.row}>
            {/* Cover art straight from the Archive: lb-bot's own cover route serves
                Navidrome art keyed by a Navidrome album id, which a release the library
                lacks does not have. The app's image, so a release with no Archive cover
                shows the album placeholder (it showed a broken-image icon), and a row with
                no release id keeps the same slot. */}
            <ItemImage
                className={styles.image}
                containerClassName={styles.cover}
                itemType={LibraryItem.ALBUM}
                src={row.rgid ? caaCoverUrl(row.rgid) : null}
                type="table"
            />
            <Stack className={styles.body} gap="0.15rem">
                <Text isNoSelect lineClamp={1}>
                    {row.album || row.artist || row.key}
                </Text>
                <Text isMuted={!failed} size="sm">
                    {row.artist && row.album ? `${row.artist} — ` : ''}
                    {view.headline}
                </Text>
                {view.progress === 'determinate' && <Progress size="xs" value={view.percent} />}
                {view.progress === 'indeterminate' && (
                    <Progress animated size="xs" striped value={100} />
                )}
                {/* lb-bot's own sentence, verbatim, is among these: it is the
                    only thing that separates "no peer had it" from "every
                    source was rejected for format". */}
                {view.sublines.map((line, index) => (
                    <Text isMuted key={index} lineClamp={3} size="sm">
                        {line}
                    </Text>
                ))}
                {view.explain && (
                    <Text isMuted size="sm">
                        {view.explain}
                    </Text>
                )}
            </Stack>
            <Group gap="xs">
                {shown(view.buttons).map((button) => (
                    <Button
                        disabled={busy && button !== 'dismiss'}
                        key={button}
                        onClick={() => run(button)}
                        variant="subtle"
                    >
                        {label(button)}
                    </Button>
                ))}
            </Group>
        </div>
    );
};

/**
 * A request lb-bot lists that this device holds no row of: drawn with the ledger's own words
 * (`describeFill`) from lb-bot's state, with Open album alone - no Retry, Cancel or Dismiss, as
 * PROTOCOL §15.6 says of a row only lb-bot knows. lb-bot's rows carry no device, so the row does
 * not say whose it is (review M1): a failed request is "Requested elsewhere", a gap is lb-bot's.
 */
const ServerRow = ({ now, req }: { now: number; req: NeedYouServerEntry }) => {
    const row = serverLedgerRow(req);
    const view = describeFill(row, now, true);
    const to = req.albumId
        ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: req.albumId })
        : req.rgid
          ? generatePath(AppRoute.EXTERNAL_ALBUM_DETAIL, { rgid: req.rgid })
          : null;
    return (
        <div className={styles.row}>
            <ItemImage
                className={styles.image}
                containerClassName={styles.cover}
                itemType={LibraryItem.ALBUM}
                src={req.rgid ? caaCoverUrl(req.rgid) : null}
                type="table"
            />
            <Stack className={styles.body} gap="0.15rem">
                <Text isNoSelect lineClamp={1}>
                    {req.album || req.artist || row.key}
                </Text>
                <Text size="sm">
                    {req.artist && req.album ? `${req.artist} — ` : ''}
                    {view.headline}
                </Text>
                {view.sublines.map((line, index) => (
                    <Text isMuted key={index} lineClamp={3} size="sm">
                        {line}
                    </Text>
                ))}
                <Text isMuted size="sm">
                    {req.source === 'attention' && req.gap
                        ? "From lb-bot's gaps."
                        : 'Requested elsewhere.'}
                </Text>
            </Stack>
            <Group gap="xs">
                {to && (
                    <Button component={Link} to={to} variant="subtle">
                        Open album
                    </Button>
                )}
            </Group>
        </div>
    );
};

/** The page's sections: the ledger's filters, then the wishlist. */
type DownloadsSection = 'wishlist' | LedgerFilter;

/**
 * The ledger's filters (`activity-filters.ts`). Deliberately component state rather than a
 * persisted setting: "show me the failures" is a thing you want for the next thirty seconds, and a
 * filter that survives a restart is a downloads page that looks empty for reasons the user has long
 * forgotten choosing.
 */
const MATCHES = LEDGER_MATCHES;

export const LbBotDownloadsPage = ({
    initialSection = 'all',
}: {
    initialSection?: DownloadsSection;
}) => {
    const rows = useFillLedger();
    const [section, setSection] = useState<DownloadsSection>(initialSection);
    const wishlist = useLbBotWishlist();
    const wishlistCount = wishlist.data?.entries.length;
    const filter: LedgerFilter = section === 'wishlist' ? 'all' : section;
    const shown = rows.filter(MATCHES[filter]);
    // The owner, 2026-11-13: Need you is every client's requests that need someone, from any
    // client - the sidebar badge's set (`useNeedYou`).
    const needYou = useNeedYou();
    const shownCount = filter === 'needsYou' ? needYou.length : shown.length;
    const now = useNow();
    // Worbus P1: with downloading off the ledger is history to read: no paste-a-link box (a pasted
    // link is an acquisition); the rows lose their fetching buttons (`useFillActions`).
    const downloadsShown = useLbBotDownloadsShown();
    // Off, the page is Activity (the sidebar's name) and its empty line says nothing of fetching.
    const { t } = useTranslation();
    const copy = activityPageCopy(downloadsShown);
    // B-406: lb-bot's To fix moved to Library Matches; while it holds something, say where. Review
    // L5: an admin's line, as the page is (a cached answer is not one a non-admin may read).
    const admin = allows(useHubRoles(), 'needsAttention');
    const attention = useLbBotAttention().data;
    const toFix = admin ? libraryToFixCount(attention, downloadsShown) : 0;

    const chips = (
        <Group gap="xs">
            {FILTER_ORDER.map((id) => {
                const count = id === 'needsYou' ? needYou.length : rows.filter(MATCHES[id]).length;
                return (
                    <Button
                        disabled={count === 0 && id !== 'all'}
                        key={id}
                        onClick={() => setSection(id)}
                        variant={section === id ? 'filled' : 'subtle'}
                    >
                        {`${FILTER_LABEL[id]} (${count})`}
                    </Button>
                );
            })}
            <Button
                onClick={() => setSection('wishlist')}
                variant={section === 'wishlist' ? 'filled' : 'subtle'}
            >
                {wishlistCount === undefined ? 'Wishlist' : `Wishlist (${wishlistCount})`}
            </Button>
        </Group>
    );

    return (
        <ForkListPage
            count={section === 'wishlist' ? (wishlistCount ?? null) : shownCount}
            countLoading={section === 'wishlist' && wishlist.isLoading}
            filters={chips}
            title={t(copy.title.key)}
        >
            {section === 'wishlist' ? (
                <WishlistList />
            ) : (
                <>
                    {/* B-406 (the owner's ruling, 2026-11-13): lb-bot's imports and the
                        folders waiting to be filed are Library Matches' To fix, not fills; one
                        line here says where they went while there are any. */}
                    {toFix > 0 && (
                        <Group gap="sm" justify="space-between" wrap="nowrap">
                            <Text isMuted size="sm">
                                {t('naviConnect.toFix.movedHere')}
                            </Text>
                            <Button
                                component={Link}
                                size="compact-sm"
                                to={AppRoute.LIBRARY_MATCHES}
                                variant="subtle"
                            >
                                {t('naviConnect.toFix.movedOpen')}
                            </Button>
                        </Group>
                    )}
                    {/* The one entry point into this surface that does not start
                        from something the library already knows about. It sits
                        here rather than on Discover because a pasted link is an
                        acquisition, and this is the page acquisitions are
                        tracked on. */}
                    {/* Off, it folds away rather than vanishing, so a row acted on below it is
                        not jumped up (F7 walk). */}
                    <Fold name="resolve-link" open={downloadsShown}>
                        <ResolveLinkBox />
                    </Fold>
                    {rows.length === 0 && shownCount === 0 ? (
                        <Text isMuted>{t(copy.empty.key)}</Text>
                    ) : shownCount === 0 ? (
                        // A filter that hides everything must say it was the
                        // filter, not that there is nothing here.
                        <Text isMuted>{`Nothing matches "${FILTER_LABEL[filter]}".`}</Text>
                    ) : (
                        <Stack gap="sm">
                            {filter === 'needsYou'
                                ? needYou.map((item) => {
                                      // Review L3: drawn from the state that decided it counts.
                                      const row = drawnRow(item);
                                      return row ? (
                                          <FillRow key={item.key} now={now} row={row} />
                                      ) : (
                                          <ServerRow key={item.key} now={now} req={item.server!} />
                                      );
                                  })
                                : shown.map((row) => <FillRow key={row.key} now={now} row={row} />)}
                        </Stack>
                    )}
                </>
            )}
        </ForkListPage>
    );
};

const LbBotDownloadsRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotDownloadsPage />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotDownloadsRouteWithBoundary;
