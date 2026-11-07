import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DraggableItems } from '/@/renderer/features/settings/components/general/draggable-items';
import { SettingsOptions } from '/@/renderer/features/settings/components/settings-option';
import {
    ArtistItem,
    ArtistReleaseTypeItem,
    SortableItem,
    useGeneralSettings,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { Switch } from '/@/shared/components/switch/switch';

// The artist page has one order (Popular, Discography, About, Related artists), so these are
// switches in the page's order, named as the page names its sections. The stored list keeps
// whatever order it has; only each row's `disabled` flag is read (album-artist-detail-content.tsx).
const ARTIST_SECTIONS: Array<[ArtistItem, string]> = [
    [ArtistItem.TOP_SONGS, 'page.albumArtistDetail.popular'],
    [ArtistItem.RECENT_ALBUMS, 'page.albumArtistDetail.discographyKicker'],
    [ArtistItem.BIOGRAPHY, 'page.albumArtistDetail.aboutHeading'],
    [ArtistItem.SIMILAR_ARTISTS, 'page.albumArtistDetail.relatedArtists'],
];

export const ArtistSettings = memo(() => {
    const { t } = useTranslation();
    const { artistItems } = useGeneralSettings();
    const { setArtistItems } = useSettingsStoreActions();
    const items = artistItems as SortableItem<ArtistItem>[];

    return (
        <>
            {ARTIST_SECTIONS.map(([id, label]) => {
                const stored = items.find((item) => item.id === id);
                // A section the stored list lacks reads as the page reads it: the releases show,
                // the others do not.
                const shown = stored ? !stored.disabled : id === ArtistItem.RECENT_ALBUMS;

                return (
                    <SettingsOptions
                        control={
                            <Switch
                                aria-label={t(label)}
                                checked={shown}
                                onChange={(e) => {
                                    const disabled = !e.currentTarget.checked;
                                    setArtistItems(
                                        stored
                                            ? items.map((item) =>
                                                  item.id === id ? { ...item, disabled } : item,
                                              )
                                            : [...items, { disabled, id }],
                                    );
                                }}
                            />
                        }
                        description={t('setting.artistSection', { context: 'description' })}
                        key={id}
                        title={t(label)}
                    />
                );
            })}
        </>
    );
});

const ARTIST_RELEASE_TYPE_ITEMS: Array<[ArtistReleaseTypeItem, string]> = [
    [ArtistReleaseTypeItem.APPEARS_ON, 'page.albumArtistDetail.appearsOn'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_ALBUM, 'releaseType.primary.album'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_EP, 'releaseType.primary.ep'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_SINGLE, 'releaseType.primary.single'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_BROADCAST, 'releaseType.primary.broadcast'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_COMPILATION, 'releaseType.secondary.compilation'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_AUDIO_DRAMA, 'releaseType.secondary.audioDrama'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_AUDIOBOOK, 'releaseType.secondary.audiobook'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_INTERVIEW, 'releaseType.secondary.interview'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_LIVE, 'releaseType.secondary.live'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_MIXTAPE_STREET, 'releaseType.secondary.mixtape'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_OTHER, 'releaseType.primary.other'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_REMIX, 'releaseType.secondary.remix'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_DJ_MIX, 'releaseType.secondary.djMix'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_DEMO, 'releaseType.secondary.demo'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_FIELD_RECORDING, 'releaseType.secondary.fieldRecording'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_SOUNDTRACK, 'releaseType.secondary.soundtrack'],
    [ArtistReleaseTypeItem.RELEASE_TYPE_SPOKENWORD, 'releaseType.secondary.spokenWord'],
];

export const ArtistReleaseTypeSettings = memo(() => {
    const { artistReleaseTypeItems } = useGeneralSettings();
    const { setArtistReleaseTypeItems } = useSettingsStoreActions();

    return (
        <DraggableItems
            description="setting.artistReleaseTypeConfiguration"
            itemLabels={ARTIST_RELEASE_TYPE_ITEMS}
            items={artistReleaseTypeItems as SortableItem<ArtistReleaseTypeItem>[]}
            setItems={setArtistReleaseTypeItems}
            title="setting.artistReleaseTypeConfiguration"
        />
    );
});
