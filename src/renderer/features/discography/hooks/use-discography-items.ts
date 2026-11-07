import { useMemo } from 'react';

import {
    buildItems,
    type DiscographyItem,
    type FillInput,
    type OwnedAlbumInput,
    type ReleaseRowInput,
} from '/@/renderer/features/discography/discography-model';
import { KIND_SETTING_ID, type ReleaseKind } from '/@/renderer/features/discography/release-kind';
import {
    type LbBotDiscographyRead,
    useLbBotDiscography,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useActiveFillsStore } from '/@/renderer/features/lbbot/stores/active-fills.store';
import { ArtistReleaseTypeItem } from '/@/renderer/store';
import { Album } from '/@/shared/types/domain-types';

// The pure core copies Settings' item ids (it cannot import the enum); a renamed id fails here.
const SETTING_IDS: Record<ReleaseKind, `${ArtistReleaseTypeItem}`> = KIND_SETTING_ID;
void SETTING_IDS;

const NO_ALBUMS: Album[] = [];

/** A Navidrome album in the pure model's terms. */
export const toOwnedInput = (album: Album, artistId: string): OwnedAlbumInput => {
    const added = album.createdAt ? Date.parse(album.createdAt) : Number.NaN;
    return {
        addedAt: Number.isFinite(added) ? added : null,
        // No album artists at all (a server that does not say) reads as credited: only a list that
        // names others and not this artist makes an album "Appears on".
        creditedAsAlbumArtist:
            !album.albumArtists?.length ||
            album.albumArtists.some((artist) => artist.id === artistId),
        favorite: album.userFavorite,
        id: album.id,
        isCompilation: album.isCompilation === true,
        name: album.name,
        playCount: album.playCount,
        releaseTypes: [...(album.releaseTypes ?? []), album.releaseType ?? ''].filter(Boolean),
        rgid: album.mbzReleaseGroupId ?? '',
        year: album.releaseYear || album.originalYear || null,
    };
};

export interface DiscographyItems {
    /** Navidrome's albums by id, for the tiles that draw a library card. */
    albumsById: Map<string, Album>;
    discography: LbBotDiscographyRead;
    items: DiscographyItem[];
    /** lb-bot has indexed this artist: ownership means something, so the pills and the filter show. */
    known: boolean;
}

/**
 * The discography's items for one artist page: Navidrome's albums (`owned`, null on the not-owned
 * page), lb-bot's index (the local mirror first, the network read as its fallback) and the fill
 * ledger, adapted to the pure model and built once per change.
 */
export const useDiscographyItems = (args: {
    artistMbid?: null | string;
    ndId: string;
    owned: Album[] | null;
}): DiscographyItems => {
    const { artistMbid, ndId } = args;
    const owned = args.owned ?? NO_ALBUMS;
    const discography = useLbBotDiscography(ndId, artistMbid);
    const fillsRecord = useActiveFillsStore((state) => state.fills);
    const data = discography.data;

    const fills = useMemo<FillInput[]>(
        () =>
            Object.values(fillsRecord).map((fill) => ({
                outcome: fill.outcome ?? (fill.settled ? 'gaveUp' : 'running'),
                rgid: fill.rgid,
                settled: fill.settled,
                state: fill.state ?? '',
            })),
        [fillsRecord],
    );

    const items = useMemo(() => {
        const rows: ReleaseRowInput[] = data?.indexed ? data.releases : [];
        return buildItems(
            owned.map((album) => toOwnedInput(album, ndId)),
            rows,
            fills,
        );
    }, [data, fills, ndId, owned]);

    const albumsById = useMemo(() => new Map(owned.map((album) => [album.id, album])), [owned]);

    return { albumsById, discography, items, known: data?.indexed === true };
};
