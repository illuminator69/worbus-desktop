import {
    RiAlbumFill,
    RiAlbumLine,
    RiBarChart2Fill,
    RiBarChart2Line,
    RiBookShelfFill,
    RiBookShelfLine,
    RiCompassDiscoverFill,
    RiCompassDiscoverLine,
    RiDownloadCloud2Fill,
    RiDownloadCloud2Line,
    RiFlag2Fill,
    RiFlag2Line,
    RiFlashlightFill,
    RiFlashlightLine,
    RiFolder3Fill,
    RiFolder3Line,
    RiHeartAddFill,
    RiHeartAddLine,
    RiHeartFill,
    RiHeartLine,
    RiHistoryFill,
    RiHistoryLine,
    RiHome6Fill,
    RiHome6Line,
    RiLinksFill,
    RiLinksLine,
    RiMusic2Fill,
    RiMusic2Line,
    RiPlayFill,
    RiPlayLine,
    RiPlayListFill,
    RiPlayListLine,
    RiRadioFill,
    RiRadioLine,
    RiSearchFill,
    RiSearchLine,
    RiSettings2Fill,
    RiSettings2Line,
    RiSparkling2Fill,
    RiSparkling2Line,
    RiTimeFill,
    RiTimeLine,
    RiUserVoiceFill,
    RiUserVoiceLine,
} from 'react-icons/ri';
import { generatePath, useLocation } from 'react-router';

import styles from './sidebar-icon.module.css';

import { AppRoute } from '/@/renderer/router/routes';
import { LibraryItem } from '/@/shared/types/domain-types';

interface SidebarIconProps {
    active?: boolean;
    /** Picks the glyph by name for rows whose route is shared or empty. */
    name?: 'activity' | 'library';
    route: string;
    size?: string;
}

export const SidebarIcon = ({ active, name, route, size }: SidebarIconProps) => {
    const location = useLocation();
    const isActive = active !== undefined ? active : location.pathname === route;
    const renderIcon = () => {
        switch (name) {
            case 'activity':
                if (isActive) return <RiTimeFill size={size} />;
                return <RiTimeLine size={size} />;
            case 'library':
                if (isActive) return <RiBookShelfFill size={size} />;
                return <RiBookShelfLine size={size} />;
        }
        switch (route) {
            // navi-connect: lb-bot acquisitions. A cloud, not the plain download arrow —
            // this is fetching a record the library never had, not caching one it has.
            case AppRoute.DOWNLOADS:
                if (isActive) return <RiDownloadCloud2Fill size={size} />;
                return <RiDownloadCloud2Line size={size} />;
            // navi-connect: the Discover screen.
            case AppRoute.EXPLORE:
                if (isActive) return <RiCompassDiscoverFill size={size} />;
                return <RiCompassDiscoverLine size={size} />;
            // navi-connect: new and upcoming releases from lb-bot.
            case AppRoute.FRESH:
                if (isActive) return <RiFlashlightFill size={size} />;
                return <RiFlashlightLine size={size} />;
            case AppRoute.HOME:
                if (isActive) return <RiHome6Fill size={size} />;
                return <RiHome6Line size={size} />;
            // F6: Library as one place.
            case AppRoute.LIBRARY:
                if (isActive) return <RiBookShelfFill size={size} />;
                return <RiBookShelfLine size={size} />;
            case AppRoute.LIBRARY_ALBUM_ARTISTS:
                if (isActive) return <RiUserVoiceFill size={size} />;
                return <RiUserVoiceLine size={size} />;
            case AppRoute.LIBRARY_ALBUMS:
                if (isActive) return <RiAlbumFill size={size} />;
                return <RiAlbumLine size={size} />;
            case AppRoute.LIBRARY_ARTISTS:
                if (isActive) return <RiUserVoiceFill size={size} />;
                return <RiUserVoiceLine size={size} />;
            case AppRoute.LIBRARY_FOLDERS:
                if (isActive) return <RiFolder3Fill size={size} />;
                return <RiFolder3Line size={size} />;
            case AppRoute.LIBRARY_GENRES:
                if (isActive) return <RiFlag2Fill size={size} />;
                return <RiFlag2Line size={size} />;
            // navi-connect: Library Matches (I-024).
            case AppRoute.LIBRARY_MATCHES:
                if (isActive) return <RiLinksFill size={size} />;
                return <RiLinksLine size={size} />;
            case AppRoute.LIBRARY_SONGS:
                if (isActive) return <RiMusic2Fill size={size} />;
                return <RiMusic2Line size={size} />;
            // navi-connect: My Listening (I-006).
            case AppRoute.LISTENING:
                if (isActive) return <RiBarChart2Fill size={size} />;
                return <RiBarChart2Line size={size} />;
            // navi-connect: Mixed for You. It fell through to the default branch, so the
            // entry wore Home's icon.
            case AppRoute.MIXES:
                if (isActive) return <RiSparkling2Fill size={size} />;
                return <RiSparkling2Line size={size} />;
            case AppRoute.NOW_PLAYING:
                if (isActive) return <RiPlayFill size={size} />;
                return <RiPlayLine size={size} />;
            case AppRoute.PLAYLISTS:
                if (isActive) return <RiPlayListFill size={size} />;
                return <RiPlayListLine size={size} />;
            case AppRoute.RADIO:
                if (isActive) return <RiRadioFill size={size} />;
                return <RiRadioLine size={size} />;
            // navi-connect: Saved Queues, the play history of whole queues.
            case AppRoute.SAVED_QUEUES:
                if (isActive) return <RiHistoryFill size={size} />;
                return <RiHistoryLine size={size} />;
            case AppRoute.SETTINGS:
                if (isActive) return <RiSettings2Fill size={size} />;
                return <RiSettings2Line size={size} />;
            // navi-connect (Worbus P1): albums kept for later. Its own glyph; it fell to Home's.
            case AppRoute.WISHLIST:
                if (isActive) return <RiHeartAddFill size={size} />;
                return <RiHeartAddLine size={size} />;
            case generatePath(AppRoute.SEARCH, { itemType: LibraryItem.SONG }):
                if (isActive) return <RiSearchFill size={size} />;
                return <RiSearchLine size={size} />;
            default:
                if (route.startsWith(AppRoute.FAVORITES)) {
                    if (isActive) return <RiHeartFill size={size} />;
                    return <RiHeartLine size={size} />;
                }
                return <RiHome6Line size={size} />;
        }
    };
    return <span className={styles.wrapper}>{renderIcon()}</span>;
};
