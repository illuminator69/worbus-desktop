import { Suspense } from 'react';

import { BrowseRow } from '../components/browse-row';
import { FreshRow } from '../components/fresh-row';
import { ListenBrainzRow } from '../components/listenbrainz-row';
import { MixesRow } from '../components/mixes-row';
import { MoodRow } from '../components/mood-row';
import { RediscoveryRow } from '../components/rediscovery-row';
import { SimilarArtistsRow } from '../components/similar-artists-row';
import { DISCOVER_ROWS, DiscoverRowId } from '../discover-rows';
import { useDiscoverCapabilities } from '../use-discover-capabilities';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useWindowSettings } from '/@/renderer/store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { Platform } from '/@/shared/types/types';

/**
 * navi-connect: Discover — one place to go, instead of six places to know about.
 *
 * Before this the discovery features were scattered across the Fresh tab, a
 * command-palette group collapsed by default, a shelf mounted on exactly one
 * page, a modal reachable only by keyboard, a chip in the queue controls, and
 * virtual pages you could only reach from somewhere else. Every one of them
 * invented its own empty state, so lb-bot down, AudioMuse cold and Navidrome
 * fine all looked different.
 *
 * The rows come from a catalogue (`discover-rows.ts`) whose ids are duplicated
 * in Worbus for Android on purpose — see that file for why "shared" can only mean "written
 * twice". The dispatch below is the one part that cannot be data: each row
 * renders its own content type. It is a `switch` over a closed union rather
 * than the home page's `if` chain, so adding a row to the catalogue without
 * teaching this file about it is a type error rather than a silently missing
 * row.
 */
const renderRow = (id: DiscoverRowId, title: string, genrePickerOn: DiscoverRowId | undefined) => {
    switch (id) {
        case 'charts':
            return (
                <BrowseRow feed="chart" key={id} showGenres={genrePickerOn === id} title={title} />
            );
        case 'editorial':
            return (
                <BrowseRow
                    feed="editorial"
                    key={id}
                    showGenres={genrePickerOn === id}
                    title={title}
                />
            );
        case 'fresh':
            return <FreshRow key={id} title={title} />;
        case 'listenbrainz':
            return <ListenBrainzRow key={id} title={title} />;
        case 'mixes':
            return <MixesRow key={id} title={title} />;
        case 'mood':
            return <MoodRow key={id} title={title} />;
        case 'rediscovery':
            return <RediscoveryRow key={id} title={title} />;
        case 'similar-artists':
            return <SimilarArtistsRow key={id} title={title} />;
        default:
            return null;
    }
};

const DiscoverRoute = () => {
    const { windowBarStyle } = useWindowSettings();
    const { supports } = useDiscoverCapabilities();

    const rows = DISCOVER_ROWS.filter(supports);

    /**
     * Which of the two Deezer rows draws the genre chips.
     *
     * The chips scope **both** rows — they are two views of one source, and
     * letting them sit on different genres would put two chart-shaped shelves on
     * screen with nothing saying which was which. So exactly one row draws the
     * control, and only this file knows which: either row can be hidden on its
     * own capability, so "the first one" has to be computed against what is
     * actually visible rather than assumed to be Charts.
     */
    const genrePickerOn = rows.find((row) => row.id === 'charts' || row.id === 'editorial')?.id;

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: 'var(--theme-colors-background)',
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>Discover</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                }}
            >
                <LibraryContainer>
                    <Stack
                        gap="2xl"
                        mb="5rem"
                        pt={windowBarStyle === Platform.WEB ? '5rem' : '3rem'}
                        px="2rem"
                    >
                        {/* A feed, like Home: the title is the header bar's, shown on
                            scroll, and the content starts with its first row. */}
                        {/* Every row hides itself when it has nothing to say, so
                            "no rows at all" is a real state and needs a sentence
                            rather than a blank page. It is what a server with no
                            lb-bot, no AudioMuse and no rediscovery set looks
                            like — which is a configuration answer, not a fault. */}
                        {rows.length === 0 ? (
                            <Text isMuted>
                                Nothing to discover yet. Discover is fed by lb-bot and AudioMuse
                                through your hub, plus the rediscovery playlist set — none of them
                                is configured, so there is nothing here to show.
                            </Text>
                        ) : (
                            rows.map((row) => renderRow(row.id, row.title, genrePickerOn))
                        )}
                    </Stack>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const DiscoverRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <DiscoverRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default DiscoverRouteWithBoundary;
