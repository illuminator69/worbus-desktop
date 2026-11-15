import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useLbBotArtistLookup } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { externalArtistPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { CollapsibleCommandGroup } from '/@/renderer/features/search/components/collapsible-command-group';
import { CommandItemSelectable } from '/@/renderer/features/search/components/command-item-selectable';
import { Box } from '/@/shared/components/box/box';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';

/**
 * "Not in your library" — MusicBrainz artists search reaches past the library.
 *
 * Before `/lb/artist/lookup` was whitelisted on the hub, a client could only
 * reach an external artist page if it already held an MBID from a Fresh row,
 * which blocked every acquisition path that starts with "I want this artist".
 *
 * Artists the library *does* have are not filtered out here, and deliberately
 * so: lb-bot answers with MusicBrainz's ranking and has no idea what Navidrome
 * holds, and hiding a row on a name match would hide the *right* artist whenever
 * two share a name. The section is placed last and labelled for what it is, so a
 * duplicate reads as "here is the MusicBrainz one" rather than as a mistake.
 *
 * Fail-soft like every other lb-bot surface: no hub, lb-bot down, or a query too
 * short to be worth a MusicBrainz second all render nothing.
 */

interface SearchExternalArtistsSectionProps {
    debouncedQuery: string;
    expanded: boolean;
    isHome: boolean;
    onSelectResult: () => void;
    onToggle: () => void;
}

export function SearchExternalArtistsSection({
    debouncedQuery,
    expanded,
    isHome,
    onSelectResult,
    onToggle,
}: SearchExternalArtistsSectionProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    // The debounced term only: this is a live MusicBrainz search behind lb-bot's
    // global 1 req/sec lock, not a local index read.
    const { data, isLoading } = useLbBotArtistLookup(debouncedQuery, isHome);
    const candidates = data ?? [];

    if (!isHome || (!isLoading && candidates.length === 0)) return null;

    return (
        <CollapsibleCommandGroup
            expanded={expanded}
            heading={t('page.library.notInLibrary')}
            onToggle={onToggle}
        >
            {isLoading ? (
                <Box p="md">
                    <Spinner container />
                </Box>
            ) : (
                candidates.map((candidate) => (
                    <CommandItemSelectable
                        key={`search-external-artist-${candidate.mbid}`}
                        onSelect={() => {
                            navigate(externalArtistPath(candidate.mbid, candidate.name));
                            onSelectResult();
                        }}
                        value={`search-external-artist-${candidate.mbid}`}
                    >
                        {() => (
                            <Group gap="xs" wrap="nowrap">
                                <Text size="sm">{candidate.name}</Text>
                                {/* MusicBrainz's own "(UK band)" note — the only
                                    thing that tells two identically-named
                                    artists apart. */}
                                {candidate.disambiguation && (
                                    <Text isMuted size="sm">
                                        {candidate.disambiguation}
                                    </Text>
                                )}
                            </Group>
                        )}
                    </CommandItemSelectable>
                ))
            )}
        </CollapsibleCommandGroup>
    );
}
