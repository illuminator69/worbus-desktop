import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import styles from './library-artists-route.module.css';

import {
    useLbBotAvailable,
    useLbBotRouteSupport,
    useResolveLink,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    useMirrorLibraryArtists,
    useMirrorShown,
} from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import { externalArtistPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { openResolvedLink } from '/@/renderer/features/lbbot/utils/open-resolved-link';
import {
    ArtistRows,
    type ArtistRowsHandle,
    type PageItem,
} from '/@/renderer/features/library/components/artist-rows';
import { LibraryField } from '/@/renderer/features/library/components/library-field';
import { LibraryFrameActions } from '/@/renderer/features/library/components/library-slot';
import { useLibraryArtistLookup } from '/@/renderer/features/library/hooks/use-library-artist-lookup';
import { useLibraryArtists } from '/@/renderer/features/library/hooks/use-library-artists';
import { useLibraryPlace } from '/@/renderer/features/library/hooks/use-library-place';
import {
    type ArtistSort,
    buildOwnedByMbid,
    isPastedLink,
    libraryPhase,
    rankArtists,
    splitExternalArtists,
} from '/@/renderer/features/library/library-model';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { toast } from '/@/shared/components/toast/toast';
import { buildFuzzyIndex } from '/@/shared/utils/fuzzy-match';

const LOOKUP_ROUTE = 'GET /lb/artist/lookup';
const RESOLVE_ROUTE = 'POST /lb/resolve-link';

const hostOf = (url: string) => {
    try {
        return new URL(url).host.replace(/^www\./, '');
    } catch {
        return url;
    }
};

/**
 * F6: the Library's Artists page (design brief 7.2). One field narrows your artists instantly and
 * forgives typos ("kiosc" finds "Kiosk"); a moment later artists from MusicBrainz arrive under their
 * own heading, never mixed in. Ownership is by MBID: a candidate the library holds joins Your artists,
 * a stranger with the same name does not. A pasted link opens its album or artist when pressed.
 */
const LibraryArtistsRoute = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const place = useLibraryPlace();
    const { artists, capped, error, loadedAll, loading, refetch, total } = useLibraryArtists();
    const rowsRef = useRef<ArtistRowsHandle>(null);
    const fieldRef = useRef<HTMLInputElement>(null);
    const focusRows = useCallback(() => rowsRef.current?.focusFirst(), []);
    const focusField = useCallback(() => fieldRef.current?.focus(), []);

    const lbBotAvailable = useLbBotAvailable();
    const supportsRoute = useLbBotRouteSupport();
    const mirrorShown = useMirrorShown();
    const lookupAvailable = mirrorShown && lbBotAvailable && supportsRoute(LOOKUP_ROUTE);
    const linksAvailable = mirrorShown && lbBotAvailable && supportsRoute(RESOLVE_ROUTE);

    // A keystroke never waits on the list: the ranking follows the text a moment later.
    const typed = place.text;
    const deferred = useDeferredValue(typed);
    const query = deferred.trim();
    const index = useMemo(
        () => buildFuzzyIndex(artists.map((artist) => ({ text: artist.name, value: artist }))),
        [artists],
    );
    const ranked = useMemo(() => rankArtists(index, query, place.sort), [index, query, place.sort]);

    const { lookup, retry, term } = useLibraryArtistLookup(typed, lookupAvailable);
    const mirrorArtists = useMirrorLibraryArtists();
    const ownedByMbid = useMemo(
        () => buildOwnedByMbid(artists, mirrorArtists),
        [artists, mirrorArtists],
    );
    const byId = useMemo(() => new Map(artists.map((a) => [a.id, a])), [artists]);
    const candidates = lookup.kind === 'done' ? lookup.items : null;
    const split = useMemo(
        () => (candidates ? splitExternalArtists(candidates, ownedByMbid) : []),
        [candidates, ownedByMbid],
    );

    // A pasted link: one row, resolved only when pressed or on Enter in the field.
    const link = isPastedLink(query) ? query : '';
    const { pending: linkPending, resolve } = useResolveLink();
    const [linkMessage, setLinkMessage] = useState('');
    const resolving = useRef(false);
    useEffect(() => setLinkMessage(''), [link]);
    const openLink = useCallback(async () => {
        if (!link || resolving.current) return;
        resolving.current = true;
        try {
            const outcome = openResolvedLink(await resolve(link), navigate);
            if (outcome.opened) {
                if (outcome.notice) toast.show({ message: outcome.notice });
            } else {
                setLinkMessage(outcome.message);
            }
        } finally {
            resolving.current = false;
        }
    }, [link, navigate, resolve]);

    const items = useMemo((): PageItem[] => {
        const out: PageItem[] = [];
        if (loading) {
            for (let n = 0; n < 5; n++) {
                out.push({
                    key: `ghost-${n}`,
                    kind: 'ghost',
                    label: n === 0 ? t('page.library.loadingArtists') : undefined,
                });
            }
            return out;
        }
        if (artists.length === 0) {
            out.push(
                error
                    ? {
                          key: 'load-failed',
                          kind: 'message',
                          retry: refetch,
                          retryLabel: t('common.retry'),
                          text: t('page.library.loadFailed'),
                      }
                    : { key: 'empty', kind: 'message', text: t('page.library.empty') },
            );
            return out;
        }

        // Your artists: the fuzzy hits, then any MusicBrainz candidate the library holds by MBID.
        const owned = ranked.map(({ artist, tier }) => ({ artist, tier }));
        const shown = new Set(owned.map((o) => o.artist.id));
        for (const { ownedId } of split) {
            const artist = ownedId ? byId.get(ownedId) : undefined;
            if (artist && !shown.has(artist.id)) {
                shown.add(artist.id);
                owned.push({ artist, tier: 'exact' });
            }
        }
        const unowned = split.filter((s) => !s.ownedId).map((s) => s.candidate);
        const phase = libraryPhase({ lookup, lookupAvailable, ownedCount: owned.length, query });

        // Above the list, where it is seen: what is held stays, and Retry reads the rest.
        if (error) {
            out.push({
                key: 'partial-failed',
                kind: 'message',
                retry: refetch,
                retryLabel: t('common.retry'),
                text: t('page.library.loadPartialFailed'),
            });
        }
        if (link && linksAvailable) {
            out.push({
                host: hostOf(link),
                key: 'link',
                kind: 'link',
                message: linkMessage,
                onOpen: () => void openLink(),
                pending: linkPending,
            });
        }
        // A partial list is never called complete: while reading, every line drawn from it says so (after a
        // failed page the error line does instead), and a list stopped at the row limit says how much it holds.
        const stillReading = !loadedAll && !error;
        const cappedParams = {
            n: artists.length.toLocaleString(),
            total: (total ?? artists.length).toLocaleString(),
        };
        const reading = stillReading
            ? `, ${t('page.library.stillReading')}`
            : capped
              ? `, ${t('page.library.cappedNote', cappedParams)}`
              : '';
        if (owned.length > 0) {
            out.push({
                key: 'heading-owned',
                kind: 'heading',
                note:
                    t(phase === 'browse' ? 'page.library.artistCount' : 'page.library.matches', {
                        count: owned.length,
                        n: owned.length.toLocaleString(),
                    }) + reading,
                section: 'owned',
                title: t('page.library.yourArtists'),
            });
            owned.forEach(({ artist, tier }, n) => {
                out.push({ arrive: n, artist, key: `owned-${artist.id}`, kind: 'owned', tier });
            });
        }

        // Not in your library: absent unless asked; a failure is a line with Retry, never "nothing".
        const unownedHeading = (note: string): PageItem => ({
            key: 'heading-unowned',
            kind: 'heading',
            note,
            section: 'unowned',
            title: t('page.library.notInLibrary'),
        });
        if (lookup.kind === 'looking') {
            out.push(unownedHeading(t('page.library.fromMusicBrainzArriving') + reading));
            out.push({ key: 'ghost-unowned', kind: 'ghost', label: t('page.library.lookingUp') });
        } else if (lookup.kind === 'failed') {
            out.push(unownedHeading(t('page.library.fromMusicBrainz') + reading));
            out.push({
                key: 'lookup-failed',
                kind: 'message',
                retry,
                retryLabel: t('common.retry'),
                text: lookup.message || t('page.library.lookupFailed'),
            });
        } else if (unowned.length > 0) {
            // Which candidates you own can change until the whole list is read.
            out.push(unownedHeading(t('page.library.fromMusicBrainz') + reading));
            unowned.forEach((c, n) => {
                out.push({
                    arrive: n,
                    key: `unowned-${c.mbid}`,
                    kind: 'external',
                    line:
                        [c.type, c.country, c.disambiguation].filter(Boolean).join(' - ') ||
                        t('page.library.onMusicBrainz'),
                    mbid: c.mbid,
                    name: c.name,
                    to: externalArtistPath(c.mbid, c.name),
                });
            });
        }

        if (phase === 'none' && !link) {
            const caveat = stillReading
                ? ` ${t('page.library.stillReadingSentence')}`
                : capped
                  ? ` ${t('page.library.cappedSentence', cappedParams)}`
                  : '';
            out.push({
                key: 'none',
                kind: 'message',
                text: t('page.library.noneMatch', { text: query }) + caveat,
            });
        }
        if (query) {
            // Says what was asked: MusicBrainz only once it answered.
            const checked = t(
                lookup.kind === 'done' ? 'page.library.checkedBoth' : 'page.library.checkedLibrary',
            );
            out.push({
                key: 'note',
                kind: 'note',
                text: linksAvailable ? `${checked} ${t('page.library.pasteLink')}` : checked,
            });
        }
        return out;
    }, [
        artists.length,
        byId,
        capped,
        error,
        link,
        linkMessage,
        linkPending,
        linksAvailable,
        loadedAll,
        loading,
        lookup,
        lookupAvailable,
        openLink,
        query,
        ranked,
        refetch,
        retry,
        split,
        t,
        total,
    ]);

    return (
        <AnimatedPage>
            <LibraryFrameActions>
                <SegmentedControl
                    aria-label={t('page.library.sortLabel')}
                    className={styles.sort}
                    data={[
                        { label: t('page.library.sortAz'), value: 'az' },
                        { label: t('page.library.sortPlays'), value: 'plays' },
                        { label: t('page.library.sortReleases'), value: 'releases' },
                    ]}
                    onChange={(value) => place.setSort(value as ArtistSort)}
                    value={place.sort}
                />
            </LibraryFrameActions>
            <LibraryField
                hint={t(lookupAvailable ? 'page.library.hintAll' : 'page.library.hintOwned')}
                onChange={place.setText}
                onDown={focusRows}
                onEnter={link && linksAvailable ? () => void openLink() : undefined}
                ref={fieldRef}
                value={typed}
            />
            <ArtistRows
                initialOffset={place.initialOffset}
                items={items}
                onLeaveTop={focusField}
                onScroll={place.onScroll}
                query={query}
                ref={rowsRef}
                resetKey={`${place.sort}\n${query}`}
                term={term}
            />
        </AnimatedPage>
    );
};

const LibraryArtistsRouteWithBoundary = () => (
    <PageErrorBoundary>
        <LibraryArtistsRoute />
    </PageErrorBoundary>
);

export default LibraryArtistsRouteWithBoundary;
