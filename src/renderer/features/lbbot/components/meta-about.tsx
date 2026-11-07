import styles from './meta-about.module.css';

import { ClampFold } from '/@/renderer/features/motion/clamp-fold';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LbBotMeta } from '/@/shared/types/lbbot-types';

/**
 * The shared "About" body for an artist or an album.
 *
 * Everything here is plain text by construction: lb-bot asks Wikipedia for
 * `explaintext` extracts, so unlike the Last.fm bio it replaces there is no
 * markup to sanitize and no trailing `<a>Read more on Last.fm</a>` to strip.
 * Paragraphs are rendered as paragraphs rather than one blob — the old surface
 * was a 56px spoiler over a single summary sentence, which is most of why the
 * text felt like a dead end.
 *
 * **The attribution is not optional.** Wikipedia text is CC BY-SA; showing it
 * without crediting the article is a licence violation, and the link is also
 * simply a better "Read more" than the one Last.fm supplies. So it renders
 * outside the fold, where folding cannot hide it.
 */

interface MetaAboutProps {
    /** Lines shown while folded (R13: the About line count every page shares, `ABOUT_LINES`). */
    lines?: number;
    meta: LbBotMeta;
    /**
     * Render the external-links row. The artist page turns this off because it
     * shows the links in its own lb-bot section instead — that section renders
     * whether or not this component does, since on an owned artist the bio slot
     * belongs to Navidrome, and two copies of the same row is worse than either.
     */
    showLinks?: boolean;
}

export const MetaAbout = ({ lines, meta, showLinks = true }: MetaAboutProps) => {
    const paragraphs = meta.paragraphs.length > 0 ? meta.paragraphs : [meta.summary];
    const hasText = paragraphs.some(Boolean);

    if (!hasText && !meta.wikidataDescription && (!showLinks || meta.links.length === 0)) {
        return null;
    }

    return (
        <Stack gap="xs">
            {/* The Wikidata one-liner is often present when the article is not,
                which is exactly when it earns its place. Suppressed when there
                is prose, where it would only restate the first sentence. */}
            {!hasText && meta.wikidataDescription && (
                <Text isMuted>{meta.wikidataDescription}</Text>
            )}
            {hasText && (
                <ClampFold lines={lines} name="meta-about">
                    <Stack className={styles.paragraphs} gap="sm">
                        {paragraphs.filter(Boolean).map((paragraph, index) => (
                            <Text key={index}>{paragraph}</Text>
                        ))}
                    </Stack>
                </ClampFold>
            )}
            {hasText && meta.source && (
                <Text className={styles.attribution} isMuted size="sm">
                    {`From ${meta.source.name} (${meta.source.license}) — `}
                    <a href={meta.source.url} rel="noreferrer" target="_blank">
                        Read more
                    </a>
                </Text>
            )}
            {showLinks && meta.links.length > 0 && (
                <Group className={styles.links} gap="sm">
                    {meta.links.map((link) => (
                        <Text isMuted key={link.url} size="sm">
                            <a href={link.url} rel="noreferrer" target="_blank">
                                {link.label}
                            </a>
                        </Text>
                    ))}
                </Group>
            )}
        </Stack>
    );
};
