/**
 * navi-connect: the Discover row catalogue.
 *
 * **This table is duplicated in Worbus for Android, on purpose, and the ids are the
 * contract.** There is no shared build between the two repos and no codegen, so
 * "shared catalogue" can only ever mean "written twice and kept in sync". The
 * precedent is `MoodCharacter`, and it is a cautionary one: the same three
 * presets live in `auto-dj/audio-muse-source.ts` and in Worbus for Android's
 * `MoodCharacter.kt` with matching numbers but different ids and labels, and
 * they have already drifted — Worbus for desktop's auto-DJ escalates temperature per pass
 * and Worbus for Android's `topUp` does not. Writing the ids down in one place
 * (`navi-connect/CLAUDE.md` §6) is the only thing standing between this table
 * and the same fate.
 *
 * Every row declares the capability it needs, so the screen can answer "is
 * there anything to show" without each row inventing its own empty state. The
 * rule for lb-bot surfaces is stricter than for AudioMuse ones: not configured,
 * unreachable and unindexed all render **nothing**, and the page must look
 * exactly as it does without lb-bot at all.
 */

/** What a row needs in order to have anything to say. */
export type DiscoverCapability =
    /** AudioMuse's CLAP index, probed through `/sonic/clap/stats`. */
    | { kind: 'clap' }
    /** An lb-bot route, gated on `/lb/status.routes` advertising it. */
    | { kind: 'lbbot'; route: string }
    /** Navidrome alone — always answerable. */
    | { kind: 'library' };

export interface DiscoverRowDefinition {
    /** What the row needs before it renders anything. */
    capability: DiscoverCapability;
    id: DiscoverRowId;
    title: string;
}

export type DiscoverRowId =
    | 'charts'
    | 'editorial'
    | 'fresh'
    | 'listenbrainz'
    | 'mixes'
    | 'mood'
    | 'rediscovery'
    | 'similar-artists';

/**
 * Render order. Your own things first, then what is new, then who you are
 * missing, then what the wider world is playing, then what was picked for you,
 * then what you already own and forgot, then a way to ask a question of your
 * own.
 *
 * `mixes` leads deliberately: it is the only row showing something the user
 * made, and everything below it is a proposal from somewhere else. The two
 * Deezer rows sit *below* `similar-artists` for the matching reason — a chart
 * is the weakest claim on this screen and must not outrank a row that can name
 * why it is there.
 *
 * `stations` is deliberately absent rather than disabled. Persistent named
 * stations were the placeholder for what became `mixes`, and the word is spent
 * twice over: `Screen.RadioList` and Worbus for desktop's create/edit-station forms are
 * Subsonic internet radio, and `SavedQueueSource.RADIO` is the ephemeral
 * similarity mix. Hence "Mixed for You", and `mix` as the noun in code.
 */
export const DISCOVER_ROWS: DiscoverRowDefinition[] = [
    {
        // `library`, not `lbbot`: the recipes are hub state, so this row is
        // answerable with no lb-bot and no AudioMuse at all. It hides itself
        // when there are no mixes, like every other row.
        capability: { kind: 'library' },
        id: 'mixes',
        title: 'Mixed for You',
    },
    {
        capability: { kind: 'lbbot', route: 'GET /lb/fresh-releases' },
        id: 'fresh',
        title: 'Fresh releases',
    },
    {
        capability: { kind: 'lbbot', route: 'GET /lb/artist/similar' },
        id: 'similar-artists',
        title: 'Fans also like',
    },
    {
        capability: { kind: 'lbbot', route: 'GET /lb/deezer/chart' },
        id: 'charts',
        title: 'Charts',
    },
    {
        capability: { kind: 'lbbot', route: 'GET /lb/deezer/editorial' },
        id: 'editorial',
        title: 'Editorial picks',
    },
    {
        // Navidrome only: the `listenbrainz-daily-playlist` plugin writes these
        // as ordinary server-side playlists, so this row is a name filter and
        // costs no route, no probe and no lb-bot.
        capability: { kind: 'library' },
        id: 'listenbrainz',
        title: 'Made for you by ListenBrainz',
    },
    {
        capability: { kind: 'library' },
        id: 'rediscovery',
        title: 'Rediscover',
    },
    {
        capability: { kind: 'clap' },
        id: 'mood',
        title: 'Search by how it sounds',
    },
];
