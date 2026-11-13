/**
 * B-406: a download folder lb-bot is waiting to have filed (`/lb/attention`'s `folders`, PROTOCOL
 * §15.6), as far as a client may know it: what lb-bot identified it as and how many files, never
 * its `name` or `path` (host paths). Filing happens only in lb-bot's own page (`#/place/<id>`).
 */
export interface LbBotAttentionFolder {
    fileCount: number;
    /** lb-bot's own summary of the formats, e.g. "flac"; "" when none. */
    formats: string;
    /** lb-bot's 12-character folder id. */
    id: string;
    identified: boolean;
    /** "Artist - Album" as lb-bot wrote it, or "" for a folder it could not identify. */
    matchLabel: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** lb-bot's `_download_folder_id`: 12 lowercase hex characters. */
const FOLDER_ID = /^[0-9a-f]{12}$/;

/** The folder rows of a `/lb/attention` answer, allowlisted; a row with no id is dropped. */
export const attentionFolders = (answer: unknown): LbBotAttentionFolder[] => {
    const rows =
        answer && typeof answer === 'object' ? (answer as Record<string, unknown>).folders : null;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row): LbBotAttentionFolder[] => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        const id = str(r.id).trim();
        // Review L3: lb-bot's folder id is 12 lowercase hex characters; nothing else opens.
        if (!FOLDER_ID.test(id)) return [];
        const fileCount = typeof r.fileCount === 'number' && r.fileCount > 0 ? r.fileCount : 0;
        return [
            {
                fileCount: Math.floor(fileCount),
                formats: str(r.formats),
                id,
                identified: r.identified === true,
                matchLabel: str(r.matchLabel),
            },
        ];
    });
};

/** How many folder rows lb-bot's cap cut (`truncated.folders`); 0 when absent. */
export const attentionFoldersCut = (answer: unknown): number => {
    const cut =
        answer && typeof answer === 'object' ? (answer as Record<string, unknown>).truncated : null;
    const n = cut && typeof cut === 'object' ? (cut as Record<string, unknown>).folders : 0;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
};

/**
 * One album lb-bot's `/lb/attention` lists (`_attention_view` `albums`): a review group whose own
 * status is `failed` or `picking` now (`kind: gap`), or a failed whole-album request (`kind:
 * request`) - every client's. Need you takes another client's pick from here: the fill ledger
 * (`/lb/activity`) never holds a `picking` state. Allowlisted; no cover URL, no counts.
 */
export interface LbBotAttentionAlbum {
    album: string;
    /** The Navidrome album id, when lb-bot knows it; "" otherwise. */
    albumId: string;
    artist: string;
    groupId: string;
    kind: 'gap' | 'request';
    releaseMbid: string;
    rgid: string;
    state: string;
    /** Epoch seconds, lb-bot's clock. */
    updatedAt: number;
}

/**
 * The `albums` of a `/lb/attention` answer, allowlisted; null when the answer has none (an
 * lb-bot from before the rows). A row of another kind, with no state, or with neither a group
 * nor a release to join it by, is dropped.
 */
export const attentionAlbums = (answer: unknown): LbBotAttentionAlbum[] | null => {
    const rows =
        answer && typeof answer === 'object' ? (answer as Record<string, unknown>).albums : null;
    if (!Array.isArray(rows)) return null;
    return rows.flatMap((row): LbBotAttentionAlbum[] => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        const kind = r.kind;
        const state = str(r.state);
        const groupId = str(r.groupId);
        const releaseMbid = str(r.releaseMbid);
        if ((kind !== 'gap' && kind !== 'request') || !state) return [];
        if (!groupId && !releaseMbid) return [];
        return [
            {
                album: str(r.album),
                albumId: str(r.albumId),
                artist: str(r.artist),
                groupId,
                kind,
                releaseMbid,
                rgid: str(r.rgid),
                state,
                updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
            },
        ];
    });
};
