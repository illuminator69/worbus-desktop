import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate } from 'react-router';

import { useLbBotAlbumLookup } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { externalAlbumPathFor } from '/@/renderer/features/lbbot/utils/external-paths';
import { CollapsibleCommandGroup } from '/@/renderer/features/search/components/collapsible-command-group';
import { CommandItemSelectable } from '/@/renderer/features/search/components/command-item-selectable';
import { AppRoute } from '/@/renderer/router/routes';
import { Badge } from '/@/shared/components/badge/badge';
import { Box } from '/@/shared/components/box/box';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';

/**
 * "Albums on MusicBrainz" — the album half of reaching past the library.
 *
 * The artist section next to this one is headed "Not in your library" and does
 * not filter, because lb-bot ranks by MusicBrainz and dropping a row on a *name*
 * match would hide the right artist whenever two share a name. This section is
 * headed differently on purpose: `/lb/album/lookup` marks ownership by
 * release-group id, which is exact, so an owned hit is a known fact rather than
 * a guess — and it is kept, badged, and opened as the library album.
 *
 * Keeping it (rather than filtering it out) is worth the row: Navidrome's own
 * search matches its own text, so an album the library holds under a different
 * spelling is missing from the library section above and this is the only place
 * it appears.
 *
 * Fail-soft like every other lb-bot surface: no hub, lb-bot down, or a query too
 * short to be worth a MusicBrainz second all render nothing.
 */

interface SearchExternalAlbumsSectionProps {
    debouncedQuery: string;
    expanded: boolean;
    isHome: boolean;
    onSelectResult: () => void;
    onToggle: () => void;
}

export function SearchExternalAlbumsSection({
    debouncedQuery,
    expanded,
    isHome,
    onSelectResult,
    onToggle,
}: SearchExternalAlbumsSectionProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    // The debounced term only. This and the artist lookup share lb-bot's one
    // global MusicBrainz second, so a keystroke here costs two of them.
    const { data, isLoading } = useLbBotAlbumLookup(debouncedQuery, isHome);
    const candidates = data ?? [];

    if (!isHome || (!isLoading && candidates.length === 0)) return null;

    return (
        <CollapsibleCommandGroup
            expanded={expanded}
            heading={t('page.globalSearch.albumsOnMusicBrainz')}
            onToggle={onToggle}
        >
            {isLoading ? (
                <Box p="md">
                    <Spinner container />
                </Box>
            ) : (
                candidates.map((candidate) => (
                    <CommandItemSelectable
                        key={`search-external-album-${candidate.rgid}`}
                        onSelect={() => {
                            // An owned release-group opens the library album.
                            // Routing it through the virtual page instead would
                            // rely on that page's redirect, which cannot fire
                            // for an album lb-bot filled itself until the
                            // present-row backfill resolves its Navidrome ids —
                            // and the user would be looking at a download page
                            // for a record already on disk.
                            navigate(
                                candidate.releaseAlbumId
                                    ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                                          albumId: candidate.releaseAlbumId,
                                      })
                                    : externalAlbumPathFor({
                                          artist: candidate.artist,
                                          rgid: candidate.rgid,
                                          title: candidate.title,
                                          type: candidate.primaryType,
                                          year: candidate.year,
                                      }),
                            );
                            onSelectResult();
                        }}
                        value={`search-external-album-${candidate.rgid}`}
                    >
                        {() => (
                            <Group gap="xs" wrap="nowrap">
                                <Text size="sm">{candidate.title}</Text>
                                <Text isMuted size="sm">
                                    {[candidate.artist, candidate.year].filter(Boolean).join(' · ')}
                                </Text>
                                {/* Owned, but lb-bot has not resolved the
                                    Navidrome id yet — a real state after a fill
                                    it performed itself. Say so rather than
                                    offering to fetch it again. */}
                                {candidate.releaseOwned && (
                                    <Badge size="xs">
                                        {candidate.releaseAlbumId
                                            ? t('naviConnect.gapBox.inLibrary')
                                            : t('page.globalSearch.waitingForLibrary')}
                                    </Badge>
                                )}
                            </Group>
                        )}
                    </CommandItemSelectable>
                ))
            )}
        </CollapsibleCommandGroup>
    );
}
