import { useState } from 'react';

import styles from './mbid-match-modal.module.css';

import { allows } from '/@/renderer/features/hub/utils/hub-roles';
import { ArtistMergeBlock } from '/@/renderer/features/lbbot/components/artist-merge-block';
import {
    LbModalLayout,
    lbModalSettings,
} from '/@/renderer/features/lbbot/components/lb-modal-layout';
import {
    useArtistOverrideActions,
    useArtistOverrideKind,
    useLbBotArtistSearch,
    useLbBotAvailable,
    useOverrideControls,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { parseMbidInput } from '/@/renderer/features/lbbot/utils/artist-override';
import { readState } from '/@/renderer/features/listening/listening-logic';
import { useHubRoles } from '/@/renderer/store/hub.store';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeModal, openModal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { useDebouncedValue } from '/@/shared/hooks/use-debounced-value';
import { LbBotArtistCandidate } from '/@/shared/types/lbbot-types';

/**
 * Pick the right MusicBrainz artist for a library artist whose Navidrome tag is
 * missing or wrong (I-019).
 *
 * Candidates are lb-bot's own MusicBrainz artist search, shown as they come — a
 * row is NEVER dropped because its name matches (or does not match) the library
 * artist: "Pink" and "Pink Floyd" are different people and the whole point of
 * this dialog is that the user, not a string compare, decides. A pasted MBID or
 * `musicbrainz.org/artist/<uuid>` URL is the escape hatch for an artist the
 * search ranks badly. The write is lb-bot's: it validates the id against
 * MusicBrainz, stores it, and starts the scan; a refusal is shown here in place.
 *
 * Every sentence about the search comes from what was read: "No MusicBrainz
 * artists found" only from a 200 with no candidates, an error line (lb-bot's own
 * text, with Retry unless permanent) when the search failed.
 */

interface MbidMatchModalProps {
    /** The MBID in force now — the override if there is one, else the tag. */
    currentMbid: null | string | undefined;
    /** The artist page's scan follow; null from the settings panel (see
     *  `useArtistOverrideActions`). */
    indexArtist: ((mbid: string, name: string) => Promise<boolean>) | null;
    name: string;
    ndId: string;
    tagMbid: null | string | undefined;
}

const MbidMatchModal = ({
    currentMbid,
    indexArtist,
    modalId,
    name,
    ndId,
    tagMbid,
}: MbidMatchModalProps & { modalId: string }) => {
    const [term, setTerm] = useState(name);
    const [debounced] = useDebouncedValue(term, 500);
    const [pasted, setPasted] = useState('');
    const available = useLbBotAvailable();
    const controls = useOverrideControls();
    // Worbus P2 (review M6): a demotion while the dialog is open hides the controls; say why.
    const roles = useHubRoles();
    const search = useLbBotArtistSearch(debounced ?? '');
    const kind = useArtistOverrideKind(ndId, tagMbid);
    const { failure, pending, remove, set } = useArtistOverrideActions(ndId, indexArtist);

    const parsed = parseMbidInput(pasted);
    const overridden = kind === 'override' || kind === 'override-same';
    const canWrite = available && controls;

    // Only the picker closes: from the Settings panel a pick must not eject the user.
    const choose = async (mbid: string) => {
        const result = await set(mbid, name);
        if (result.ok) closeModal(modalId);
    };

    const handleRemove = async () => {
        const result = await remove(tagMbid, name);
        if (result.ok) closeModal(modalId);
    };

    const candidates: LbBotArtistCandidate[] = search.data ?? [];
    const typed = (debounced ?? '').trim().length > 0;
    const settledTerm = typed && (debounced ?? '').trim() === term.trim();
    const reading = readState({
        available,
        error: search.error
            ? {
                  message: search.error.message,
                  status: (search.error as { status?: number }).status ?? 0,
              }
            : null,
        fetching: search.isFetching,
        hasData: search.data !== undefined,
        rowCount: candidates.length,
        supported: controls,
    });

    const header = (
        <Stack gap="sm">
            <Text isMuted size="sm">
                {tagMbid
                    ? 'Navidrome has a MusicBrainz id for this artist. Choose another if it is the wrong one.'
                    : 'Navidrome has no MusicBrainz id for this artist. Choose who they are on MusicBrainz.'}
            </Text>
            {(!available || !controls) && (
                <Text isMuted size="sm">
                    {!available
                        ? 'lb-bot is not reachable, so nothing can be searched or changed right now.'
                        : !allows(roles, 'artistMatch')
                          ? 'Only an admin of this server can change this.'
                          : 'This lb-bot is older and cannot store overrides yet.'}
                </Text>
            )}
            <TextInput
                autoFocus
                label="Search MusicBrainz"
                onChange={(event) => setTerm(event.currentTarget.value)}
                value={term}
            />
        </Stack>
    );

    const footer = (
        <Stack gap="xs">
            <Group align="flex-end" gap="xs" wrap="nowrap">
                <TextInput
                    error={pasted.trim() && !parsed ? 'Not a MusicBrainz artist id or URL' : null}
                    label="Or paste an MBID or musicbrainz.org artist URL"
                    onChange={(event) => setPasted(event.currentTarget.value)}
                    style={{ flex: 1 }}
                    value={pasted}
                />
                <Button
                    disabled={pending || !parsed || parsed === currentMbid || !canWrite}
                    loading={pending}
                    onClick={() => parsed && choose(parsed)}
                    variant="filled"
                >
                    Use this id
                </Button>
            </Group>
            {failure && (
                <Text c="red" size="sm">
                    {failure.message}
                </Text>
            )}
            {overridden && (
                <Group justify="space-between">
                    <Text isMuted size="xs">
                        {tagMbid
                            ? 'Removing the override goes back to the id in Navidrome.'
                            : 'Removing the override leaves this artist with no MusicBrainz id.'}
                    </Text>
                    <Button
                        disabled={pending || !canWrite}
                        onClick={handleRemove}
                        size="compact-sm"
                        variant="subtle"
                    >
                        Remove override
                    </Button>
                </Group>
            )}
        </Stack>
    );

    return (
        <LbModalLayout footer={footer} header={header}>
            {/* Inside the scroll, first: two spellings sharing this id is a statement
                about the match being chosen here, and outside the scroll it could
                squeeze the candidate list to nothing (Q-067 c). */}
            <ArtistMergeBlock ndId={ndId} />
            <div>
                {!typed && available && (
                    <Text isMuted py="md" size="sm">
                        Type an artist name to search MusicBrainz.
                    </Text>
                )}
                {typed && reading.kind === 'reading' && candidates.length === 0 && (
                    <Text isMuted py="md" size="sm">
                        Searching…
                    </Text>
                )}
                {typed && reading.kind === 'failed' && (
                    <Group gap="sm" py="md">
                        <Text c="red" size="sm">
                            {reading.text}
                        </Text>
                        {!reading.permanent && (
                            <Button
                                onClick={() => void search.refetch()}
                                size="compact-sm"
                                variant="default"
                            >
                                Retry
                            </Button>
                        )}
                    </Group>
                )}
                {typed && settledTerm && reading.kind === 'empty' && (
                    <Text isMuted py="md" size="sm">
                        No MusicBrainz artists found for that search.
                    </Text>
                )}
                {candidates.map((candidate) => {
                    const current = candidate.mbid === currentMbid;
                    const detail = [candidate.type, candidate.country].filter(Boolean).join(' · ');
                    return (
                        <div className={styles.candidate} key={candidate.mbid}>
                            <Stack gap={0}>
                                <Group gap="xs" wrap="nowrap">
                                    <Text className={styles.name} fw={600} size="sm">
                                        {candidate.name}
                                    </Text>
                                    {current && (
                                        <Badge size="xs" variant="filled">
                                            Current
                                        </Badge>
                                    )}
                                </Group>
                                <Text isMuted size="xs">
                                    {[candidate.disambiguation, detail]
                                        .filter(Boolean)
                                        .join(' — ') || 'No further detail'}
                                    {candidate.score > 0 ? ` · match ${candidate.score}` : ''}
                                </Text>
                            </Stack>
                            <Button
                                disabled={pending || current || !canWrite}
                                onClick={() => choose(candidate.mbid)}
                                size="compact-sm"
                                variant="default"
                            >
                                Use this artist
                            </Button>
                        </div>
                    );
                })}
            </div>
        </LbModalLayout>
    );
};

export const openMbidMatchModal = (props: MbidMatchModalProps) => {
    const modalId = `mbid-match-${props.ndId}`;
    openModal({
        ...lbModalSettings(
            `MusicBrainz match for ${props.name}`,
            <MbidMatchModal {...props} modalId={modalId} />,
        ),
        modalId,
    });
};
