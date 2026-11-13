import clsx from 'clsx';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './source-cards.module.css';

import { ReleasePill } from '/@/renderer/features/discography/components/release-pill';
import {
    type CoverageText,
    coverageText,
    folderLabel,
    isSourceVerified,
    qualityLine,
    sourceRank,
} from '/@/renderer/features/lbbot/components/source-cards-model';
import { extraFilesView } from '/@/renderer/features/lbbot/utils/album-download';
import { Fold } from '/@/renderer/features/motion/fold';
import { Button } from '/@/shared/components/button/button';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { LbBotGapSource, LbBotSourceFile, LbBotSourceFiles } from '/@/shared/types/lbbot-types';

/** A card's folder listing: the album's rides along with the sources, a gap's is fetched on a pick. */
export interface SourceFilesView {
    error: string;
    loading: boolean;
    value: LbBotSourceFiles | null;
}

const fileDetail = (file: LbBotSourceFile): string =>
    [
        file.ext?.toUpperCase(),
        file.bitrate ? `${file.bitrate} kbps` : '',
        file.sizeMb ? `${file.sizeMb.toFixed(1)} MB` : '',
    ]
        .filter(Boolean)
        .join(' · ');

/** The folder's files, each paired against the tracklist: a file matching no slot is dimmed, not hidden. */
export const SourceFileListing = ({ view }: { view: SourceFilesView }) => {
    const { t } = useTranslation();
    if (view.loading) {
        return (
            <div className={styles.files}>
                <Skeleton height={12} />
                <Skeleton height={12} />
                <Skeleton height={12} width="70%" />
            </div>
        );
    }
    if (view.error) return <p className={styles.note}>{view.error}</p>;
    if (!view.value) return null;
    const { expanded, files, filesTruncated } = view.value;
    return (
        <div className={styles.listing}>
            {/* `expanded: false` means lb-bot could not reach the peer: these rows are the search
                hits, not the folder, which is exactly when a file you need looks absent. */}
            {!expanded && <p className={styles.warn}>{t('naviConnect.sourceCard.peerOffline')}</p>}
            <div className={styles.files}>
                {files.map((file, index) => (
                    <div
                        className={clsx(styles.file, { [styles.unmatched]: !file.matchedTo })}
                        key={`${file.filename}-${index}`}
                    >
                        <span className={styles.filename}>{file.filename}</span>
                        <span className={styles.note}>
                            {file.matchedTo
                                ? `→ ${file.matchedTo.position ? `${file.matchedTo.position}. ` : ''}${file.matchedTo.title}`
                                : t('naviConnect.sourceCard.noMatch')}
                            {file.accepted ? '' : ` · ${t('naviConnect.sourceCard.notAccepted')}`}
                            {fileDetail(file) ? ` · ${fileDetail(file)}` : ''}
                        </span>
                    </div>
                ))}
                {files.length === 0 && (
                    <p className={styles.note}>{t('naviConnect.sourceCard.noFiles')}</p>
                )}
            </div>
            {filesTruncated && (
                <p className={styles.note}>{t('naviConnect.sourceCard.truncated')}</p>
            )}
            {view.value.coverageDetail.unmatched.length > 0 && (
                <p className={styles.note}>
                    {t('naviConnect.sourceCard.uncovered', {
                        tracks: view.value.coverageDetail.unmatched.join(', '),
                    })}
                </p>
            )}
        </div>
    );
};

/**
 * R12 (B-238): a refused Request, right under the button that was pressed rather than at the box's
 * foot, off screen: lb-bot's own sentence, and Search again beside it when the refusal says the cards
 * are stale (`refusalSaysListIsStale`). The caller passes `onSearchAgain` only then.
 */
export const SourceRefusal = ({
    message,
    onSearchAgain,
}: {
    message: string;
    onSearchAgain?: () => void;
}) => {
    const { t } = useTranslation();
    return (
        <div className={styles.refusal} data-source-refusal="">
            <p className={styles.refusalText} role="alert">
                {message}
            </p>
            {onSearchAgain && (
                <Button
                    data-source-refusal-again=""
                    onClick={onSearchAgain}
                    size="compact-sm"
                    variant="default"
                >
                    {t('naviConnect.gapBox.searchAgain')}
                </Button>
            )}
        </div>
    );
};

interface SourceCardsProps {
    /** While a request is on its way: the cards stay, unchoosable. */
    disabled?: boolean;
    /** The chosen card's listing; null when there is none to show. */
    files: (source: LbBotGapSource) => null | SourceFilesView;
    /** B-084 "Download all M files", on the chosen card, where the caller offers it (the album's). */
    onDownloadAll?: (source: LbBotGapSource) => void;
    onSelect: (source: LbBotGapSource) => void;
    /** Drawn right under the chosen card: the box's Download (Request) button. */
    renderUnderSelected?: (source: LbBotGapSource) => ReactNode;
    /** The chosen source's id, or null: no card is chosen until lb-bot marks one safe or the user taps. */
    selected: null | number;
    sources: LbBotGapSource[];
}

/**
 * lb-bot's ranked folders as radio cards in one box (R11, B-222), the same for a missing album and
 * for an album's gaps, after Worbus for Android's `SourceCards`. Every card answers, in order of how badly a
 * wrong answer hurts: is this the right album (the verdict, the one failure that is silent), does it
 * hold every track (coverage against the canonical tracklist, never a file count), and what quality.
 * Choosing a card opens its files, and the box's action folds in right under it.
 */
