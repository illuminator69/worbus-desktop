import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useResolveLink } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { openResolvedLink } from '/@/renderer/features/lbbot/utils/open-resolved-link';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

/**
 * Paste a Spotify/Deezer/Apple/Tidal/Qobuz/YouTube-Music link, land on the
 * album.
 *
 * The gap this closes is a specific one: every route into this app's
 * acquisition surface starts from something the *library* already knows about —
 * an artist you own, a release-group from a Fresh row, a MusicBrainz search.
 * "A friend sent me this link" had no entry point at all.
 *
 * **Confidence is shown, not hidden, and the reason is that half the providers
 * cannot be resolved exactly.** A Spotify or Deezer id maps through that
 * service's own API; an Apple Music, Tidal, Qobuz or YouTube Music URL is
 * resolved by searching MusicBrainz for the artist and title scraped out of the
 * URL or its page title, which is a guess with a score. Presenting that as a
 * fact is how somebody ends up downloading the wrong record from a link they
 * never looked at.
 *
 * A `kind: 'unknown'` answer is not a failure - it is lb-bot saying it does not
 * parse that provider - so it gets a sentence rather than an error toast
 * (`openResolvedLink`, shared with the Library field).
 */
export const ResolveLinkBox = () => {
    const navigate = useNavigate();
    const { pending, resolve } = useResolveLink();
    const [url, setUrl] = useState('');

    const submit = async () => {
        const outcome = openResolvedLink(await resolve(url), navigate);
        if (outcome.opened) {
            if (outcome.notice) toast.show({ message: outcome.notice });
            setUrl('');
        } else if (outcome.error) {
            toast.error({ message: outcome.message });
        } else {
            toast.show({ message: outcome.message });
        }
    };

    return (
        <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
                <TextInput
                    onChange={(event) => setUrl(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && url.trim()) void submit();
                    }}
                    placeholder="Paste a Spotify, Deezer, Apple Music, Tidal or YouTube Music link"
                    style={{ flex: 1 }}
                    value={url}
                />
                <Button
                    disabled={pending || url.trim().length === 0}
                    loading={pending}
                    onClick={() => void submit()}
                    variant="filled"
                >
                    Find it
                </Button>
            </Group>
            <Text isMuted size="sm">
                Resolves the link to a MusicBrainz release and opens its page, where you can fetch
                it.
            </Text>
        </Stack>
    );
};
