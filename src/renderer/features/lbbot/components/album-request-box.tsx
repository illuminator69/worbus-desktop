import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate } from 'react-router';

import styles from './album-request-box.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { ReleasePill } from '/@/renderer/features/discography/components/release-pill';
import { albumBoxView, requestStage } from '/@/renderer/features/discography/request-stage';
import { FindSourcesSection } from '/@/renderer/features/lbbot/components/find-sources-section';
import { RequestSteps } from '/@/renderer/features/lbbot/components/request-steps';
import { describeFill, SHORT_STATE } from '/@/renderer/features/lbbot/fill-vocabulary';
import { type AlbumRequest } from '/@/renderer/features/lbbot/hooks/use-album-request';
import { useFillActions } from '/@/renderer/features/lbbot/hooks/use-fill-actions';
import { useKeepTopInView } from '/@/renderer/features/lbbot/hooks/use-keep-top-in-view';
import { useAdoptRemoteFill } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { albumBoxKey, albumBoxShrinks } from '/@/renderer/features/lbbot/keep-top';
import { requestSteps } from '/@/renderer/features/lbbot/request-steps';
import {
    ActiveFill,
    ledgerRowOf,
    useActiveFill,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import { Fold } from '/@/renderer/features/motion/fold';
import { GrowBox } from '/@/renderer/features/motion/grow-box';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { LibraryItem } from '/@/shared/types/domain-types';
import { LbBotFillState } from '/@/shared/types/lbbot-types';

const useNow = (on: boolean) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) return undefined;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [on]);
    return now;
};

interface AlbumRequestBoxProps {
    artist: string;
    coverUrl: null | string;
    /** The Navidrome album the index names for this release-group, once the library has it. */
    ownedAlbumId: null | string;
    /** The page's source search and pick (`useAlbumRequest`). */
    request: AlbumRequest;
    rgid: string;
    title: string;
}

/**
 * The missing album's one box (Call 8, then R11 / B-222 after Worbus for Android's request box): Find sources
 * turns it into the search, then lb-bot's ranked folders as radio cards with Download right under
 * the chosen one; the request turns the same box into the steps, the bar and Cancel; a failure into
 * the recovery card, the reason in lb-bot's own words and exactly the buttons that are true for it
 * (`describeFill`, PROTOCOL 15.2). The box follows its content's height; a fill in flight is shown
 * whatever else is set, since it may have been started on another client (`albumBoxView`).
 */
export const AlbumRequestBox = ({
    artist,
    coverUrl,
    ownedAlbumId,
    request,
    rgid,
    title,
}: AlbumRequestBoxProps) => {
    const { t } = useTranslation();
    const fill = useActiveFill(rgid);
    // A fill from another device, which this ledger has no row for: read once, adopted if real.
    useAdoptRemoteFill(rgid, { album: title, artist }, !fill);
    const stage = requestStage({
        indexRowOwned: !!ownedAlbumId,
        ownedAlbumId,
        row: fill ? ledgerRowOf(fill) : null,
    });
    const shown = albumBoxView({
        fillFinishedAt: fill?.settled ? (fill.finishedAt ?? 0) : 0,
        searchStartedAt: request.sources.startedAt,
        searchState: request.sources.state,
        stage: fill ? stage : 'none',
        starting: request.starting,
    });
    const running = shown === 'fill' && !!fill && !fill.settled;
    // B-236: Download swaps the tall cards for the short steps while the page keeps its scroll; the
    // box's top comes back under the sticky bar, once, if it went above it.
    const boxRef = useRef<HTMLDivElement>(null);
    useKeepTopInView(boxRef, albumBoxKey(shown, stage), albumBoxShrinks);
    return (
        <Fold name="request" open={shown !== 'none'} tall>
            <GrowBox name="request">
                <div
                    className={styles.box}
                    data-request-box=""
                    data-request-stage={shown === 'fill' ? stage : undefined}
                    data-request-view={shown}
                    ref={boxRef}
                >
                    {/* Keyed by the view, so a change of kind fades in and a progress tick does not. */}
                    <div className={styles.view} key={shown}>
                        {shown === 'fill' && fill && (
                            <RequestBody
                                artist={artist}
                                coverUrl={coverUrl}
                                fill={fill}
                                ownedAlbumId={ownedAlbumId}
                                stage={stage}
                                title={title}
                            />
                        )}
                        {shown === 'sources' && <FindSourcesSection request={request} />}
                    </div>
                </div>
            </GrowBox>
            {/* Under the box, as Worbus for Android says it: the fill goes on without the page. */}
            <Fold name="request-leave" open={running}>
                <p className={styles.leave}>{t('naviConnect.request.leaveAnyTime')}</p>
            </Fold>
        </Fold>
    );
};