export const SourceCards = ({
    disabled,
    files,
    onDownloadAll,
    onSelect,
    renderUnderSelected,
    selected,
    sources,
}: SourceCardsProps) => {
    const { t } = useTranslation();
    const coverage = (text: CoverageText): string => {
        switch (text.kind) {
            case 'all':
                return t('naviConnect.sourceCard.coverageAll', { total: text.total });
            case 'some':
                return t('naviConnect.sourceCard.coverageSome', {
                    have: text.have,
                    total: text.total,
                });
            case 'unknown':
                return t('naviConnect.sourceCard.coverageUnknown');
            case 'word':
                return text.word;
        }
    };
    const flag = (name: string): string =>
        name === 'compilation'
            ? t('naviConnect.sourceCard.flagCompilation')
            : name === 'live'
              ? t('naviConnect.sourceCard.flagLive')
              : name === 'risk'
                ? t('naviConnect.sourceCard.flagRisk')
                : name;
    // The peer and its conditions.
    const peerLine = (source: LbBotGapSource): string =>
        [
            source.peer ? `@${source.peer}` : '',
            source.speedMbps ? `${source.speedMbps.toFixed(1)} Mbps` : '',
            source.freeSlot ? t('naviConnect.sourceCard.freeSlot') : '',
            source.queueLength
                ? t('naviConnect.sourceCard.queue', { count: source.queueLength })
                : '',
        ]
            .filter(Boolean)
            .join(' · ');
    return (
        <div
            aria-label={t('naviConnect.sourceCard.label')}
            className={styles.cards}
            role="radiogroup"
        >
            {sources.map((source) => {
                const isSelected = source.id === selected;
                const view = files(source);
                const extra = onDownloadAll ? extraFilesView(source) : null;
                const quality = qualityLine(source);
                const peer = peerLine(source);
                return (
                    <div
                        className={styles.item}
                        data-source-card={source.peer}
                        key={`${source.peer}-${source.folder}-${source.id}`}
                    >
                        <div
                            className={styles.card}
                            data-selected={isSelected ? 'true' : undefined}
                            data-source-selected={isSelected ? 'true' : undefined}
                        >
                            <button
                                aria-checked={isSelected}
                                className={styles.head}
                                disabled={disabled}
                                onClick={() => onSelect(source)}
                                role="radio"
                                type="button"
                            >
                                <span aria-hidden="true" className={styles.radio} />
                                <span className={styles.body}>
                                    <span className={styles.pills}>
                                        <span className={styles.rank}>#{sourceRank(source)}</span>
                                        {source.recommended && (
                                            <ReleasePill tone="owned">
                                                {t('naviConnect.sourceCard.recommended')}
                                            </ReleasePill>
                                        )}
                                        {source.format && (
                                            <ReleasePill tone="partly">{source.format}</ReleasePill>
                                        )}
                                        {source.flags.map((name) => (
                                            <ReleasePill key={name} tone="missing">
                                                {flag(name)}
                                            </ReleasePill>
                                        ))}
                                    </span>
                                    <span className={styles.folder} title={source.folder}>
                                        {folderLabel(source)}
                                    </span>
                                    <span
                                        className={styles.coverage}
                                        data-full={source.coverageFull ? 'true' : undefined}
                                    >
                                        {coverage(coverageText(source))}
                                    </span>
                                    <span
                                        className={styles.verdict}
                                        data-ok={source.albumMatchOk ? 'true' : 'false'}
                                    >
                                        {source.albumMatchOk
                                            ? t('naviConnect.sourceCard.verdictOk')
                                            : t('naviConnect.sourceCard.verdictDifferent')}
                                    </span>
                                    {/* B-019: lb-bot will not fetch this one unattended, and a tap
                                    here is consent, so the card says so. */}
                                    {!isSourceVerified(source) && (
                                        <span className={styles.verdict} data-ok="false">
                                            {t('common.artistUnverified')}
                                        </span>
                                    )}
                                    {(quality || peer) && (
                                        <span className={styles.meta}>
                                            {[peer, quality].filter(Boolean).join(' · ')}
                                        </span>
                                    )}
                                    {source.recommendation && (
                                        <span className={styles.meta}>{source.recommendation}</span>
                                    )}
                                    {!isSelected && source.fileCount > 0 && (
                                        <span className={styles.hint}>
                                            {t('naviConnect.sourceCard.showFiles', {
                                                count: source.fileCount,
                                            })}
                                        </span>
                                    )}
                                </span>
                            </button>
                            <Fold name="source-files" open={isSelected && (!!view || !!extra)}>
                                <div className={styles.expanded}>
                                    {view && <SourceFileListing view={view} />}
                                    {extra && onDownloadAll && (
                                        <div className={styles.extra}>
                                            <span className={styles.note}>{extra.line}</span>
                                            <Button
                                                disabled={disabled}
                                                onClick={() => onDownloadAll(source)}
                                                size="compact-xs"
                                                variant="subtle"
                                            >
                                                {extra.action}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </Fold>
                        </div>
                        {renderUnderSelected && (
                            <Fold name="under-selected" open={isSelected}>
                                <div className={styles.under}>{renderUnderSelected(source)}</div>
                            </Fold>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
