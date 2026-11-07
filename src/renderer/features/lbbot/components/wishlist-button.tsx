import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useHubSupports,
    useLbBotWishlist,
    useWishlistActions,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';

/**
 * Add to wishlist for one release-group (Call 11: there is no artist form), and once it is on the
 * list "On the wishlist" with Remove. Absent when the hub does not proxy the wishlist.
 */
export const WishlistButton = ({
    artist,
    rgid,
    title,
}: {
    artist: string;
    rgid: string;
    title: string;
}) => {
    const { t } = useTranslation();
    const supported = useHubSupports('GET /lb/wishlist');
    const wishlist = useLbBotWishlist();
    const { add, remove } = useWishlistActions();
    const [busy, setBusy] = useState(false);
    if (!supported || !rgid || !wishlist.data) return null;
    const listed = wishlist.data.entries.some((entry) => entry.rgid === rgid);
    const act = async (action: () => Promise<boolean>) => {
        setBusy(true);
        await action();
        setBusy(false);
    };
    return listed ? (
        <>
            <Button
                data-wishlist-on=""
                disabled
                leftSection={<Icon icon="check" />}
                variant="default"
            >
                {t('naviConnect.request.onWishlist')}
            </Button>
            <Button
                data-wishlist-remove=""
                loading={busy}
                onClick={() => void act(() => remove(rgid))}
                variant="subtle"
            >
                {t('naviConnect.request.removeWishlist')}
            </Button>
        </>
    ) : (
        <Button
            data-wishlist-add=""
            leftSection={<Icon icon="add" />}
            loading={busy}
            onClick={() => void act(() => add({ artist, rgid, title }))}
            variant="default"
        >
            {t('naviConnect.request.addWishlist')}
        </Button>
    );
};