const RequestBody = ({
    artist,
    coverUrl,
    fill,
    ownedAlbumId,
    stage,
    title,
}: {
    artist: string;
    coverUrl: null | string;
    fill: ActiveFill;
    ownedAlbumId: null | string;
    stage: ReturnType<typeof requestStage>;
    title: string;
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const row = ledgerRowOf(fill);
    const now = useNow(!row.settled || row.retryAt > 0);
    const view = describeFill(row, now);
    const actions = useFillActions(row);
    const failed = stage === 'failed';
    const state = (row.state || 'searching') as LbBotFillState;
    const pill =
        stage === 'inLibrary'
            ? SHORT_STATE.verified
            : failed
              ? SHORT_STATE.failed
              : (SHORT_STATE[state] ?? SHORT_STATE.searching);
    const downloading = !row.settled && state === 'downloading';
    const steps = row.settled ? [] : requestSteps(state, row.done, row.total);

    return (
        <div data-request-body="">
            <div className={styles.head}>
                <ItemImage
                    containerClassName={styles.cover}
                    itemType={LibraryItem.ALBUM}
                    src={coverUrl}
                    type="table"
                />
                <div style={{ minWidth: 0 }}>
                    <div className={styles.title}>{row.album || title}</div>
                    <div className={styles.artist}>{row.artist || artist}</div>
                </div>
                <ReleasePill tone={failed ? 'failed' : stage === 'inLibrary' ? 'owned' : 'active'}>
                    {failed && <Icon icon="warn" size="xs" />}
                    {pill}
                </ReleasePill>
            </div>
            <div className={styles.body}>
                <p className={styles.headline}>
                    {stage === 'inLibrary' ? SHORT_STATE.verified : view.headline}
                </p>
                {view.progress !== 'none' && stage !== 'inLibrary' && (
                    <div
                        aria-label={view.headline}
                        aria-valuemax={view.progress === 'determinate' ? 100 : undefined}
                        aria-valuemin={view.progress === 'determinate' ? 0 : undefined}
                        aria-valuenow={view.progress === 'determinate' ? view.percent : undefined}
                        className={styles.progress}
                        data-indeterminate={view.progress === 'indeterminate'}
                        role="progressbar"
                    >
                        <i
                            className={styles.progressFill}
                            style={
                                view.progress === 'determinate'
                                    ? { width: `${view.percent}%` }
                                    : undefined
                            }
                        />
                    </div>
                )}
                {steps.length > 0 && <RequestSteps steps={steps} />}
                {downloading && (row.lastSourcePeer || fill.sourceFolder) && (
                    <dl className={styles.kv}>
                        {row.lastSourcePeer && (
                            <>
                                <dt>{t('naviConnect.request.source')}</dt>
                                <dd>{row.lastSourcePeer}</dd>
                            </>
                        )}
                        {fill.sourceFolder && (
                            <>
                                <dt>{t('naviConnect.request.folder')}</dt>
                                <dd>{fill.sourceFolder}</dd>
                            </>
                        )}
                    </dl>
                )}
                {view.sublines.map((line, index) => (
                    // lb-bot's own sentence is among these, verbatim (the first line of a failure).
                    <p className={failed && index === 0 ? styles.reason : styles.line} key={index}>
                        {line}
                    </p>
                ))}
                {failed && row.done > 0 && (
                    <p className={styles.line} data-request-finished="">
                        {t('naviConnect.request.finishedFiles', {
                            done: row.done,
                            total: row.total,
                        })}
                    </p>
                )}
                {view.explain && <p className={styles.line}>{view.explain}</p>}
                <div className={styles.buttons}>
                    {stage === 'inLibrary' && ownedAlbumId ? (
                        <Button
                            onClick={() =>
                                navigate(
                                    generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                                        albumId: ownedAlbumId,
                                    }),
                                )
                            }
                            size="compact-sm"
                            variant="filled"
                        >
                            {actions.label('openAlbum')}
                        </Button>
                    ) : (
                        view.buttons
                            // "Open album" on this page would open this page: shown only once there is a library album.
                            .filter((button) => button !== 'openAlbum')
                            .map((button) => (
                                <Button
                                    data-request-button={button}
                                    disabled={actions.busy && button !== 'dismiss'}
                                    key={button}
                                    onClick={() => actions.run(button)}
                                    size="compact-sm"
                                    variant={button === 'retry' ? 'filled' : 'default'}
                                >
                                    {button === 'cancel'
                                        ? t('naviConnect.request.cancelRequest')
                                        : actions.label(button)}
                                </Button>
                            ))
                    )}
                </div>
            </div>
        </div>
    );
};
