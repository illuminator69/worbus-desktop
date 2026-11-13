import { Link } from 'react-router';

import {
    MATCHES_PAGE_NAME,
    problemsHeading,
    STILL_WORKING,
} from '/@/renderer/features/lbbot/utils/album-override';
import { MatchSection, sectionSearch } from '/@/renderer/features/lbbot/utils/matches-page';
import { AppRoute } from '/@/renderer/router/routes';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

/**
 * The problems a job reported, under their count (X9). Shown whenever a row is
 * `failed` or carries any, for an apply, a merge and their undos alike: lb-bot's
 * reasons are how the user learns what to do next (a second Undo restores a file
 * that is back, or gives up on one that is not). Keyed by position - the server
 * emits duplicate titles ("Cover image", "An untitled track").
 */
export const JobFailures = ({
    failures,
    limit = 10,
}: {
    failures: { album?: string; reason: string; title: string }[];
    limit?: number;
}) => {
    if (failures.length === 0) return null;
    return (
        <Stack gap={2}>
            <Text size="sm">{`${problemsHeading(failures.length)}:`}</Text>
            {failures.slice(0, limit).map((item, index) => (
                <Text isMuted key={`${index}-${item.title}`} size="xs">
                    {[item.album, item.title, item.reason].filter(Boolean).join(' — ')}
                </Text>
            ))}
            {failures.length > limit && (
                <Text isMuted size="xs">
                    {`and ${failures.length - limit} more`}
                </Text>
            )}
        </Stack>
    );
};

/**
 * X3: "lb-bot is still working. The result will show on the Library Matches page."
 * with the page's name as the link that goes there (closing the dialog it sits in).
 * B-406 review L3: open on the section where the result shows (the page now opens on To fix
 * while lb-bot has something to fix).
 */
export const StillWorking = ({ section }: { section: MatchSection }) => {
    const [lead, tail] = STILL_WORKING.split(MATCHES_PAGE_NAME);
    return (
        <Text size="sm">
            {lead}
            <Link
                onClick={() => closeAllModals()}
                to={{ pathname: AppRoute.LIBRARY_MATCHES, search: sectionSearch(section) }}
            >
                {MATCHES_PAGE_NAME}
            </Link>
            {tail}
        </Text>
    );
};
